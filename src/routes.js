import express from 'express';
import crypto from 'node:crypto';
import multer from 'multer';
import {
  SESSION_COOKIE, createSession, deleteSession, deleteUserSessions, findSessionUser,
  hashPassword, verifyPassword,
} from './auth.js';
import { ROLES, THEMES, can, permissionsFor } from './permissions.js';
import { createAccess } from './access.js';
import { createDocumentsRouter } from './documents.js';
import {
  HttpError, badRequest, cleanEmail, cleanPassword, cleanText, notFound, parseCookies, parseId,
} from './http.js';

// Paths a user may call while they still have to change their temporary password.
const PASSWORD_CHANGE_ALLOWED = new Set(['/auth/status', '/auth/password', '/auth/logout']);

const cleanRole = (value) => {
  if (!ROLES.includes(value)) throw badRequest(`Role must be one of: ${ROLES.join(', ')}`);
  return value;
};

const cleanTheme = (value) => {
  if (!THEMES.includes(value)) throw badRequest('Unknown theme');
  return value;
};

const randomPassword = () => crypto.randomBytes(9).toString('base64url');

export function createApiRouter({ db, uploadsDir, previewsDir, cookieSecure, maxUploadBytes }) {
  const router = express.Router();
  router.use(express.json({ limit: '100kb' }));
  const access = createAccess({ db, uploadsDir });

  const requirePermission = (permission) => (req, _res, next) => {
    if (can(req.user, permission)) return next();
    next(new HttpError(403, 'You do not have permission to do that'));
  };

  const countUsers = () => db.prepare('SELECT COUNT(*) AS count FROM users').get().count;

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

  // ---- Public: health, status, login, setup, recovery -------------------------

  router.get('/health', (_req, res) => res.json({ ok: true }));

  router.get('/auth/status', (req, res) => {
    const user = findSessionUser(db, parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    res.json({
      setupRequired: countUsers() === 0,
      user: user && {
        id: user.id,
        email: user.email,
        role: user.role,
        theme: user.theme,
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
    res.status(201).json({ id: Number(lastInsertRowid), email, role: 'super_admin' });
  });

  router.post('/auth/login', (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const user = email ? db.prepare('SELECT * FROM users WHERE email = ?').get(email) : undefined;
    // Disabled accounts get the same message as a wrong password, so account state is not revealed.
    if (!user || !user.active || !verifyPassword(password, user.password_hash)) {
      throw new HttpError(401, 'Invalid email or password');
    }
    issueSession(res, user.id);
    res.json({ id: user.id, email: user.email, role: user.role, mustChangePassword: user.must_change_password === 1 });
  });

  router.post('/auth/logout', (req, res) => {
    deleteSession(db, parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
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
    // A user with a temporary password must type it; an ordinary change also needs the current password.
    if (!verifyPassword(current, row.password_hash)) throw badRequest('Current password is incorrect');
    setPassword(req.user.id, cleanPassword(req.body?.password));
    // Changing the password signs out every other session, then gives this one a fresh token.
    deleteUserSessions(db, req.user.id);
    issueSession(res, req.user.id);
    res.status(204).end();
  });

  router.patch('/auth/me', (req, res) => {
    if (req.body?.theme !== undefined) {
      db.prepare('UPDATE users SET theme = ? WHERE id = ?').run(cleanTheme(req.body.theme), req.user.id);
    }
    res.json({ theme: db.prepare('SELECT theme FROM users WHERE id = ?').get(req.user.id).theme });
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
    res.json(getUser(id));
  });

  // Body: { personIds: [...] } replaces the list of persons this user can see.
  router.put('/users/:id/persons', (req, res) => {
    const id = parseId(req.params.id);
    getUser(id);
    assignPersons(id, req.body?.personIds);
    res.json(getUser(id));
  });

  // Resets another user's password to a temporary one. Their sessions are signed out.
  router.post('/users/:id/password', (req, res) => {
    const id = parseId(req.params.id);
    getUser(id);
    setPassword(id, cleanPassword(req.body?.password), { mustChange: true });
    deleteUserSessions(db, id);
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
    res.json({ email: user.email, temporaryPassword });
  });

  router.post('/recovery/:id/reject', requirePermission('recovery:manage'), (req, res) => {
    const result = db.prepare(`
      UPDATE password_requests SET status = 'rejected', resolved_at = datetime('now')
      WHERE id = ? AND status = 'pending'
    `).run(parseId(req.params.id));
    if (!result.changes) throw notFound('Pending request not found');
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
    if (kind === 'person') {
      const person = db.prepare('SELECT * FROM persons WHERE id = ? AND deleted_at IS NOT NULL').get(id);
      if (!person) throw notFound('Item not found in the recycle bin');
      access.restorePerson(person);
    } else if (kind === 'folder') {
      const folder = access.getFolder(req.user, id, { trashed: true });
      if (!folder.deleted_at) throw notFound('Item not found in the recycle bin');
      access.restoreFolder(folder);
    } else if (kind === 'file') {
      const file = access.getFile(req.user, id, { trashed: true });
      if (!file.deleted_at) throw notFound('Item not found in the recycle bin');
      access.restoreFile(file);
    } else {
      throw notFound('Unknown item type');
    }
    res.status(204).end();
  });

  // Permanently deletes an item from the bin. Only items already in the bin can be removed this way.
  router.delete('/trash/:kind/:id', (req, res) => {
    const id = parseId(req.params.id);
    const kind = req.params.kind;
    if (kind === 'person') {
      const person = db.prepare('SELECT * FROM persons WHERE id = ? AND deleted_at IS NOT NULL').get(id);
      if (!person) throw notFound('Item not found in the recycle bin');
      access.purgePerson(person);
    } else if (kind === 'folder') {
      const folder = access.getFolder(req.user, id, { trashed: true });
      if (!folder.deleted_at) throw notFound('Item not found in the recycle bin');
      access.purgeFolder(folder);
    } else if (kind === 'file') {
      const file = access.getFile(req.user, id, { trashed: true });
      if (!file.deleted_at) throw notFound('Item not found in the recycle bin');
      access.purgeFile(file);
    } else {
      throw notFound('Unknown item type');
    }
    res.status(204).end();
  });

  // ---- Documents (persons, folders, files, tags, search, previews) --------------

  router.use(createDocumentsRouter({
    db, access, uploadsDir, previewsDir, maxUploadBytes, requirePermission,
  }));

  // ---- Errors -----------------------------------------------------------------

  router.use((_req, _res, next) => next(notFound('Endpoint not found')));

  router.use((err, _req, res, _next) => {
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
    return res.status(500).json({ error: 'Internal server error' });
  });

  return router;
}
