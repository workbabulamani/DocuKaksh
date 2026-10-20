import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db.js';

let server;
let db;
let base;
let dataDir;
let adminCookie = '';

async function call(method, url, { body, form, cookie = '' } = {}) {
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
    // Non-JSON bodies are returned as text.
  }
  return { status: res.status, data, res };
}

const cookieFrom = (res) => res.headers.get('set-cookie').split(';')[0];
const login = (email, password) => call('POST', '/auth/login', { body: { email, password } });

async function userByEmail(email) {
  const { data } = await call('GET', '/users', { cookie: adminCookie });
  return data.find((u) => u.email === email);
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docukaksh-rbac-'));
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

test('the first account is the super admin', async () => {
  const r = await call('POST', '/auth/setup', { body: { email: 'boss@example.com', password: 'bosspass1' } });
  assert.equal(r.status, 201);
  assert.equal(r.data.role, 'super_admin');
  adminCookie = cookieFrom(r.res);

  const status = await call('GET', '/auth/status', { cookie: adminCookie });
  assert.equal(status.data.user.role, 'super_admin');
  assert.ok(status.data.user.permissions.includes('users:manage'));
  assert.ok(status.data.user.permissions.includes('persons:manage'));
  assert.equal(status.data.user.theme, 'day', 'day is the default theme');
});

test('only the super admin creates persons; users work with assigned persons only', async () => {
  let r = await call('POST', '/persons', { cookie: adminCookie, body: { name: 'Papa' } });
  const papa = r.data;
  r = await call('POST', '/persons', { cookie: adminCookie, body: { name: 'Office' } });
  const office = r.data;

  r = await call('POST', '/users', {
    cookie: adminCookie,
    body: { email: 'member@example.com', password: 'memberpass', role: 'user', personIds: [papa.id] },
  });
  assert.equal(r.status, 201);
  assert.equal(r.data.role, 'user');
  assert.equal(r.data.must_change_password, 1, 'new accounts must choose their own password');

  r = await login('member@example.com', 'memberpass');
  assert.equal(r.status, 200);
  assert.equal(r.data.mustChangePassword, true);
  const memberCookie = cookieFrom(r.res);

  // Until the password is changed, nothing but the password screen works.
  r = await call('GET', '/persons', { cookie: memberCookie });
  assert.equal(r.status, 403);
  assert.equal(r.data.code, 'PASSWORD_CHANGE_REQUIRED');
  r = await call('POST', '/auth/password', { cookie: memberCookie, body: { current: 'memberpass', password: 'member-chosen-1' } });
  assert.equal(r.status, 204);
  const session = cookieFrom(r.res);

  r = await call('GET', '/persons', { cookie: session });
  assert.deepEqual(r.data.map((p) => p.name), ['Papa'], 'the user sees only the assigned person');

  r = await call('POST', '/persons', { cookie: session, body: { name: 'Mine' } });
  assert.equal(r.status, 403, 'users cannot create persons');
  r = await call('PATCH', `/persons/${papa.id}`, { cookie: session, body: { name: 'Renamed' } });
  assert.equal(r.status, 403, 'users cannot rename persons');
  r = await call('DELETE', `/persons/${papa.id}`, { cookie: session });
  assert.equal(r.status, 403, 'users cannot delete persons');

  r = await call('GET', `/persons/${office.id}/browse`, { cookie: session });
  assert.equal(r.status, 404, 'an unassigned person does not exist for the user');

  r = await call('POST', '/folders', { cookie: session, body: { person_id: papa.id, name: 'Bills' } });
  assert.equal(r.status, 201, 'users can create folders in assigned persons');
  const bills = r.data;

  const form = new FormData();
  form.append('person_id', String(papa.id));
  form.append('folder_id', String(bills.id));
  form.append('files', new Blob(['invoice']), 'invoice.txt');
  r = await call('POST', '/files', { cookie: session, form });
  assert.equal(r.status, 201, 'users can upload');
  assert.equal(r.data[0].uploaded_by_email, 'member@example.com');

  r = await call('PATCH', `/files/${r.data[0].id}`, { cookie: session, body: { name: 'invoice-march.txt' } });
  assert.equal(r.status, 200, 'users can modify documents');
});

test('users cannot reach admin areas, and admin data is hidden from users', async () => {
  const member = await login('member@example.com', 'member-chosen-1');
  const session = cookieFrom(member.res);

  for (const url of ['/users', '/recovery', '/trash']) {
    const r = await call('GET', url, { cookie: session });
    assert.equal(r.status, 403, `${url} is admin only`);
  }
  const status = await call('GET', '/auth/status', { cookie: session });
  assert.deepEqual(status.data.user.permissions, ['documents']);
  assert.equal(status.data.user.pendingRequests, 0);
});

test('users can soft-delete documents but the recycle bin is admin only', async () => {
  const session = cookieFrom((await login('member@example.com', 'member-chosen-1')).res);
  const { data: persons } = await call('GET', '/persons', { cookie: session });
  const { data: browse } = await call('GET', `/persons/${persons[0].id}/browse`, { cookie: session });
  const folder = browse.folders.find((f) => f.name === 'Bills');
  const { data: inside } = await call('GET', `/folders/${folder.id}/browse`, { cookie: session });
  const invoice = inside.files[0];

  let r = await call('DELETE', `/files/${invoice.id}`, { cookie: session });
  assert.equal(r.status, 204, 'users may delete');
  r = await call('GET', `/folders/${folder.id}/browse`, { cookie: session });
  assert.equal(r.data.files.length, 0);
  r = await call('GET', '/trash', { cookie: session });
  assert.equal(r.status, 403, 'users cannot see or purge the bin');
});

test('disabling an account revokes access immediately, re-enabling restores it', async () => {
  const member = await userByEmail('member@example.com');
  const session = cookieFrom((await login('member@example.com', 'member-chosen-1')).res);

  let r = await call('PATCH', `/users/${member.id}`, { cookie: adminCookie, body: { active: false } });
  assert.equal(r.status, 200);
  assert.equal(r.data.active, 0);

  r = await call('GET', '/persons', { cookie: session });
  assert.equal(r.status, 401, 'the existing session must stop working');
  r = await login('member@example.com', 'member-chosen-1');
  assert.equal(r.status, 401, 'a disabled account cannot sign in');

  r = await call('PATCH', `/users/${member.id}`, { cookie: adminCookie, body: { active: true } });
  assert.equal(r.status, 200);
  r = await login('member@example.com', 'member-chosen-1');
  assert.equal(r.status, 200);
});

test('the super admin cannot lock themselves out', async () => {
  const { data: me } = await call('GET', '/auth/status', { cookie: adminCookie });
  let r = await call('PATCH', `/users/${me.user.id}`, { cookie: adminCookie, body: { active: false } });
  assert.equal(r.status, 400);
  r = await call('PATCH', `/users/${me.user.id}`, { cookie: adminCookie, body: { role: 'user' } });
  assert.equal(r.status, 400);
  r = await call('DELETE', `/users/${me.user.id}`, { cookie: adminCookie });
  assert.equal(r.status, 400);
});

test('changing a password signs out other sessions; theme is saved per user', async () => {
  const first = cookieFrom((await login('member@example.com', 'member-chosen-1')).res);

  let r = await call('POST', '/auth/password', { cookie: first, body: { current: 'wrong', password: 'another-pass-1' } });
  assert.equal(r.status, 400);
  r = await call('POST', '/auth/password', { cookie: first, body: { current: 'member-chosen-1', password: 'another-pass-1' } });
  assert.equal(r.status, 204);
  const fresh = cookieFrom(r.res);

  r = await call('GET', '/persons', { cookie: first });
  assert.equal(r.status, 401);
  r = await call('GET', '/persons', { cookie: fresh });
  assert.equal(r.status, 200);

  r = await call('PATCH', '/auth/me', { cookie: fresh, body: { theme: 'not-a-theme' } });
  assert.equal(r.status, 400);
  r = await call('PATCH', '/auth/me', { cookie: fresh, body: { theme: 'nord' } });
  assert.equal(r.data.theme, 'nord');
  r = await call('GET', '/auth/status', { cookie: fresh });
  assert.equal(r.data.user.theme, 'nord');
});

test('the super admin can assign and unassign persons', async () => {
  const member = await userByEmail('member@example.com');
  const { data: persons } = await call('GET', '/persons', { cookie: adminCookie });
  const papa = persons.find((p) => p.name === 'Papa');
  const office = persons.find((p) => p.name === 'Office');
  const session = cookieFrom((await login('member@example.com', 'another-pass-1')).res);

  let r = await call('PUT', `/users/${member.id}/persons`, { cookie: adminCookie, body: { personIds: [office.id] } });
  assert.equal(r.status, 200);
  r = await call('GET', `/persons/${papa.id}/browse`, { cookie: session });
  assert.equal(r.status, 404, 'Papa is no longer visible');
  r = await call('GET', `/persons/${office.id}/browse`, { cookie: session });
  assert.equal(r.status, 200, 'Office is now visible');

  await call('PUT', `/users/${member.id}/persons`, { cookie: adminCookie, body: { personIds: [papa.id] } });
});

test('the super admin can reset a password; the user must change it again', async () => {
  const member = await userByEmail('member@example.com');
  let r = await call('POST', `/users/${member.id}/password`, { cookie: adminCookie, body: { password: 'resetpass1' } });
  assert.equal(r.status, 204);

  r = await login('member@example.com', 'another-pass-1');
  assert.equal(r.status, 401);
  r = await login('member@example.com', 'resetpass1');
  assert.equal(r.data.mustChangePassword, true);
  const session = cookieFrom(r.res);
  r = await call('POST', '/auth/password', { cookie: session, body: { current: 'resetpass1', password: 'member-final-1' } });
  assert.equal(r.status, 204);
});

test('forgot-password requests reach the super admin, who approves them with a temporary password', async () => {
  let r = await call('POST', '/auth/recovery', { body: { email: 'member@example.com', note: 'Locked out after holiday' } });
  assert.equal(r.status, 202);
  r = await call('POST', '/auth/recovery', { body: { email: 'nobody@example.com' } });
  assert.equal(r.status, 202, 'unknown addresses get the same answer');
  assert.equal(r.data.message, (await call('POST', '/auth/recovery', { body: { email: 'member@example.com' } })).data.message);

  const member = await userByEmail('member@example.com');
  r = await call('GET', '/recovery', { cookie: adminCookie });
  const pending = r.data.filter((q) => q.status === 'pending');
  assert.equal(pending.length, 1, 'duplicate pending requests are not created');
  assert.equal(pending[0].note, 'Locked out after holiday');

  const memberSession = cookieFrom((await login('member@example.com', 'member-final-1')).res);
  r = await call('GET', '/recovery', { cookie: memberSession });
  assert.equal(r.status, 403);

  r = await call('POST', `/recovery/${pending[0].id}/approve`, { cookie: adminCookie });
  assert.equal(r.status, 200);
  assert.equal(r.data.email, 'member@example.com');
  const temporary = r.data.temporaryPassword;
  assert.ok(temporary.length >= 12);

  r = await call('GET', '/persons', { cookie: memberSession });
  assert.equal(r.status, 401, 'approval signs the account out everywhere');
  r = await login('member@example.com', 'member-final-1');
  assert.equal(r.status, 401, 'the old password no longer works');
  r = await login('member@example.com', temporary);
  assert.equal(r.status, 200);
  assert.equal(r.data.mustChangePassword, true);
});

test('a rejected request cannot be approved afterwards', async () => {
  await call('POST', '/auth/recovery', { body: { email: 'member@example.com' } });
  const { data: list } = await call('GET', '/recovery', { cookie: adminCookie });
  const request = list.find((q) => q.status === 'pending');
  let r = await call('POST', `/recovery/${request.id}/reject`, { cookie: adminCookie });
  assert.equal(r.status, 204);
  r = await call('POST', `/recovery/${request.id}/approve`, { cookie: adminCookie });
  assert.equal(r.status, 404);
});

test('deleting a user account keeps their documents', async () => {
  const outsider = await call('POST', '/users', {
    cookie: adminCookie,
    body: { email: 'temp@example.com', password: 'temppass12', role: 'user' },
  });
  const tempSession = cookieFrom((await login('temp@example.com', 'temppass12')).res);
  let r = await call('POST', '/auth/password', { cookie: tempSession, body: { current: 'temppass12', password: 'temp-chosen-1' } });
  const ownSession = cookieFrom(r.res);
  r = await call('POST', '/persons', { cookie: adminCookie, body: { name: 'Shared' } });
  const shared = r.data;
  await call('PUT', `/users/${outsider.data.id}/persons`, { cookie: adminCookie, body: { personIds: [shared.id] } });
  const form = new FormData();
  form.append('person_id', String(shared.id));
  form.append('files', new Blob(['keep me']), 'keep.txt');
  r = await call('POST', '/files', { cookie: ownSession, form });
  const kept = r.data[0];

  r = await call('DELETE', `/users/${outsider.data.id}`, { cookie: adminCookie });
  assert.equal(r.status, 204);
  r = await call('GET', `/files/${kept.id}`, { cookie: adminCookie });
  assert.equal(r.status, 200, 'the document survives the login');
  assert.equal(r.data.uploaded_by_email, null);
  assert.equal(r.data.uploaded_by, null);
  r = await login('temp@example.com', 'temp-chosen-1');
  assert.equal(r.status, 401);
});

test('an install created before roles upgrades in place and keeps its data', () => {
  const upgradeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docukaksh-upgrade-'));
  const dbPath = path.join(upgradeDir, 'docukaksh.db');
  const old = new DatabaseSync(dbPath);
  old.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE persons (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#4f46e5', created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE folders (id INTEGER PRIMARY KEY, person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
      parent_id INTEGER REFERENCES folders(id) ON DELETE CASCADE, name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE files (id INTEGER PRIMARY KEY, person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
      folder_id INTEGER REFERENCES folders(id) ON DELETE CASCADE, name TEXT NOT NULL, stored_name TEXT NOT NULL UNIQUE,
      mime_type TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO users (email, password_hash) VALUES ('first@example.com', 'x'), ('second@example.com', 'x');
    INSERT INTO persons (user_id, name) VALUES (1, 'Kept person');
    INSERT INTO files (person_id, name, stored_name, mime_type, size, sha256) VALUES (1, 'a.pdf', 'abc', 'application/pdf', 3, 'h');
  `);
  old.close();

  const upgraded = openDatabase(dbPath);
  const users = upgraded.prepare('SELECT email, role, active, must_change_password FROM users ORDER BY id').all();
  assert.deepEqual(users.map((u) => [u.email, u.role, u.active, u.must_change_password]), [
    ['first@example.com', 'super_admin', 1, 0],
    ['second@example.com', 'user', 1, 0],
  ]);
  assert.equal(upgraded.prepare('SELECT name FROM persons').get().name, 'Kept person');
  assert.equal(upgraded.prepare('SELECT user_id FROM person_access').get().user_id, 1, 'the creator keeps access');
  const file = upgraded.prepare('SELECT uploaded_by, doc_created_at FROM files').get();
  assert.equal(file.uploaded_by, 1, 'old files are attributed to the person creator');
  assert.ok(file.doc_created_at, 'old files get a created date');
  upgraded.close();
  fs.rmSync(upgradeDir, { recursive: true, force: true });
});
