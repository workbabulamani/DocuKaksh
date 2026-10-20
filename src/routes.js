import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import {
  SESSION_COOKIE, createSession, deleteSession, findSessionUser, hashPassword, verifyPassword,
} from './auth.js';

// Only these types are rendered inline. Anything else is served as a download, so an uploaded
// HTML or SVG file can never run script on this origin.
const INLINE_TYPES = new Set([
  'application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain',
]);

// Walks down from a folder to collect it and all of its descendants.
const SUBTREE = `WITH RECURSIVE subtree(id) AS (
  SELECT id FROM folders WHERE id = ?
  UNION ALL
  SELECT f.id FROM folders f JOIN subtree s ON f.parent_id = s.id
)`;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const badRequest = (message) => new HttpError(400, message);
const notFound = (message = 'Not found') => new HttpError(404, message);

function parseId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw badRequest('Invalid id');
  return id;
}

function parseOptionalId(value) {
  if (value === undefined || value === null || value === '') return null;
  return parseId(value);
}

function cleanText(value, label, max = 255) {
  const text = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
  if (!text) throw badRequest(`${label} is required`);
  if (text.length > max) throw badRequest(`${label} must be ${max} characters or fewer`);
  return text;
}

function cleanEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('Enter a valid email');
  return email;
}

function cleanPassword(value) {
  if (typeof value !== 'string' || value.length < 8) throw badRequest('Password must be at least 8 characters');
  if (value.length > 200) throw badRequest('Password is too long');
  return value;
}

function cleanColor(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#4f46e5';
}

function cleanMime(value) {
  return typeof value === 'string' && value.length <= 100 && /^[\w.+-]+\/[\w.+-]+$/.test(value)
    ? value.toLowerCase()
    : 'application/octet-stream';
}

// Browsers send UTF-8 names, which busboy may read as latin1. Undo that when it is clearly mojibake.
function cleanFileName(original) {
  const decoded = Buffer.from(original, 'latin1').toString('utf8');
  const name = (decoded.includes('\uFFFD') ? original : decoded)
    .split(/[\\/]/).pop()
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  return (name || 'untitled').slice(0, 255);
}

const escapeLike = (text) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0) cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return cookies;
}

// Never send the internal storage name to the browser.
function publicFile({ stored_name, ...file }) {
  return file;
}

