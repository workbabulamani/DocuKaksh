import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { createVault } from '../src/vault.js';
import { loadConfig } from '../src/config.js';

const KEY = crypto.randomBytes(32);

let server;
let db;
let base;
let dataDir;
let close;
let admin = '';
const sessions = {};

async function call(method, url, { body, form, as = '' } = {}) {
  const headers = {};
  const cookie = as ? sessions[as] : admin;
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
const storedName = (fileId) => db.prepare('SELECT stored_name FROM files WHERE id = ?').get(fileId).stored_name;

function uploadForm(personId, { folderId, name, body = 'hello', description, tags } = {}) {
  const form = new FormData();
  form.append('person_id', String(personId));
  if (folderId) form.append('folder_id', String(folderId));
  if (description) form.append('description', description);
  if (tags) form.append('tags', tags);
  form.append('files', new Blob([body], { type: 'text/plain' }), name);
  return form;
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docukaksh-security-'));
  const created = createApp({ dataDir, encryptionKey: KEY, loginMaxFailures: 3, loginLockMinutes: 15 });
  db = created.db;
  close = created.close;
  await new Promise((resolve) => {
    server = created.app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;

  const r = await call('POST', '/auth/setup', { body: { email: 'admin@example.com', password: 'adminpass1' } });
  admin = cookieFrom(r.res);
});

after(() => {
  close();
  server.close();
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('uploaded files are encrypted on disk; downloads still return the original bytes', async () => {
  const r = await call('POST', '/persons', { body: { name: 'Papa' } });
  const person = r.data;
  const secret = 'secret-passport-number-123456';
  const up = await call('POST', '/files', { form: uploadForm(person.id, { name: 'passport.txt', body: secret }) });
  const fileId = up.data[0].id;

  const onDisk = fs.readFileSync(path.join(dataDir, 'uploads', storedName(fileId)));
  assert.equal(onDisk.includes(Buffer.from(secret)), false, 'the plaintext must not be on disk');

  const dl = await call('GET', `/files/${fileId}/content?download=1`);
  assert.equal(dl.data, secret);
});

test('the database and uploads folder are the only places data is written; nothing is left in incoming', () => {
  assert.equal(fs.readdirSync(path.join(dataDir, 'incoming')).length, 0);
});

test('a tampered encrypted file is refused rather than served', async () => {
  const r = await call('POST', '/persons', { body: { name: 'Tamper test' } });
  const up = await call('POST', '/files', { form: uploadForm(r.data.id, { name: 'x.txt', body: 'original' }) });
  const fileId = up.data[0].id;
  const blob = path.join(dataDir, 'uploads', storedName(fileId));
  const bytes = fs.readFileSync(blob);
  bytes[bytes.length - 5] ^= 0xff;
  fs.writeFileSync(blob, bytes);
  const dl = await call('GET', `/files/${fileId}/content?download=1`);
  assert.equal(dl.status, 500);
  assert.equal(dl.data.error, 'This file could not be read from storage');
});

test('sharing: view allows reading, edit allows changing, dropbox allows uploading only', async () => {
  let r = await call('POST', '/persons', { body: { name: 'Shared family' } });
  const person = r.data;
  r = await call('POST', '/folders', { body: { person_id: person.id, name: 'Bills', icon: 'receipt' } });
  const bills = r.data;
  r = await call('POST', '/folders', { body: { parent_id: bills.id, name: 'Electricity' } });
  const sub = r.data;
  r = await call('POST', '/folders', { body: { person_id: person.id, name: 'Private' } });
  const priv = r.data;
  await call('POST', '/files', { form: uploadForm(person.id, { folderId: bills.id, name: 'bill-jan.txt', body: 'jan' }) });

  r = await call('POST', '/users', {
    body: { email: 'helper@example.com', password: 'helperpass1', role: 'user', personIds: [] },
  });
  const helper = r.data;
  r = await call('POST', '/auth/login', { body: { email: 'helper@example.com', password: 'helperpass1' } });
  sessions.helper = cookieFrom(r.res);
  await call('POST', '/auth/password', { as: 'helper', body: { current: 'helperpass1', password: 'helper-chosen-1' } });
  r = await call('POST', '/auth/login', { body: { email: 'helper@example.com', password: 'helper-chosen-1' } });
  sessions.helper = cookieFrom(r.res);

  // Before sharing, the helper sees nothing.
  r = await call('GET', `/folders/${bills.id}/browse`, { as: 'helper' });
  assert.equal(r.status, 404);

  // View share on Bills: the helper can read it and the subfolder inside, but not the sibling.
  r = await call('POST', '/shares', { body: { kind: 'folder', id: bills.id, user_id: helper.id, permission: 'view' } });
  assert.equal(r.status, 201);
  r = await call('GET', `/folders/${bills.id}/browse`, { as: 'helper' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.files.map((f) => f.name), ['bill-jan.txt']);
  assert.deepEqual(r.data.breadcrumb.map((c) => c.name), ['Bills'], 'folders above the share stay hidden');
  r = await call('GET', `/folders/${sub.id}/browse`, { as: 'helper' });
  assert.equal(r.status, 200, 'subfolders inherit the share');
  r = await call('GET', `/folders/${priv.id}/browse`, { as: 'helper' });
  assert.equal(r.status, 404, 'a sibling folder is not shared');

  // View cannot change anything.
  r = await call('PATCH', `/folders/${bills.id}`, { as: 'helper', body: { name: 'Renamed' } });
  assert.equal(r.status, 404);
  r = await call('POST', '/folders', { as: 'helper', body: { parent_id: bills.id, name: 'Nope' } });
  assert.equal(r.status, 404);

  // Upgrade to edit: the helper can now rename and upload.
  r = await call('POST', '/shares', { body: { kind: 'folder', id: bills.id, user_id: helper.id, permission: 'edit' } });
  assert.equal(r.status, 201, 'sharing again updates the permission');
  r = await call('PATCH', `/folders/${sub.id}`, { as: 'helper', body: { name: 'Power' } });
  assert.equal(r.status, 200);
  r = await call('POST', '/files', { as: 'helper', form: uploadForm(person.id, { folderId: sub.id, name: 'bill-feb.txt', body: 'feb' }) });
  assert.equal(r.status, 201);
  assert.equal(r.data[0].uploaded_by_email, 'helper@example.com');

  // Drop-box on Private: uploads allowed, listing refused with a clear reason.
  await call('POST', '/shares', { body: { kind: 'folder', id: priv.id, user_id: helper.id, permission: 'dropbox' } });
  r = await call('POST', '/files', { as: 'helper', form: uploadForm(person.id, { folderId: priv.id, name: 'for-you.txt', body: 'drop' }) });
  assert.equal(r.status, 201, 'a drop-box accepts uploads');
  r = await call('GET', `/folders/${priv.id}/browse`, { as: 'helper' });
  assert.equal(r.status, 403);
  assert.equal(r.data.code, 'DROPBOX');

  // Shared-with-me lists both shares.
  r = await call('GET', '/shared', { as: 'helper' });
  assert.deepEqual(r.data.map((s) => `${s.name}:${s.permission}`).sort(), ['Bills:edit', 'Private:dropbox']);

  // The helper cannot see the person itself.
  r = await call('GET', '/persons', { as: 'helper' });
  assert.equal(r.data.length, 0);
});

test('a file can be shared on its own, and revoking a share removes access at once', async () => {
  const r = await call('POST', '/persons', { body: { name: 'Single file' } });
  const up = await call('POST', '/files', { form: uploadForm(r.data.id, { name: 'contract.txt', body: 'terms' }) });
  const fileId = up.data[0].id;
  const { data: users } = await call('GET', '/share-users');
  const helper = users.find((u) => u.email === 'helper@example.com');

  let res = await call('POST', '/shares', { body: { kind: 'file', id: fileId, user_id: helper.id, permission: 'view' } });
  assert.equal(res.status, 201);
  res = await call('GET', `/files/${fileId}`, { as: 'helper' });
  assert.equal(res.status, 200);
  res = await call('GET', `/files/${fileId}/content?download=1`, { as: 'helper' });
  assert.equal(res.data, 'terms');

  const { data: shares } = await call('GET', `/shares?kind=file&id=${fileId}`);
  res = await call('DELETE', `/shares/${shares[0].id}`);
  assert.equal(res.status, 204);
  res = await call('GET', `/files/${fileId}`, { as: 'helper' });
  assert.equal(res.status, 404);
});

test('sharing with yourself or with a missing user is refused; permission must be known', async () => {
  const r = await call('POST', '/persons', { body: { name: 'Guard' } });
  const up = await call('POST', '/files', { form: uploadForm(r.data.id, { name: 'g.txt' }) });
  const { data: users } = await call('GET', '/share-users');
  const me = (await call('GET', '/auth/status')).data.user;
  let res = await call('POST', '/shares', { body: { kind: 'file', id: up.data[0].id, user_id: me.id, permission: 'view' } });
  assert.equal(res.status, 400);
  res = await call('POST', '/shares', { body: { kind: 'file', id: up.data[0].id, user_id: 999999, permission: 'view' } });
  assert.equal(res.status, 404);
  res = await call('POST', '/shares', { body: { kind: 'file', id: up.data[0].id, user_id: users[0].id, permission: 'owner' } });
  assert.equal(res.status, 400);
});

test('the audit log records sharing, uploads and downloads, and only the super admin can read it', async () => {
  const { data: entries } = await call('GET', '/admin/audit');
  const actions = new Set(entries.map((e) => e.action));
  for (const expected of ['file.upload', 'file.download', 'share.create', 'share.revoke', 'user.create', 'auth.login']) {
    assert.ok(actions.has(expected), `audit should contain ${expected}`);
  }
  const helper = (await call('GET', '/share-users')).data.find((u) => u.email === 'helper@example.com');
  const onlyHelperActions = await call('GET', `/admin/audit?user_id=${helper.id}`);
  assert.ok(onlyHelperActions.data.every((e) => e.user_email === 'helper@example.com'));

  const denied = await call('GET', '/admin/audit', { as: 'helper' });
  assert.equal(denied.status, 403);
});

test('repeated failed sign-ins lock the account for a while, even with the right password afterwards', async () => {
  const attempt = (password) => call('POST', '/auth/login', { body: { email: 'admin@example.com', password } });
  // The limit is 3 in this test instance.
  await attempt('wrong-1');
  await attempt('wrong-2');
  const third = await attempt('wrong-3');
  assert.equal(third.status, 401);
  const locked = await attempt('adminpass1');
  assert.equal(locked.status, 429);
  assert.match(locked.data.error, /Try again in \d+ minute/);
});

test('a preference is saved per account and unknown values are refused', async () => {
  let r = await call('PATCH', '/auth/me', { body: { text_size: 'xlarge', contrast: 'high', density: 'compact', theme: 'nord' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { theme: 'nord', text_size: 'xlarge', contrast: 'high', density: 'compact', accent_primary: '', accent_secondary: '', language: 'en', page_size: 50 });
  r = await call('GET', '/auth/status');
  assert.equal(r.data.user.contrast, 'high');
  r = await call('PATCH', '/auth/me', { body: { density: 'cosy' } });
  assert.equal(r.status, 400);
  await call('PATCH', '/auth/me', { body: { theme: 'day', text_size: 'normal', contrast: 'normal', density: 'comfortable' } });
});

test('folder icons are checked; descriptions are saved on persons, folders and files', async () => {
  let r = await call('POST', '/persons', { body: { name: 'Described', description: 'Dad\'s documents' } });
  const person = r.data;
  assert.equal(person.description, 'Dad\'s documents');
  r = await call('POST', '/folders', { body: { person_id: person.id, name: 'Car', icon: 'not-an-icon' } });
  assert.equal(r.status, 400);
  r = await call('POST', '/folders', { body: { person_id: person.id, name: 'Car', icon: 'car', description: 'Insurance too' } });
  assert.equal(r.data.icon, 'car');
  assert.equal(r.data.description, 'Insurance too');
  const folder = r.data;
  r = await call('PATCH', `/folders/${folder.id}`, { body: { icon: 'medical' } });
  assert.equal(r.data.icon, 'medical');

  const up = await call('POST', '/files', { form: uploadForm(person.id, { folderId: folder.id, name: 'policy.txt', description: 'Renews in March' }) });
  assert.equal(up.data[0].description, 'Renews in March');
  r = await call('PATCH', `/files/${up.data[0].id}`, { body: { description: 'Renewed', expires_on: '2026-11-01' } });
  assert.equal(r.data.description, 'Renewed');
  assert.equal(r.data.expires_on, '2026-11-01');
  r = await call('PATCH', `/files/${up.data[0].id}`, { body: { expires_on: 'next tuesday' } });
  assert.equal(r.status, 400);
});

test('stars are personal, and duplicates are reported on upload and in the duplicates list', async () => {
  const r = await call('POST', '/persons', { body: { name: 'Dupes' } });
  const person = r.data;
  const first = await call('POST', '/files', { form: uploadForm(person.id, { name: 'a.txt', body: 'same content' }) });
  const second = await call('POST', '/files', { form: uploadForm(person.id, { name: 'b.txt', body: 'same content' }) });
  assert.equal(second.data[0].duplicates.length, 1);
  assert.equal(second.data[0].duplicates[0].id, first.data[0].id);

  const groups = await call('GET', '/duplicates');
  assert.ok(groups.data.some((g) => g.copies === 2));

  let res = await call('PUT', '/stars', { body: { kind: 'file', id: first.data[0].id, starred: true } });
  assert.equal(res.status, 204);
  res = await call('GET', '/starred');
  assert.deepEqual(res.data.map((i) => i.name), ['a.txt']);
  res = await call('PUT', '/stars', { body: { kind: 'file', id: first.data[0].id, starred: false } });
  res = await call('GET', '/starred');
  assert.equal(res.data.length, 0);
});

test('the dashboard reports persons, storage, upcoming expiries and recent activity', async () => {
  const r = await call('GET', '/dashboard');
  assert.ok(Array.isArray(r.data.persons));
  assert.ok(r.data.storage_bytes > 0);
  assert.ok(r.data.activity.length > 0);
  const soon = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const { data: persons } = await call('GET', '/persons');
  const up = await call('POST', '/files', { form: uploadForm(persons[0].id, { name: 'insurance.txt' }) });
  await call('PATCH', `/files/${up.data[0].id}`, { body: { expires_on: soon } });
  const after = await call('GET', '/dashboard');
  assert.ok(after.data.expiring.some((f) => f.name === 'insurance.txt'));
});

test('health and metrics are for the super admin only and report disk, counts and errors', async () => {
  const r = await call('GET', '/admin/health');
  assert.equal(r.status, 200);
  assert.ok(r.data.disk.free_bytes > 0);
  assert.ok(r.data.counts.files > 0);
  assert.equal(typeof r.data.storage.files_bytes, 'number');
  const denied = await call('GET', '/admin/health', { as: 'helper' });
  assert.equal(denied.status, 403);
});

test('the environment must supply a 32-byte encryption key, and the vault refuses wrong keys', () => {
  assert.throws(() => loadConfig({ ENCRYPTION_KEY: 'short' }), /32 random bytes/);
  assert.equal(loadConfig({}).encryptionKey, null);
  const good = loadConfig({ ENCRYPTION_KEY: KEY.toString('base64'), DATA_DIR: '/x' });
  assert.ok(good.encryptionKey.equals(KEY));
  const vault = createVault(crypto.randomBytes(32));
  const other = createVault(crypto.randomBytes(32));
  const file = path.join(os.tmpdir(), `vault-${Date.now()}.bin`);
  vault.encryptBuffer(file, Buffer.from('private'));
  assert.throws(() => other.decryptBuffer(file), /integrity/);
  fs.rmSync(file);
});

test('files stored before encryption existed are encrypted on the next start', async () => {
  const oldDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docukaksh-migrate-'));
  const first = createApp({ dataDir: oldDir, encryptionKey: KEY });
  const { DatabaseSync } = await import('node:sqlite');
  const raw = new DatabaseSync(path.join(oldDir, 'docukaksh.db'));
  raw.prepare("INSERT INTO persons (user_id, name) VALUES (NULL, 'Old')").run();
  raw.prepare(`INSERT INTO files (person_id, name, stored_name, mime_type, size, sha256, encrypted)
    VALUES (1, 'old.txt', 'legacy-blob', 'text/plain', 15, 'h', 0)`).run();
  raw.close();
  fs.writeFileSync(path.join(oldDir, 'uploads', 'legacy-blob'), 'legacy content!');
  first.close();
  first.db.close();

  const second = createApp({ dataDir: oldDir, encryptionKey: KEY });
  const row = second.db.prepare("SELECT encrypted FROM files WHERE stored_name = 'legacy-blob'").get();
  assert.equal(row.encrypted, 1);
  assert.equal(fs.readFileSync(path.join(oldDir, 'uploads', 'legacy-blob')).includes(Buffer.from('legacy content')), false);
  assert.equal(createVault(KEY).decryptBuffer(path.join(oldDir, 'uploads', 'legacy-blob')).toString(), 'legacy content!');
  second.close();
  second.db.close();
  fs.rmSync(oldDir, { recursive: true, force: true });
});

test('items in the recycle bin older than the retention period are removed on the next start', async () => {
  const bDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docukaksh-bin-'));
  const first = createApp({ dataDir: bDir, encryptionKey: KEY, recycleRetentionDays: 7 });
  const srv = await new Promise((resolve) => {
    const s = first.app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const url = `http://127.0.0.1:${srv.address().port}/api`;
  let res = await fetch(`${url}/auth/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'bin@example.com', password: 'binpass123' }) });
  const cookie = res.headers.get('set-cookie').split(';')[0];
  res = await fetch(`${url}/persons`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'Bin' }) });
  const person = await res.json();
  const form = new FormData();
  form.append('person_id', String(person.id));
  form.append('files', new Blob(['old']), 'old.txt');
  res = await fetch(`${url}/files`, { method: 'POST', headers: { cookie }, body: form });
  const [file] = await res.json();
  await fetch(`${url}/files/${file.id}`, { method: 'DELETE', headers: { cookie } });
  const blob = path.join(bDir, 'uploads', first.db.prepare('SELECT stored_name FROM files WHERE id = ?').get(file.id).stored_name);
  assert.ok(fs.existsSync(blob));
  first.db.prepare('UPDATE files SET deleted_at = ? WHERE id = ?').run(new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString(), file.id);
  srv.close();
  first.close();
  first.db.close();

  const second = createApp({ dataDir: bDir, encryptionKey: KEY, recycleRetentionDays: 7 });
  assert.equal(second.db.prepare('SELECT COUNT(*) AS c FROM files WHERE id = ?').get(file.id).c, 0);
  assert.equal(fs.existsSync(blob), false, 'the stored blob is removed too');
  second.close();
  second.db.close();
  fs.rmSync(bDir, { recursive: true, force: true });
});

test('accent colours are saved per account; anything other than #rrggbb or empty is refused', async () => {
  let r = await call('PATCH', '/auth/me', { body: { accent_primary: '#0d9488', accent_secondary: '#5eead4' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.accent_primary, '#0d9488');
  r = await call('GET', '/auth/status');
  assert.equal(r.data.user.accent_secondary, '#5eead4');
  r = await call('PATCH', '/auth/me', { body: { accent_primary: 'red' } });
  assert.equal(r.status, 400);
  r = await call('PATCH', '/auth/me', { body: { accent_primary: '' } });
  assert.equal(r.data.accent_primary, '', 'empty means use the theme colour');
  r = await call('PATCH', '/auth/me', { body: { theme: 'material-ocean' } });
  assert.equal(r.status, 200, 'the new themes are accepted');
  await call('PATCH', '/auth/me', { body: { theme: 'day' } });
});
