import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import {
  SESSION_COOKIE, createSession, deleteSession, deleteUserSessions, findSessionUser,
  hashPassword, verifyPassword,
} from './auth.js';
import { ROLES, THEMES, can, permissionsFor } from './permissions.js';
import { createDocumentsRouter } from './documents.js';
import { HttpError, badRequest, cleanEmail, cleanPassword, notFound, parseCookies, parseId } from './http.js';

// Paths a user may call while they still have to change their temporary password.
const PASSWORD_CHANGE_ALLOWED = new Set(['/auth/status', '/auth/password', '/auth/logout']);

const PREFERENCES = {
  theme: THEMES,
  text_size: ['normal', 'large', 'xlarge'],
  contrast: ['normal', 'high'],
  density: ['comfortable', 'compact'],
};

const cleanRole = (value) => {
  if (!ROLES.includes(value)) throw badRequest(`Role must be one of: ${ROLES.join(', ')}`);
  return value;
};

const randomPassword = () => crypto.randomBytes(9).toString('base64url');

const appVersion = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version;

const dirBytes = (dir) => {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const name of fs.readdirSync(dir)) {
    const stat = fs.statSync(path.join(dir, name));
    total += stat.isDirectory() ? dirBytes(path.join(dir, name)) : stat.size;
  }
  return total;
};

