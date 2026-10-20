import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';

let server;
let db;
let base;
let dataDir;
let cookie = '';

async function call(method, url, { body, form } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${base}/api${url}`, { method, headers, body: payload });
  const text = await res.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {
    // Non-JSON responses (file downloads) are returned as text.
  }
  return { status: res.status, data, res };
}

const storedNameOf = (fileId) => db.prepare('SELECT stored_name FROM files WHERE id = ?').get(fileId).stored_name;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docukaksh-test-'));
  const created = createApp({ dataDir });
  db = created.db;
  await new Promise((resolve) => {
    server = created.app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('setup and authentication', async () => {
  let r = await call('GET', '/auth/status');
  assert.equal(r.data.setupRequired, true);

  r = await call('GET', '/persons');
  assert.equal(r.status, 401, 'API must reject anonymous requests');

  r = await call('POST', '/auth/setup', { body: { email: 'Owner@Example.com', password: 'longenough' } });
  assert.equal(r.status, 201);
  assert.equal(r.data.email, 'owner@example.com');
  cookie = r.res.headers.get('set-cookie').split(';')[0];

  r = await call('POST', '/auth/setup', { body: { email: 'other@example.com', password: 'longenough' } });
  assert.equal(r.status, 409, 'setup must not be reusable');

  r = await call('POST', '/auth/logout');
  assert.equal(r.status, 204);
  cookie = '';
  r = await call('POST', '/auth/login', { body: { email: 'owner@example.com', password: 'wrong-password' } });
  assert.equal(r.status, 401);
  r = await call('POST', '/auth/login', { body: { email: 'owner@example.com', password: 'longenough' } });
  assert.equal(r.status, 200);
  cookie = r.res.headers.get('set-cookie').split(';')[0];
});

test('persons, nested folders and files', async () => {
  let r = await call('POST', '/persons', { body: { name: 'Papa', color: '#ff0000' } });
  assert.equal(r.status, 201);
  const person = r.data;

  r = await call('POST', '/folders', { body: { person_id: person.id, name: 'Taxes' } });
  const taxes = r.data;
  r = await call('POST', '/folders', { body: { person_id: person.id, parent_id: taxes.id, name: '2025' } });
  const year = r.data;
  r = await call('POST', '/folders', { body: { person_id: person.id, parent_id: year.id, name: 'Receipts' } });
  const receipts = r.data;

  const form = new FormData();
  form.append('person_id', String(person.id));
  form.append('folder_id', String(receipts.id));
  form.append('files', new Blob(['hello receipt'], { type: 'text/plain' }), 'notes.txt');
  r = await call('POST', '/files', { form });
  assert.equal(r.status, 201);
  const file = r.data[0];
  assert.equal(file.name, 'notes.txt');
  assert.equal(file.folder_id, receipts.id);
  assert.equal(file.stored_name, undefined, 'internal storage name must not be exposed');

  r = await call('GET', `/persons/${person.id}/browse?folder_id=${year.id}`);
  assert.deepEqual(r.data.folders.map((f) => f.name), ['Receipts']);
  assert.deepEqual(r.data.breadcrumb.map((c) => c.name), ['Taxes', '2025']);

  r = await call('GET', `/persons/${person.id}/browse`);
  assert.deepEqual(r.data.folders.map((f) => f.name), ['Taxes']);
  assert.equal(r.data.files.length, 0);

  r = await call('GET', `/files/${file.id}/content?download=1`);
  assert.equal(r.status, 200);
  assert.equal(r.data, 'hello receipt');
  assert.match(r.res.headers.get('content-disposition'), /^attachment/);

  r = await call('GET', `/files/${file.id}/content`);
  assert.match(r.res.headers.get('content-disposition'), /^inline/, 'text/plain previews inline');
});

test('folders cannot be moved into themselves or their descendants', async () => {
  const { data: people } = await call('GET', '/persons');
  const personId = people.find((p) => p.name === 'Papa').id;
  const { data: tree } = await call('GET', `/persons/${personId}/tree`);
  const taxes = tree.find((f) => f.name === 'Taxes');
  const receipts = tree.find((f) => f.name === 'Receipts');

  let r = await call('PATCH', `/folders/${taxes.id}`, { body: { parent_id: receipts.id } });
  assert.equal(r.status, 400);
  r = await call('PATCH', `/folders/${taxes.id}`, { body: { parent_id: taxes.id } });
  assert.equal(r.status, 400);

  r = await call('PATCH', `/folders/${receipts.id}`, { body: { parent_id: null } });
  assert.equal(r.status, 200, 'moving a folder up to the person root is allowed');
  assert.equal(r.data.parent_id, null);
});

test('files can be moved and renamed, and cross-person folders are refused', async () => {
  const { data: people } = await call('GET', '/persons');
  const personId = people.find((p) => p.name === 'Papa').id;
  const { data: tree } = await call('GET', `/persons/${personId}/tree`);
  const taxes = tree.find((f) => f.name === 'Taxes');

  const receipts = tree.find((f) => f.name === 'Receipts');
  const { data: inReceipts } = await call('GET', `/persons/${personId}/browse?folder_id=${receipts.id}`);
  const notes = inReceipts.files.find((f) => f.name === 'notes.txt');
  assert.ok(notes, 'notes.txt should still be inside Receipts');

  let r = await call('PATCH', `/files/${notes.id}`, { body: { folder_id: taxes.id, name: 'notes-renamed.txt' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.name, 'notes-renamed.txt');
  assert.equal(r.data.folder_id, taxes.id);

  r = await call('POST', '/persons', { body: { name: 'Mama' } });
  const other = r.data;
  const form = new FormData();
  form.append('person_id', String(other.id));
  form.append('folder_id', String(taxes.id));
  form.append('files', new Blob(['x']), 'x.txt');
  r = await call('POST', '/files', { form });
  assert.equal(r.status, 400, 'a folder cannot receive files from another person');
});

test('search finds files across persons and escapes LIKE wildcards', async () => {
  let r = await call('GET', '/search?q=renamed');
  assert.equal(r.data.length, 1);
  assert.equal(r.data[0].person_name, 'Papa');
  assert.equal(r.data[0].folder_name, 'Taxes');

  r = await call('GET', '/search?q=%25');
  assert.equal(r.data.length, 0, 'a literal % must not match everything');
});

test('risky file types are served as downloads and unsafe paths are rejected', async () => {
  const { data: people } = await call('GET', '/persons');
  const personId = people.find((p) => p.name === 'Papa').id;
  const { data: tree } = await call('GET', `/persons/${personId}/tree`);
  const taxes = tree.find((f) => f.name === 'Taxes');

  const form = new FormData();
  form.append('person_id', String(personId));
  form.append('folder_id', String(taxes.id));
  form.append('files', new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), 'page.html');
  let r = await call('POST', '/files', { form });
  const html = r.data[0];

  r = await call('GET', `/files/${html.id}/content`);
  assert.equal(r.res.headers.get('content-type'), 'application/octet-stream');
  assert.equal(r.res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.res.headers.get('content-disposition'), /^attachment/);

  r = await call('GET', '/files/999999/content');
  assert.equal(r.status, 404);
  r = await call('PATCH', `/files/${html.id}`, { body: { name: '   ' } });
  assert.equal(r.status, 400);
});

test('deleting a folder removes its files from storage and the database', async () => {
  const { data: people } = await call('GET', '/persons');
  const personId = people.find((p) => p.name === 'Papa').id;
  const { data: tree } = await call('GET', `/persons/${personId}/tree`);
  const taxes = tree.find((f) => f.name === 'Taxes');

  const form = new FormData();
  form.append('person_id', String(personId));
  form.append('folder_id', String(taxes.id));
  form.append('files', new Blob(['to be deleted']), 'gone.bin');
  const { data: [gone] } = await call('POST', '/files', { form });
  const onDisk = path.join(dataDir, 'uploads', storedNameOf(gone.id));
  assert.ok(fs.existsSync(onDisk));

  const r = await call('DELETE', `/folders/${taxes.id}`);
  assert.equal(r.status, 204);
  assert.equal(fs.existsSync(onDisk), false, 'blob must be removed from disk');
  const row = db.prepare('SELECT id FROM files WHERE id = ?').get(gone.id);
  assert.equal(row, undefined);
});

test('deleting a person removes everything under it', async () => {
  const { data: people } = await call('GET', '/persons');
  const mama = people.find((p) => p.name === 'Mama');
  const r = await call('DELETE', `/persons/${mama.id}`);
  assert.equal(r.status, 204);
  const { data: remaining } = await call('GET', '/persons');
  assert.deepEqual(remaining.map((p) => p.name), ['Papa']);
});
