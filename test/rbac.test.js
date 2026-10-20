import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
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

async function login(email, password) {
  return call('POST', '/auth/login', { body: { email, password } });
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docukaksh-rbac-'));
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

test('the first account is the super admin', async () => {
  const r = await call('POST', '/auth/setup', { body: { email: 'boss@example.com', password: 'bosspass1' } });
  assert.equal(r.status, 201);
  assert.equal(r.data.role, 'super_admin');
  adminCookie = cookieFrom(r.res);

  const status = await call('GET', '/auth/status', { cookie: adminCookie });
  assert.equal(status.data.user.role, 'super_admin');
  assert.ok(status.data.user.permissions.includes('users:manage'));
});

test('super admin creates users, regular users cannot manage accounts', async () => {
  let r = await call('POST', '/users', {
    cookie: adminCookie,
    body: { email: 'member@example.com', password: 'memberpass', role: 'user' },
  });
  assert.equal(r.status, 201);
  assert.equal(r.data.role, 'user');
  const memberId = r.data.id;

  r = await login('member@example.com', 'memberpass');
  assert.equal(r.status, 200);
  const memberCookie = cookieFrom(r.res);

  r = await call('GET', '/users', { cookie: memberCookie });
  assert.equal(r.status, 403);
  r = await call('POST', '/users', {
    cookie: memberCookie,
    body: { email: 'sneaky@example.com', password: 'sneakypass' },
  });
  assert.equal(r.status, 403);
  r = await call('PATCH', `/users/${memberId}`, { cookie: memberCookie, body: { role: 'super_admin' } });
  assert.equal(r.status, 403, 'a user cannot promote themselves');

  const status = await call('GET', '/auth/status', { cookie: memberCookie });
  assert.deepEqual(status.data.user.permissions, ['documents']);

  r = await call('POST', '/users', { cookie: adminCookie, body: { email: 'member@example.com', password: 'memberpass' } });
  assert.equal(r.status, 409, 'duplicate emails are rejected');
});

test('documents are private to each account', async () => {
  let r = await call('POST', '/persons', { cookie: adminCookie, body: { name: 'Admin family' } });
  assert.equal(r.status, 201);

  r = await login('member@example.com', 'memberpass');
  const memberCookie = cookieFrom(r.res);
  r = await call('GET', '/persons', { cookie: memberCookie });
  assert.deepEqual(r.data, [], 'the member must not see the admin\'s persons');

  r = await call('POST', '/persons', { cookie: memberCookie, body: { name: 'Member person' } });
  assert.equal(r.status, 201);
  const memberPersonId = r.data.id;

  r = await call('GET', `/persons/${memberPersonId}/browse`, { cookie: adminCookie });
  assert.equal(r.status, 404, 'the super admin cannot browse another account\'s documents');
});

test('disabling an account revokes access immediately, re-enabling restores it', async () => {
  const { data: users } = await call('GET', '/users', { cookie: adminCookie });
  const member = users.find((u) => u.email === 'member@example.com');

  let r = await login('member@example.com', 'memberpass');
  const memberCookie = cookieFrom(r.res);

  r = await call('PATCH', `/users/${member.id}`, { cookie: adminCookie, body: { active: false } });
  assert.equal(r.status, 200);
  assert.equal(r.data.active, 0);

  r = await call('GET', '/persons', { cookie: memberCookie });
  assert.equal(r.status, 401, 'the existing session must stop working');
  r = await login('member@example.com', 'memberpass');
  assert.equal(r.status, 401, 'a disabled account cannot sign in');

  r = await call('PATCH', `/users/${member.id}`, { cookie: adminCookie, body: { active: true } });
  assert.equal(r.status, 200);
  r = await login('member@example.com', 'memberpass');
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

test('users can change their own password, which signs out other sessions', async () => {
  let r = await login('member@example.com', 'memberpass');
  const oldCookie = cookieFrom(r.res);

  r = await call('POST', '/auth/password', { cookie: oldCookie, body: { current: 'wrong', password: 'newmemberpass' } });
  assert.equal(r.status, 400);

  r = await call('POST', '/auth/password', { cookie: oldCookie, body: { current: 'memberpass', password: 'newmemberpass' } });
  assert.equal(r.status, 204);
  const freshCookie = cookieFrom(r.res);

  r = await call('GET', '/persons', { cookie: oldCookie });
  assert.equal(r.status, 401);
  r = await call('GET', '/persons', { cookie: freshCookie });
  assert.equal(r.status, 200);
  r = await login('member@example.com', 'memberpass');
  assert.equal(r.status, 401);
});

test('the super admin can reset another user\'s password', async () => {
  const { data: users } = await call('GET', '/users', { cookie: adminCookie });
  const member = users.find((u) => u.email === 'member@example.com');

  let r = await call('POST', `/users/${member.id}/password`, { cookie: adminCookie, body: { password: 'resetpass1' } });
  assert.equal(r.status, 204);

  r = await login('member@example.com', 'newmemberpass');
  assert.equal(r.status, 401);
  r = await login('member@example.com', 'resetpass1');
  assert.equal(r.status, 200);
});

test('deleting a user removes their documents from storage', async () => {
  let r = await login('member@example.com', 'resetpass1');
  const memberCookie = cookieFrom(r.res);
  r = await call('POST', '/persons', { cookie: memberCookie, body: { name: 'Doomed' } });
  const person = r.data;

  const form = new FormData();
  form.append('person_id', String(person.id));
  form.append('files', new Blob(['bye']), 'bye.txt');
  r = await call('POST', '/files', { cookie: memberCookie, form });
  const storedName = db.prepare('SELECT stored_name FROM files WHERE id = ?').get(r.data[0].id).stored_name;
  const onDisk = path.join(dataDir, 'uploads', storedName);
  assert.ok(fs.existsSync(onDisk));

  const { data: users } = await call('GET', '/users', { cookie: adminCookie });
  const member = users.find((u) => u.email === 'member@example.com');
  r = await call('DELETE', `/users/${member.id}`, { cookie: adminCookie });
  assert.equal(r.status, 204);
  assert.equal(fs.existsSync(onDisk), false);

  r = await call('GET', '/users', { cookie: adminCookie });
  assert.deepEqual(r.data.map((u) => u.email), ['boss@example.com']);
});

test('upgrading an install created before roles keeps its data and makes the first account admin', () => {
  const upgradeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docukaksh-upgrade-'));
  const dbPath = path.join(upgradeDir, 'docukaksh.db');
  const old = new DatabaseSync(dbPath);
  old.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE persons (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#4f46e5', created_at TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO users (email, password_hash) VALUES ('first@example.com', 'x'), ('second@example.com', 'x');
    INSERT INTO persons (user_id, name) VALUES (1, 'Kept person');
  `);
  old.close();

  const upgraded = openDatabase(dbPath);
  const users = upgraded.prepare('SELECT email, role, active FROM users ORDER BY id').all();
  assert.deepEqual(users.map((u) => [u.email, u.role, u.active]), [
    ['first@example.com', 'super_admin', 1],
    ['second@example.com', 'user', 1],
  ]);
  assert.equal(upgraded.prepare('SELECT name FROM persons').get().name, 'Kept person');
  upgraded.close();
  fs.rmSync(upgradeDir, { recursive: true, force: true });
});