export function createApiRouter({ db, access, audit, vault, dataDir, incomingDir, previewsDir, cookieSecure, maxUploadBytes, loginMaxFailures, loginLockMinutes, recycleRetentionDays }) {
  const router = express.Router();
  router.use(express.json({ limit: '100kb' }));

  const requirePermission = (permission) => (req, _res, next) => {
    if (can(req.user, permission)) return next();
    next(new HttpError(403, 'You do not have permission to do that'));
  };

  const countUsers = () => db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  const clientIp = (req) => req.ip || req.socket.remoteAddress || 'unknown';

  const issueSession = (res, userId) => {
    const { token, expiresAt } = createSession(db, userId);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: cookieSecure,
      path: '/',
      expires: new Date(expiresAt),
    });
  };

  const setPassword = (userId, password, { mustChange = false } = {}) => {
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?')
      .run(hashPassword(password), mustChange ? 1 : 0, userId);
  };

  const getUser = (userId) => {
    const row = db.prepare(`
      SELECT u.id, u.email, u.role, u.active, u.must_change_password, u.created_at,
        (SELECT COUNT(*) FROM person_access pa WHERE pa.user_id = u.id) AS person_count
      FROM users u WHERE u.id = ?
    `).get(userId);
    if (!row) throw notFound('User not found');
    return row;
  };

  const activeSuperAdminCount = () =>
    db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'super_admin' AND active = 1").get().count;

  // Replaces a user's person assignments with the given list of alive person ids.
  const assignPersons = (userId, personIds) => {
    const ids = Array.isArray(personIds) ? personIds.map(parseId) : [];
    db.prepare('DELETE FROM person_access WHERE user_id = ?').run(userId);
    const link = db.prepare(`
      INSERT OR IGNORE INTO person_access (person_id, user_id)
      SELECT id, ? FROM persons WHERE id = ? AND deleted_at IS NULL
    `);
    for (const id of ids) link.run(userId, id);
  };

  // ---- Sign-in protection: failures are counted per account and per address -------

  const failureKeys = (email, ip) => [`email:${email}`, `ip:${ip}`];

  const lockedUntil = (keys) => Math.max(0, ...keys.map((key) => (
    db.prepare('SELECT locked_until FROM login_failures WHERE key = ?').get(key)?.locked_until ?? 0
  )));

  function registerFailure(key) {
    const row = db.prepare('SELECT failures FROM login_failures WHERE key = ?').get(key);
    const failures = (row?.failures ?? 0) + 1;
    const lock = failures >= loginMaxFailures ? Date.now() + loginLockMinutes * 60 * 1000 : 0;
    db.prepare('INSERT OR REPLACE INTO login_failures (key, failures, locked_until) VALUES (?, ?, ?)')
      .run(key, lock ? 0 : failures, lock);
  }

  const clearFailures = (keys) => {
    for (const key of keys) db.prepare('DELETE FROM login_failures WHERE key = ?').run(key);
  };

  // ---- Public: health, status, login, setup, recovery -------------------------

  router.get('/health', (_req, res) => res.json({ ok: true }));

  router.get('/auth/status', (req, res) => {
    const user = findSessionUser(db, parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    res.json({
      version: appVersion,
      setupRequired: countUsers() === 0,
      user: user && {
        id: user.id,
        email: user.email,
        role: user.role,
        theme: user.theme,
        text_size: user.text_size,
        contrast: user.contrast,
        density: user.density,
        mustChangePassword: user.must_change_password === 1,
        permissions: permissionsFor(user.role),
        pendingRequests: can(user, 'recovery:manage')
          ? db.prepare("SELECT COUNT(*) AS count FROM password_requests WHERE status = 'pending'").get().count
          : 0,
      },
    });
  });

  // Only available until the first account exists. That first account is the super admin.
  router.post('/auth/setup', (req, res) => {
    if (countUsers() > 0) throw new HttpError(409, 'Setup has already been completed');
    const email = cleanEmail(req.body?.email);
    const password = cleanPassword(req.body?.password);
    const { lastInsertRowid } = db.prepare("INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'super_admin')")
      .run(email, hashPassword(password));
    issueSession(res, Number(lastInsertRowid));
    audit.record({ id: Number(lastInsertRowid), email }, 'auth.setup');
    res.status(201).json({ id: Number(lastInsertRowid), email, role: 'super_admin' });
  });

  router.post('/auth/login', (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const keys = failureKeys(email || '(none)', clientIp(req));
    const until = lockedUntil(keys);
    if (until > Date.now()) {
      audit.record(null, 'auth.locked', { detail: email });
      const minutes = Math.ceil((until - Date.now()) / 60000);
      throw new HttpError(429, `Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
    }
    const user = email ? db.prepare('SELECT * FROM users WHERE email = ?').get(email) : undefined;
    // Disabled accounts get the same message as a wrong password, so account state is not revealed.
    if (!user || !user.active || !verifyPassword(password, user.password_hash)) {
      keys.forEach(registerFailure);
      audit.record(null, 'auth.failed', { detail: email });
      throw new HttpError(401, 'Invalid email or password');
    }
    clearFailures(keys);
    issueSession(res, user.id);
    audit.record(user, 'auth.login');
    res.json({ id: user.id, email: user.email, role: user.role, mustChangePassword: user.must_change_password === 1 });
  });

  router.post('/auth/logout', (req, res) => {
    const user = findSessionUser(db, parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    deleteSession(db, parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    if (user) audit.record(user, 'auth.logout');
    res.status(204).end();
  });

  // "Forgot password". Always answers the same way, so it cannot be used to find accounts.
  router.post('/auth/recovery', (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) : '';
    const user = email ? db.prepare('SELECT id FROM users WHERE email = ? AND active = 1').get(email) : undefined;
    if (user) {
      const pending = db.prepare("SELECT 1 FROM password_requests WHERE user_id = ? AND status = 'pending'").get(user.id);
      if (!pending) {
        db.prepare('INSERT INTO password_requests (user_id, note) VALUES (?, ?)').run(user.id, note);
        audit.record({ email }, 'recovery.request');
      }
    }
    res.status(202).json({
      message: 'If that account exists, a request has been sent to the super admin. They will contact you with a temporary password.',
    });
  });

  // ---- Authenticated -------------------------------------------------------------

  router.use((req, _res, next) => {
    const user = findSessionUser(db, parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    if (!user) return next(new HttpError(401, 'Not signed in'));
    req.user = user;
    if (user.must_change_password && !PASSWORD_CHANGE_ALLOWED.has(req.path)) {
      return next(new HttpError(403, 'Change your temporary password first', 'PASSWORD_CHANGE_REQUIRED'));
    }
    next();
  });

  router.post('/auth/password', (req, res) => {
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    const current = typeof req.body?.current === 'string' ? req.body.current : '';
    if (!verifyPassword(current, row.password_hash)) throw badRequest('Current password is incorrect');
    setPassword(req.user.id, cleanPassword(req.body?.password));
    // Changing the password signs out every other session, then gives this one a fresh token.
    deleteUserSessions(db, req.user.id);
    issueSession(res, req.user.id);
    audit.record(req.user, 'auth.password');
    res.status(204).end();
  });

  // Display preferences saved per account: theme, text size, contrast and density.
  router.patch('/auth/me', (req, res) => {
    for (const [field, allowed] of Object.entries(PREFERENCES)) {
      if (req.body?.[field] === undefined) continue;
      if (!allowed.includes(req.body[field])) throw badRequest(`Unknown ${field.replace('_', ' ')}`);
      db.prepare(`UPDATE users SET ${field} = ? WHERE id = ?`).run(req.body[field], req.user.id);
    }
    const row = db.prepare('SELECT theme, text_size, contrast, density FROM users WHERE id = ?').get(req.user.id);
    res.json(row);
  });

  // ---- User management (super admin) ------------------------------------------

  router.use('/users', requirePermission('users:manage'));

  router.get('/users', (_req, res) => {
    res.json(db.prepare(`
      SELECT u.id, u.email, u.role, u.active, u.must_change_password, u.created_at,
        (SELECT COUNT(*) FROM person_access pa WHERE pa.user_id = u.id) AS person_count,
        (SELECT COUNT(*) FROM files f WHERE f.uploaded_by = u.id AND f.deleted_at IS NULL) AS file_count,
        (SELECT group_concat(pa.person_id) FROM person_access pa WHERE pa.user_id = u.id) AS person_ids
      FROM users u
      ORDER BY u.id
    `).all());
  });

  // Creates an account with a temporary password. The user must change it at first sign-in.
  router.post('/users', (req, res) => {
    const email = cleanEmail(req.body?.email);
    const password = cleanPassword(req.body?.password);
    const role = req.body?.role === undefined ? 'user' : cleanRole(req.body.role);
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
      throw new HttpError(409, 'A user with that email already exists');
    }
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO users (email, password_hash, role, must_change_password) VALUES (?, ?, ?, 1)',
    ).run(email, hashPassword(password), role);
    const id = Number(lastInsertRowid);
    assignPersons(id, req.body?.personIds);
    audit.record(req.user, 'user.create', { kind: 'user', id, name: email, detail: role });
    res.status(201).json(getUser(id));
  });

  router.patch('/users/:id', (req, res) => {
    const id = parseId(req.params.id);
    const target = getUser(id);
    const role = req.body?.role !== undefined ? cleanRole(req.body.role) : target.role;
    const active = req.body?.active !== undefined ? (req.body.active ? 1 : 0) : target.active;
    if (id === req.user.id && (role !== 'super_admin' || !active)) {
      throw badRequest('You cannot remove your own super admin access or disable yourself');
    }
    const removesAdmin = target.role === 'super_admin' && target.active && (role !== 'super_admin' || !active);
    if (removesAdmin && activeSuperAdminCount() <= 1) {
      throw badRequest('The install must keep at least one active super admin');
    }
    db.prepare('UPDATE users SET role = ?, active = ? WHERE id = ?').run(role, active, id);
    if (!active) deleteUserSessions(db, id);
    audit.record(req.user, active ? 'user.update' : 'user.disable', { kind: 'user', id, name: target.email, detail: `role ${role}` });
    res.json(getUser(id));
  });

  // Body: { personIds: [...] } replaces the list of persons this user can see.
  router.put('/users/:id/persons', (req, res) => {
    const id = parseId(req.params.id);
    const target = getUser(id);
    assignPersons(id, req.body?.personIds);
    audit.record(req.user, 'user.persons', { kind: 'user', id, name: target.email });
    res.json(getUser(id));
  });

  // Resets another user's password to a temporary one. Their sessions are signed out.
  router.post('/users/:id/password', (req, res) => {
    const id = parseId(req.params.id);
    const target = getUser(id);
    setPassword(id, cleanPassword(req.body?.password), { mustChange: true });
    deleteUserSessions(db, id);
    audit.record(req.user, 'user.password_reset', { kind: 'user', id, name: target.email });
    res.status(204).end();
  });

  // Deletes the login only. Documents are never removed with an account: persons they created
  // move to the super admin, and files they uploaded stay in place with no uploader.
  router.delete('/users/:id', (req, res) => {
    const id = parseId(req.params.id);
    const target = getUser(id);
    if (id === req.user.id) throw badRequest('You cannot delete your own account');
    if (target.role === 'super_admin' && target.active && activeSuperAdminCount() <= 1) {
      throw badRequest('The install must keep at least one active super admin');
    }
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE persons SET user_id = ? WHERE user_id = ?').run(req.user.id, id);
      db.prepare('UPDATE files SET uploaded_by = NULL WHERE uploaded_by = ?').run(id);
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    audit.record(req.user, 'user.delete', { kind: 'user', id, name: target.email });
    res.status(204).end();
  });

  // ---- Recovery requests (super admin) --------------------------------------

  router.get('/recovery', requirePermission('recovery:manage'), (_req, res) => {
    res.json(db.prepare(`
      SELECT r.id, r.note, r.status, r.created_at, r.resolved_at, u.id AS user_id, u.email
      FROM password_requests r JOIN users u ON u.id = r.user_id
      ORDER BY (r.status = 'pending') DESC, r.created_at DESC
      LIMIT 100
    `).all());
  });

  // Approving sets a temporary password and returns it once, so the admin can pass it on.
  router.post('/recovery/:id/approve', requirePermission('recovery:manage'), (req, res) => {
    const request = db.prepare("SELECT * FROM password_requests WHERE id = ? AND status = 'pending'")
      .get(parseId(req.params.id));
    if (!request) throw notFound('Pending request not found');
    const temporaryPassword = randomPassword();
    setPassword(request.user_id, temporaryPassword, { mustChange: true });
    deleteUserSessions(db, request.user_id);
    db.prepare("UPDATE password_requests SET status = 'approved', resolved_at = datetime('now') WHERE id = ?")
      .run(request.id);
    const user = db.prepare('SELECT email FROM users WHERE id = ?').get(request.user_id);
    audit.record(req.user, 'recovery.approve', { kind: 'user', id: request.user_id, name: user.email });
    res.json({ email: user.email, temporaryPassword });
  });

  router.post('/recovery/:id/reject', requirePermission('recovery:manage'), (req, res) => {
    const result = db.prepare(`
      UPDATE password_requests SET status = 'rejected', resolved_at = datetime('now')
      WHERE id = ? AND status = 'pending'
    `).run(parseId(req.params.id));
    if (!result.changes) throw notFound('Pending request not found');
    audit.record(req.user, 'recovery.reject');
    res.status(204).end();
  });

  // ---- Recycle bin (super admin) --------------------------------------------

  router.use('/trash', requirePermission('trash:manage'));

  router.get('/trash', (_req, res) => {
    res.json(access.listTrash());
  });

  // Restores an item to where it was. Its contents come back only if they were deleted with it.
  router.post('/trash/:kind/:id/restore', (req, res) => {
    const id = parseId(req.params.id);
    const kind = req.params.kind;
    let name;
    if (kind === 'person') {
      const person = db.prepare('SELECT * FROM persons WHERE id = ? AND deleted_at IS NOT NULL').get(id);
      if (!person) throw notFound('Item not found in the recycle bin');
      name = person.name;
      access.restorePerson(person);
    } else if (kind === 'folder') {
      const folder = access.getFolder(req.user, id, { trashed: true });
      if (!folder.deleted_at) throw notFound('Item not found in the recycle bin');
      name = folder.name;
      access.restoreFolder(folder);
    } else if (kind === 'file') {
      const file = access.getFile(req.user, id, { trashed: true });
      if (!file.deleted_at) throw notFound('Item not found in the recycle bin');
      name = file.name;
      access.restoreFile(file);
    } else {
      throw notFound('Unknown item type');
    }
    audit.record(req.user, 'bin.restore', { kind, id, name });
    res.status(204).end();
  });

  // Permanently deletes an item from the bin. Only items already in the bin can be removed this way.
  router.delete('/trash/:kind/:id', (req, res) => {
    const id = parseId(req.params.id);
    const kind = req.params.kind;
    let name;
    if (kind === 'person') {
      const person = db.prepare('SELECT * FROM persons WHERE id = ? AND deleted_at IS NOT NULL').get(id);
      if (!person) throw notFound('Item not found in the recycle bin');
      name = person.name;
      access.purgePerson(person);
    } else if (kind === 'folder') {
      const folder = access.getFolder(req.user, id, { trashed: true });
      if (!folder.deleted_at) throw notFound('Item not found in the recycle bin');
      name = folder.name;
      access.purgeFolder(folder);
    } else if (kind === 'file') {
      const file = access.getFile(req.user, id, { trashed: true });
      if (!file.deleted_at) throw notFound('Item not found in the recycle bin');
      name = file.name;
      access.purgeFile(file);
    } else {
      throw notFound('Unknown item type');
    }
    audit.record(req.user, 'bin.purge', { kind, id, name });
    res.status(204).end();
  });

  // ---- Audit log and health (super admin) ---------------------------------------

  router.get('/admin/audit', requirePermission('system:manage'), (req, res) => {
    const userId = req.query.user_id ? parseId(req.query.user_id) : null;
    const action = typeof req.query.action === 'string' ? req.query.action.slice(0, 40) : null;
    const search = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : null;
    res.json(audit.list({ userId, action, search, limit: 300 }));
  });

  router.get('/admin/health', requirePermission('system:manage'), (_req, res) => {
    const files = db.prepare(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) AS live,
        COALESCE(SUM(size), 0) AS bytes
      FROM files
    `).get();
    const count = (sql) => db.prepare(sql).get().count;
    const since = (hours) => new Date(Date.now() - hours * 3600 * 1000).toISOString();
    const dbFile = path.join(dataDir, 'docukaksh.db');
    const disk = fs.statfsSync(dataDir);
    res.json({
      version: appVersion,
      node: process.version,
      uptime_seconds: Math.round(process.uptime()),
      memory_mb: Math.round(process.memoryUsage().rss / 1048576),
      disk: { free_bytes: disk.bavail * disk.bsize, total_bytes: disk.blocks * disk.bsize },
      storage: {
        files_bytes: files.bytes,
        previews_bytes: dirBytes(previewsDir),
        database_bytes: fs.existsSync(dbFile) ? fs.statSync(dbFile).size : 0,
      },
      counts: {
        users: count('SELECT COUNT(*) AS count FROM users'),
        persons: count('SELECT COUNT(*) AS count FROM persons WHERE deleted_at IS NULL'),
        folders: count('SELECT COUNT(*) AS count FROM folders WHERE deleted_at IS NULL'),
        files: files.live,
        files_in_bin: files.total - files.live,
        shares: count('SELECT COUNT(*) AS count FROM shares'),
      },
      last_24_hours: {
        uploads: db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'file.upload' AND created_at >= ?").get(since(24)).count,
        downloads: db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'file.download' AND created_at >= ?").get(since(24)).count,
        sign_in_failures: db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'auth.failed' AND created_at >= ?").get(since(24)).count,
        errors: db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'server.error' AND created_at >= ?").get(since(24)).count,
      },
      accounts_locked_now: count(`SELECT COUNT(*) AS count FROM login_failures WHERE locked_until > ${Date.now()}`),
      bin_retention_days: recycleRetentionDays,
    });
  });

  // ---- Documents (persons, folders, files, sharing, search, dashboard) --------

  router.use(createDocumentsRouter({
    db, access, audit, vault, incomingDir, previewsDir, maxUploadBytes, requirePermission,
  }));

  // ---- Errors -----------------------------------------------------------------

  router.use((_req, _res, next) => next(notFound('Endpoint not found')));

  router.use((err, req, res, _next) => {
    if (err instanceof multer.MulterError) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400).json({ error: tooBig ? 'File is too large' : err.message });
    }
    if (err instanceof HttpError) {
      return res.status(err.status).json(err.code ? { error: err.message, code: err.code } : { error: err.message });
    }
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large' });
    console.error(err);
    audit.record(req.user ?? null, 'server.error', { detail: `${req.method} ${req.path}: ${err.message}` });
    return res.status(500).json({ error: 'Internal server error' });
  });

  return router;
}

