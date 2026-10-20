import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';

let server;
let db;
let base;
let dataDir;
let cookie = '';

async function call(method, url, { body, form, as } = {}) {
  const headers = {};
  const sessionCookie = as ?? cookie;
  if (sessionCookie) headers.cookie = sessionCookie;
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
    // Non-JSON bodies (file downloads) are returned as text.
  }
  return { status: res.status, data, res };
}

const storedNameOf = (fileId) => db.prepare('SELECT stored_name FROM files WHERE id = ?').get(fileId).stored_name;
const onDisk = (fileId) => path.join(dataDir, 'uploads', storedNameOf(fileId));

function uploadForm(personId, { folderId, name, body = 'data', type = 'text/plain' }) {
  const form = new FormData();
  form.append('person_id', String(personId));
  if (folderId) form.append('folder_id', String(folderId));
  form.append('files', new Blob([body], { type }), name);
  return form;
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docukaksh-test-'));
  const created = createApp({ dataDir, encryptionKey: crypto.randomBytes(32), loginMaxFailures: 1000 });
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

test('setup, login and logout', async () => {
  let r = await call('GET', '/auth/status');
  assert.equal(r.data.setupRequired, true);

  r = await call('GET', '/persons');
  assert.equal(r.status, 401, 'API must reject anonymous requests');

  r = await call('POST', '/auth/setup', { body: { email: 'Owner@Example.com', password: 'longenough' } });
  assert.equal(r.status, 201);
  assert.equal(r.data.email, 'owner@example.com');
  assert.equal(r.data.role, 'super_admin');
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
  assert.equal(r.data.role, 'super_admin');
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

  r = await call('POST', '/files', { form: uploadForm(person.id, { folderId: receipts.id, name: 'notes.txt', body: 'hello receipt' }) });
  assert.equal(r.status, 201);
  const file = r.data[0];
  assert.equal(file.name, 'notes.txt');
  assert.equal(file.folder_id, receipts.id);
  assert.equal(file.stored_name, undefined, 'internal storage name must not be exposed');
  assert.equal(file.uploaded_by_email, 'owner@example.com');

  r = await call('GET', `/folders/${year.id}/browse`);
  assert.deepEqual(r.data.folders.map((f) => f.name), ['Receipts']);
  assert.deepEqual(r.data.breadcrumb.map((c) => c.name), ['Taxes', '2025']);

  r = await call('GET', `/persons/${person.id}/browse`);
  assert.deepEqual(r.data.folders.map((f) => f.name), ['Taxes']);

  r = await call('GET', `/files/${file.id}/content?download=1`);
  assert.equal(r.data, 'hello receipt');
  assert.match(r.res.headers.get('content-disposition'), /^attachment/);

  r = await call('GET', `/files/${file.id}/content`);
  assert.equal(r.res.headers.get('content-type'), 'application/octet-stream', 'plain text is previewed, not served inline');
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
  assert.equal(r.status, 200);
  assert.equal(r.data.parent_id, null);
});

test('files can be moved and renamed, and cross-person folders are refused', async () => {
  const { data: people } = await call('GET', '/persons');
  const papa = people.find((p) => p.name === 'Papa');
  const { data: tree } = await call('GET', `/persons/${papa.id}/tree`);
  const taxes = tree.find((f) => f.name === 'Taxes');
  const receipts = tree.find((f) => f.name === 'Receipts');

  const { data: inReceipts } = await call('GET', `/folders/${receipts.id}/browse`);
  const notes = inReceipts.files.find((f) => f.name === 'notes.txt');

  let r = await call('PATCH', `/files/${notes.id}`, { body: { folder_id: taxes.id, name: 'notes-renamed.txt' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.name, 'notes-renamed.txt');
  assert.equal(r.data.folder_id, taxes.id);

  r = await call('POST', '/persons', { body: { name: 'Mama' } });
  const mama = r.data;
  r = await call('POST', '/files', { form: uploadForm(mama.id, { folderId: taxes.id, name: 'x.txt' }) });
  assert.equal(r.status, 400, 'a folder cannot receive files from another person');
});

test('search finds files across persons, escapes wildcards and matches tags', async () => {
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

  let r = await call('POST', '/files', {
    form: uploadForm(personId, { folderId: taxes.id, name: 'page.html', body: '<script>alert(1)</script>', type: 'text/html' }),
  });
  const html = r.data[0];

  r = await call('GET', `/files/${html.id}/content`);
  assert.equal(r.res.headers.get('content-type'), 'application/octet-stream');
  assert.equal(r.res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.res.headers.get('content-disposition'), /^attachment/);

  r = await call('GET', `/files/${html.id}/preview`);
  assert.equal(r.res.headers.get('content-security-policy').includes('sandbox'), true);
  assert.equal(r.data.includes('<script>alert(1)</script>'), false, 'HTML is shown as escaped text');

  r = await call('GET', '/files/999999/content');
  assert.equal(r.status, 404);
  r = await call('PATCH', `/files/${html.id}`, { body: { name: '   ' } });
  assert.equal(r.status, 400);
});

test('deleting a folder moves it to the recycle bin; restore brings it back; delete forever removes the blob', async () => {
  const { data: people } = await call('GET', '/persons');
  const personId = people.find((p) => p.name === 'Papa').id;
  const { data: tree } = await call('GET', `/persons/${personId}/tree`);
  const taxes = tree.find((f) => f.name === 'Taxes');
  const year = tree.find((f) => f.name === '2025');

  let r = await call('POST', '/files', { form: uploadForm(personId, { folderId: year.id, name: 'gone.bin', body: 'to be deleted' }) });
  const gone = r.data[0];
  assert.ok(fs.existsSync(onDisk(gone.id)));

  r = await call('DELETE', `/folders/${taxes.id}`);
  assert.equal(r.status, 204);
  r = await call('GET', `/persons/${personId}/browse`);
  assert.equal(r.data.folders.some((f) => f.name === 'Taxes'), false, 'the folder disappears from the browser');
  assert.equal(fs.existsSync(onDisk(gone.id)), true, 'soft delete keeps the bytes');

  r = await call('GET', '/trash');
  assert.equal(r.status, 200);
  const trashed = r.data.find((t) => t.kind === 'folder' && t.name === 'Taxes');
  assert.ok(trashed, 'the top-most deleted folder is listed');
  assert.equal(r.data.some((t) => t.name === 'gone.bin'), false, 'children are shown inside their folder, not separately');

  r = await call('POST', `/trash/folder/${trashed.id}/restore`);
  assert.equal(r.status, 204);
  r = await call('GET', `/persons/${personId}/browse`);
  assert.ok(r.data.folders.some((f) => f.name === 'Taxes'), 'restored folder is back');

  const blob = onDisk(gone.id);
  r = await call('DELETE', `/folders/${taxes.id}`);
  r = await call('DELETE', `/trash/folder/${taxes.id}`);
  assert.equal(r.status, 204);
  assert.equal(fs.existsSync(blob), false, 'delete forever removes the stored file');
  assert.equal(db.prepare('SELECT id FROM files WHERE id = ?').get(gone.id), undefined);
});

test('deleting a person hides it; restore and delete forever work from the bin', async () => {
  let r = await call('POST', '/persons', { body: { name: 'Temporary' } });
  const temp = r.data;
  r = await call('POST', '/files', { form: uploadForm(temp.id, { name: 'temp.txt', body: 'x' }) });
  const file = r.data[0];

  r = await call('DELETE', `/persons/${temp.id}`);
  assert.equal(r.status, 204);
  r = await call('GET', '/persons');
  assert.equal(r.data.some((p) => p.name === 'Temporary'), false);
  r = await call('GET', `/files/${file.id}`);
  assert.equal(r.status, 404, 'files under a deleted person are hidden too');

  r = await call('POST', `/trash/person/${temp.id}/restore`);
  assert.equal(r.status, 204);
  r = await call('GET', `/files/${file.id}`);
  assert.equal(r.status, 200);

  const blob = path.join(dataDir, 'uploads', storedNameOf(file.id));
  await call('DELETE', `/persons/${temp.id}`);
  r = await call('DELETE', `/trash/person/${temp.id}`);
  assert.equal(r.status, 204);
  assert.equal(fs.existsSync(blob), false);
});

test('persons can be reordered by the super admin', async () => {
  let r = await call('POST', '/persons', { body: { name: 'Zed' } });
  const zed = r.data;
  r = await call('POST', '/persons', { body: { name: 'Amy' } });
  const amy = r.data;
  r = await call('PUT', '/persons/order', { body: { ids: [amy.id, zed.id] } });
  assert.equal(r.status, 204);
  r = await call('GET', '/persons');
  const order = r.data.map((p) => p.name);
  assert.ok(order.indexOf('Amy') < order.indexOf('Zed'));
});