export function createApiRouter({ db, uploadsDir, cookieSecure, maxUploadBytes }) {
  const router = express.Router();
  router.use(express.json({ limit: '100kb' }));

  const storedPath = (storedName) => path.join(uploadsDir, storedName);
  const removeStored = (rows) => {
    for (const row of rows) fs.rmSync(storedPath(row.stored_name), { force: true });
  };
  const discardUploads = (uploaded) => {
    for (const file of uploaded) fs.rmSync(file.path, { force: true });
  };

  const upload = multer({
    storage: multer.diskStorage({
      destination: uploadsDir,
      filename: (_req, _file, cb) => cb(null, crypto.randomUUID()),
    }),
    limits: { fileSize: maxUploadBytes, files: 50 },
  });

  const requireAuth = (req, _res, next) => {
    const user = findSessionUser(db, parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    if (!user) return next(new HttpError(401, 'Not signed in'));
    req.user = user;
    next();
  };

  // Ownership checks. Every lookup is scoped to the signed-in user, so ids from other accounts look like 404s.
  const getPerson = (userId, personId) => {
    const row = db.prepare('SELECT * FROM persons WHERE id = ? AND user_id = ?').get(personId, userId);
    if (!row) throw notFound('Person not found');
    return row;
  };
  const getFolder = (userId, folderId) => {
    const row = db.prepare(`
      SELECT f.* FROM folders f JOIN persons p ON p.id = f.person_id
      WHERE f.id = ? AND p.user_id = ?
    `).get(folderId, userId);
    if (!row) throw notFound('Folder not found');
    return row;
  };
  const getFile = (userId, fileId) => {
    const row = db.prepare(`
      SELECT f.* FROM files f JOIN persons p ON p.id = f.person_id
      WHERE f.id = ? AND p.user_id = ?
    `).get(fileId, userId);
    if (!row) throw notFound('File not found');
    return row;
  };
  const assertFolderInPerson = (userId, folderId, personId) => {
    if (folderId === null) return;
    if (getFolder(userId, folderId).person_id !== personId) {
      throw badRequest('That folder belongs to a different person');
    }
  };
  const isInSubtree = (rootId, candidateId) =>
    db.prepare(`${SUBTREE} SELECT 1 FROM subtree WHERE id = ?`).get(rootId, candidateId) !== undefined;
  const filesInSubtree = (rootId) =>
    db.prepare(`${SUBTREE} SELECT stored_name FROM files WHERE folder_id IN (SELECT id FROM subtree)`).all(rootId);
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

  router.get('/health', (_req, res) => res.json({ ok: true }));

  // ---- Auth -------------------------------------------------------------

  router.get('/auth/status', (req, res) => {
    const user = findSessionUser(db, parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    res.json({ setupRequired: countUsers() === 0, user });
  });

  // Only available until the first account exists, so a public instance cannot be claimed later.
  router.post('/auth/setup', (req, res) => {
    if (countUsers() > 0) throw new HttpError(409, 'Setup has already been completed');
    const email = cleanEmail(req.body?.email);
    const password = cleanPassword(req.body?.password);
    const { lastInsertRowid } = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
      .run(email, hashPassword(password));
    issueSession(res, Number(lastInsertRowid));
    res.status(201).json({ id: Number(lastInsertRowid), email });
  });

  router.post('/auth/login', (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const user = email ? db.prepare('SELECT * FROM users WHERE email = ?').get(email) : undefined;
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw new HttpError(401, 'Invalid email or password');
    }
    issueSession(res, user.id);
    res.json({ id: user.id, email: user.email });
  });

  router.post('/auth/logout', (req, res) => {
    deleteSession(db, parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.status(204).end();
  });

  router.use(requireAuth);

  // ---- Persons (categories) ---------------------------------------------

  router.get('/persons', (req, res) => {
    res.json(db.prepare(`
      SELECT p.id, p.name, p.color, p.created_at,
        (SELECT COUNT(*) FROM files f WHERE f.person_id = p.id) AS file_count
      FROM persons p WHERE p.user_id = ?
      ORDER BY p.name COLLATE NOCASE
    `).all(req.user.id));
  });

  router.post('/persons', (req, res) => {
    const name = cleanText(req.body?.name, 'Name', 120);
    const color = cleanColor(req.body?.color);
    const { lastInsertRowid } = db.prepare('INSERT INTO persons (user_id, name, color) VALUES (?, ?, ?)')
      .run(req.user.id, name, color);
    res.status(201).json(getPerson(req.user.id, Number(lastInsertRowid)));
  });

  router.patch('/persons/:id', (req, res) => {
    const person = getPerson(req.user.id, parseId(req.params.id));
    const name = req.body?.name !== undefined ? cleanText(req.body.name, 'Name', 120) : person.name;
    const color = req.body?.color !== undefined ? cleanColor(req.body.color) : person.color;
    db.prepare('UPDATE persons SET name = ?, color = ? WHERE id = ?').run(name, color, person.id);
    res.json(getPerson(req.user.id, person.id));
  });

  router.delete('/persons/:id', (req, res) => {
    const person = getPerson(req.user.id, parseId(req.params.id));
    const stored = db.prepare('SELECT stored_name FROM files WHERE person_id = ?').all(person.id);
    db.prepare('DELETE FROM persons WHERE id = ?').run(person.id);
    removeStored(stored);
    res.status(204).end();
  });

  // Contents of one folder (or the person's root when no folder_id is given).
  router.get('/persons/:id/browse', (req, res) => {
    const person = getPerson(req.user.id, parseId(req.params.id));
    const folderId = parseOptionalId(req.query.folder_id);
    let folder = null;
    let breadcrumb = [];
    if (folderId !== null) {
      folder = getFolder(req.user.id, folderId);
      if (folder.person_id !== person.id) throw notFound('Folder not found');
      breadcrumb = db.prepare(`
        WITH RECURSIVE up(id, parent_id, name, depth) AS (
          SELECT id, parent_id, name, 0 FROM folders WHERE id = ?
          UNION ALL
          SELECT f.id, f.parent_id, f.name, up.depth + 1 FROM folders f JOIN up ON f.id = up.parent_id
        )
        SELECT id, name FROM up ORDER BY depth DESC
      `).all(folder.id);
    }
    const folders = db.prepare(`
      SELECT id, name, created_at FROM folders
      WHERE person_id = ? AND parent_id IS ?
      ORDER BY name COLLATE NOCASE
    `).all(person.id, folderId);
    const files = db.prepare(`
      SELECT id, name, mime_type, size, created_at FROM files
      WHERE person_id = ? AND folder_id IS ?
      ORDER BY name COLLATE NOCASE
    `).all(person.id, folderId);
    res.json({ person, folder, breadcrumb, folders, files });
  });

  // Every folder of a person in one flat list, used by the move dialog.
  router.get('/persons/:id/tree', (req, res) => {
    const person = getPerson(req.user.id, parseId(req.params.id));
    res.json(db.prepare(`
      SELECT id, parent_id, name FROM folders WHERE person_id = ? ORDER BY name COLLATE NOCASE
    `).all(person.id));
  });

  // ---- Folders ----------------------------------------------------------

  router.post('/folders', (req, res) => {
    const person = getPerson(req.user.id, parseId(req.body?.person_id));
    const parentId = parseOptionalId(req.body?.parent_id);
    assertFolderInPerson(req.user.id, parentId, person.id);
    const name = cleanText(req.body?.name, 'Folder name');
    const { lastInsertRowid } = db.prepare('INSERT INTO folders (person_id, parent_id, name) VALUES (?, ?, ?)')
      .run(person.id, parentId, name);
    res.status(201).json(getFolder(req.user.id, Number(lastInsertRowid)));
  });

  router.patch('/folders/:id', (req, res) => {
    const folder = getFolder(req.user.id, parseId(req.params.id));
    const name = req.body?.name !== undefined ? cleanText(req.body.name, 'Folder name') : folder.name;
    let parentId = folder.parent_id;
    if (req.body?.parent_id !== undefined) {
      parentId = parseOptionalId(req.body.parent_id);
      assertFolderInPerson(req.user.id, parentId, folder.person_id);
      if (parentId !== null && isInSubtree(folder.id, parentId)) {
        throw badRequest('A folder cannot be moved into itself or into one of its subfolders');
      }
    }
    db.prepare('UPDATE folders SET name = ?, parent_id = ? WHERE id = ?').run(name, parentId, folder.id);
    res.json(getFolder(req.user.id, folder.id));
  });

  router.delete('/folders/:id', (req, res) => {
    const folder = getFolder(req.user.id, parseId(req.params.id));
    const stored = filesInSubtree(folder.id);
    db.prepare('DELETE FROM folders WHERE id = ?').run(folder.id);
    removeStored(stored);
    res.status(204).end();
  });

  // ---- Files ------------------------------------------------------------

  router.post('/files', upload.array('files', 50), async (req, res) => {
    const uploaded = req.files ?? [];
    try {
      if (!uploaded.length) throw badRequest('No files were uploaded');
      const person = getPerson(req.user.id, parseId(req.body?.person_id));
      const folderId = parseOptionalId(req.body?.folder_id);
      assertFolderInPerson(req.user.id, folderId, person.id);

      const records = [];
      for (const file of uploaded) {
        records.push({
          name: cleanFileName(file.originalname),
          storedName: file.filename,
          mime: cleanMime(file.mimetype),
          size: file.size,
          sha256: await sha256File(file.path),
        });
      }

      const insert = db.prepare(`
        INSERT INTO files (person_id, folder_id, name, stored_name, mime_type, size, sha256)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const ids = [];
      db.exec('BEGIN');
      try {
        for (const r of records) {
          const { lastInsertRowid } = insert.run(person.id, folderId, r.name, r.storedName, r.mime, r.size, r.sha256);
          ids.push(Number(lastInsertRowid));
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      res.status(201).json(ids.map((id) => publicFile(getFile(req.user.id, id))));
    } catch (err) {
      discardUploads(uploaded);
      throw err;
    }
  });

  router.get('/files/:id', (req, res) => {
    res.json(publicFile(getFile(req.user.id, parseId(req.params.id))));
  });

  router.patch('/files/:id', (req, res) => {
    const file = getFile(req.user.id, parseId(req.params.id));
    const name = req.body?.name !== undefined ? cleanText(req.body.name, 'File name') : file.name;
    let folderId = file.folder_id;
    if (req.body?.folder_id !== undefined) {
      folderId = parseOptionalId(req.body.folder_id);
      assertFolderInPerson(req.user.id, folderId, file.person_id);
    }
    db.prepare('UPDATE files SET name = ?, folder_id = ? WHERE id = ?').run(name, folderId, file.id);
    res.json(publicFile(getFile(req.user.id, file.id)));
  });

  router.delete('/files/:id', (req, res) => {
    const file = getFile(req.user.id, parseId(req.params.id));
    db.prepare('DELETE FROM files WHERE id = ?').run(file.id);
    removeStored([file]);
    res.status(204).end();
  });

  // Streams the file. Inline for previewable types, attachment otherwise or when ?download=1.
  router.get('/files/:id/content', (req, res, next) => {
    const file = getFile(req.user.id, parseId(req.params.id));
    const inline = req.query.download !== '1' && INLINE_TYPES.has(file.mime_type);
    const asciiName = file.name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    res.setHeader('Content-Type', inline ? file.mime_type : 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-cache');
    res.sendFile(storedPath(file.stored_name), (err) => {
      if (err && !res.headersSent) next(notFound('File is missing from storage'));
    });
  });

  // ---- Search -----------------------------------------------------------

  router.get('/search', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 200) : '';
    if (!q) return res.json([]);
    res.json(db.prepare(`
      SELECT f.id, f.name, f.mime_type, f.size, f.created_at, f.person_id, f.folder_id,
        p.name AS person_name, fo.name AS folder_name
      FROM files f
      JOIN persons p ON p.id = f.person_id
      LEFT JOIN folders fo ON fo.id = f.folder_id
      WHERE p.user_id = ? AND f.name LIKE ? ESCAPE '\\'
      ORDER BY f.name COLLATE NOCASE
      LIMIT 100
    `).all(req.user.id, `%${escapeLike(q)}%`));
  });

  // ---- Errors -----------------------------------------------------------

  router.use((_req, _res, next) => next(notFound('Endpoint not found')));

  router.use((err, _req, res, _next) => {
    if (err instanceof multer.MulterError) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400).json({ error: tooBig ? 'File is too large' : err.message });
    }
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large' });
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  });

  return router;
}
