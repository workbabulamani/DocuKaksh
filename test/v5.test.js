import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { createApp } from '../src/app.js';
import { codeAt } from '../src/totp.js';

const KEY = crypto.randomBytes(32);
let dataDir;
let backupDir;
let app;
let server;
let base;
let db;
let close;
let admin = '';

function start() {
  const created = createApp({ dataDir, encryptionKey: KEY, backupDir, loginMaxFailures: 1000 });
  app = created.app;
  db = created.db;
  close = created.close;
  return new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
}

function stop() {
  close();
  server.close();
  db.close();
}

async function call(method, url, { body, form, cookie = admin, raw = false } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${base}/api${url}`, { method, headers, body: payload });
  if (raw) return { status: res.status, res, buffer: Buffer.from(await res.arrayBuffer()) };
  const text = await res.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {
    // Non-JSON responses are returned as text.
  }
  return { status: res.status, data, res };
}

const cookieFrom = (res) => res.headers.get('set-cookie')?.split(';')[0] ?? '';
const currentCode = (secret) => codeAt(secret, Math.floor(Date.now() / 30000));

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docukaksh-v5-'));
  backupDir = path.join(dataDir, 'backup-store');
  await start();
  const r = await call('POST', '/auth/setup', { body: { email: 'owner@example.com', password: 'ownerpass1' }, cookie: '' });
  admin = cookieFrom(r.res);
});

after(() => {
  stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('profile details and language and page size are saved per account', async () => {
  let r = await call('PATCH', '/auth/profile', { body: { first_name: '  Sagar ', last_name: 'Lamani', phone: '+91 98765 43210', organisation: 'Tieto' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.first_name, 'Sagar');
  r = await call('PATCH', '/auth/me', { body: { language: 'hi', page_size: 25 } });
  assert.equal(r.status, 200);
  r = await call('PATCH', '/auth/me', { body: { language: 'klingon' } });
  assert.equal(r.status, 400);
  r = await call('PATCH', '/auth/me', { body: { page_size: 31 } });
  assert.equal(r.status, 400, 'page size must be one of the offered sizes');
  r = await call('GET', '/auth/status');
  assert.equal(r.data.user.first_name, 'Sagar');
  assert.equal(r.data.user.language, 'hi');
  assert.equal(r.data.user.page_size, 25);
  r = await call('PATCH', '/auth/me', { body: { theme: 'lime' } });
  assert.equal(r.status, 200, 'the lime theme is offered');
});

test('two-factor sign-in: set up with a QR code, confirm, sign in with a code, remember the browser', async () => {
  let r = await call('POST', '/auth/2fa/setup', {});
  assert.equal(r.status, 200);
  assert.match(r.data.qr, /<svg/, 'a QR code is returned for scanning');
  assert.match(r.data.uri, /^otpauth:\/\/totp\/DocuKaksh/);
  const secret = r.data.secret;
  assert.match(secret, /^[A-Z2-7]{32}$/, 'the secret is also shown for manual entry');

  r = await call('POST', '/auth/2fa/enable', { body: { code: '000000' } });
  assert.equal(r.status, 400, 'a wrong code does not turn it on');
  // Confirm with the previous window's code: a code is accepted only once, so the current one is kept for sign-in.
  r = await call('POST', '/auth/2fa/enable', { body: { code: codeAt(secret, Math.floor(Date.now() / 30000) - 1) } });
  assert.equal(r.status, 200);
  r = await call('GET', '/auth/status');
  assert.equal(r.data.user.twoFactor, true);

  // A new sign-in now needs the code.
  r = await call('POST', '/auth/login', { body: { email: 'owner@example.com', password: 'ownerpass1' }, cookie: '' });
  assert.equal(r.data.totpRequired, true);
  assert.equal(cookieFrom(r.res), '', 'no session before the code is entered');
  const pending = r.data.pendingToken;

  r = await call('POST', '/auth/login/totp', { body: { pendingToken: pending, code: '123456' }, cookie: '' });
  assert.equal(r.status, 401, 'a wrong code is refused');

  const code = currentCode(secret);
  r = await call('POST', '/auth/login', { body: { email: 'owner@example.com', password: 'ownerpass1' }, cookie: '' });
  const second = r.data.pendingToken;
  r = await call('POST', '/auth/login/totp', { body: { pendingToken: second, code }, cookie: '' });
  assert.equal(r.status, 200, 'the right code signs in: ' + JSON.stringify(r.data) + ' step ' + Math.floor(Date.now()/30000));
  const session = cookieFrom(r.res);

  // The same code cannot be used twice.
  r = await call('POST', '/auth/login', { body: { email: 'owner@example.com', password: 'ownerpass1' }, cookie: '' });
  r = await call('POST', '/auth/login/totp', { body: { pendingToken: r.data.pendingToken, code }, cookie: '' });
  assert.equal(r.status, 401, 'a used code is refused, so it cannot be replayed');

  // Remember this browser: the next sign-in skips the code, until the trust expires.
  r = await call('POST', '/auth/login', { body: { email: 'owner@example.com', password: 'ownerpass1' }, cookie: '' });
  const pending3 = r.data.pendingToken;
  const nextWindow = codeAt(secret, Math.floor(Date.now() / 30000) + 1);
  r = await call('POST', '/auth/login/totp', { body: { pendingToken: pending3, code: nextWindow, remember: true }, cookie: '' });
  assert.equal(r.status, 200);
  const deviceCookie = r.res.headers.get('set-cookie').split(';')[0];
  assert.match(deviceCookie, /^dk_device=/, 'the browser is remembered');
  r = await call('POST', '/auth/logout', { cookie: session });
  r = await call('POST', '/auth/login', { body: { email: 'owner@example.com', password: 'ownerpass1' }, cookie: deviceCookie });
  assert.equal(r.data.totpRequired, undefined, 'a remembered browser is not asked for a code');
  assert.equal(r.status, 200);
  admin = cookieFrom(r.res);
});

test('turning two-factor sign-in off needs the password', async () => {
  let r = await call('POST', '/auth/2fa/disable', { body: { password: 'wrong' } });
  assert.equal(r.status, 400);
  r = await call('POST', '/auth/2fa/disable', { body: { password: 'ownerpass1' } });
  assert.equal(r.status, 200);
  r = await call('GET', '/auth/status');
  assert.equal(r.data.user.twoFactor, false);
  r = await call('POST', '/auth/login', { body: { email: 'owner@example.com', password: 'ownerpass1' }, cookie: '' });
  assert.equal(r.status, 200, 'sign-in is back to password only');
  admin = cookieFrom(r.res);
});

test('backups: manual backup, schedule checks, zip download', async () => {
  let r = await call('PUT', '/admin/backups/schedule', { body: { mode: 'sometimes' } });
  assert.equal(r.status, 400);
  r = await call('PUT', '/admin/backups/schedule', { body: { mode: 'daily', time: '25:00', keep: 7 } });
  assert.equal(r.status, 400);
  r = await call('PUT', '/admin/backups/schedule', { body: { mode: 'weekly', time: '03:30', weekday: 0, keep: 3 } });
  assert.equal(r.status, 200);
  assert.equal(r.data.mode, 'weekly');

  const person = (await call('POST', '/persons', { body: { name: 'Backed up' } })).data;
  const form = new FormData();
  form.append('person_id', String(person.id));
  form.append('files', new Blob(['keep this file']), 'keep.txt');
  await call('POST', '/files', { form });

  r = await call('POST', '/admin/backups', {});
  assert.equal(r.status, 201);
  const id = r.data.id;
  r = await call('GET', '/admin/backups');
  assert.equal(r.data.backups.length, 1);
  assert.ok(fs.existsSync(path.join(backupDir, id, 'docukaksh.db')));
  assert.ok(fs.readdirSync(path.join(backupDir, id, 'uploads')).length >= 1);

  r = await call('GET', `/admin/backups/${id}/download`, { raw: true });
  assert.equal(r.status, 200);
  assert.equal(r.res.headers.get('content-type'), 'application/zip');
  assert.equal(r.buffer.subarray(0, 4).toString('hex'), '504b0304', 'a real zip file');
  const entries = unzipSync(new Uint8Array(r.buffer));
  const names = Object.keys(entries);
  assert.ok(names.some((n) => n.endsWith('docukaksh.db')), 'the database is in the zip');
  assert.ok(names.some((n) => n.includes('/uploads/')), 'the encrypted files are in the zip');
});

test('restore: needs the word RESTORE, and is applied when the app starts again', async () => {
  const r0 = await call('POST', '/admin/backups', {});
  const backupId = r0.data.id;
  const before = (await call('GET', '/persons')).data.map((p) => p.name);
  assert.ok(before.includes('Backed up'));

  // Change the data after the backup.
  await call('POST', '/persons', { body: { name: 'Added after backup' } });
  let r = await call('POST', `/admin/backups/${backupId}/restore`, { body: { confirm: 'yes' } });
  assert.equal(r.status, 400);
  r = await call('POST', `/admin/backups/${backupId}/restore`, { body: { confirm: 'RESTORE' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.restartRequired, true);
  assert.ok(fs.existsSync(path.join(dataDir, 'restore-pending.json')), 'the restore is staged');

  // Restart: the staged backup replaces the data, and the old data is kept aside.
  stop();
  await start();
  r = await call('POST', '/auth/login', { body: { email: 'owner@example.com', password: 'ownerpass1' }, cookie: '' });
  admin = cookieFrom(r.res);
  const names = (await call('GET', '/persons')).data.map((p) => p.name);
  assert.ok(names.includes('Backed up'));
  assert.ok(!names.includes('Added after backup'), 'data added after the backup is gone from the live data');
  const aside = fs.readdirSync(dataDir).filter((n) => n.startsWith('before-restore-'));
  assert.equal(aside.length, 1, 'the replaced data is kept, not deleted');
  assert.ok(!fs.existsSync(path.join(dataDir, 'restore-pending.json')));
});
