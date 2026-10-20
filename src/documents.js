import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { previewFor, inlineMime, mimeFor } from './filetypes.js';
import { buildPreview, MAX_CONVERT_BYTES } from './previews.js';
import { accessClause } from './access.js';
import {
  HttpError, SUBTREE_CTE, badRequest, cleanColor, cleanFileName, cleanTags, cleanText,
  contentDisposition, escapeLike, notFound, parseId, parseOptionalId, sha256File,
} from './http.js';

const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox";
const tagsSubquery = `(SELECT group_concat(t.name, ',') FROM file_tags ft JOIN tags t ON t.id = ft.tag_id WHERE ft.file_id = f.id)`;
const splitTags = (value) => (value ? value.split(',') : []);

// Routes for persons, folders, files, tags and search. Mounted under /api after login.
export function createDocumentsRouter({ db, access, uploadsDir, previewsDir, maxUploadBytes, requirePermission }) {
  const router = express.Router();
  router.use(requirePermission('documents'));

  const upload = multer({
    storage: multer.diskStorage({
      destination: uploadsDir,
      filename: (_req, _file, cb) => cb(null, crypto.randomUUID()),
    }),
    limits: { fileSize: maxUploadBytes, files: 50 },
  });

  const discardUploads = (uploaded) => {
    for (const file of uploaded) fs.rmSync(file.path, { force: true });
  };

  // Folder must belong to the given person and be alive.
  const assertFolderInPerson = (user, folderId, personId) => {
    if (folderId === null) return;
    const folder = access.getFolder(user, folderId);
    if (folder.person_id !== personId) throw badRequest('That folder belongs to a different person');
  };

  const isInSubtree = (rootId, candidateId) =>
    db.prepare(`${SUBTREE_CTE} SELECT 1 FROM subtree WHERE id = ?`).get(rootId, candidateId) !== undefined;

  const publicFile = (row) => {
    const { stored_name, ...file } = row;
    return { ...file, tags: splitTags(file.tags) };
  };

  const fileRow = (id) => db.prepare(`
    SELECT f.id, f.person_id, f.folder_id, f.name, f.mime_type, f.size, f.sha256, f.created_at,
      f.doc_created_at, f.uploaded_by, f.stored_name, u.email AS uploaded_by_email,
      ${tagsSubquery} AS tags
    FROM files f LEFT JOIN users u ON u.id = f.uploaded_by
    WHERE f.id = ?
  `).get(id);

  // ---- Persons ----------------------------------------------------------------

  router.get('/persons', (req, res) => {
    const scope = accessClause(req.user, 'p.id');
    res.json(db.prepare(`
      SELECT p.id, p.name, p.color, p.sort_order, p.created_at,
        (SELECT COUNT(*) FROM files f WHERE f.person_id = p.id AND f.deleted_at IS NULL) AS file_count
      FROM persons p
      WHERE p.deleted_at IS NULL AND ${scope.sql}
      ORDER BY p.sort_order, p.name COLLATE NOCASE
    `).all(...scope.params));
  });

  router.post('/persons', requirePermission('persons:manage'), (req, res) => {
    const name = cleanText(req.body?.name, 'Name', 120);
    const color = cleanColor(req.body?.color);
    const { next } = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM persons').get();
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO persons (user_id, name, color, sort_order) VALUES (?, ?, ?, ?)',
    ).run(req.user.id, name, color, next);
    res.status(201).json(access.getPerson(req.user, Number(lastInsertRowid)));
  });

  router.patch('/persons/:id', requirePermission('persons:manage'), (req, res) => {
    const person = access.getPerson(req.user, parseId(req.params.id));
    const name = req.body?.name !== undefined ? cleanText(req.body.name, 'Name', 120) : person.name;
    const color = req.body?.color !== undefined ? cleanColor(req.body.color) : person.color;
    db.prepare('UPDATE persons SET name = ?, color = ? WHERE id = ?').run(name, color, person.id);
    res.json(access.getPerson(req.user, person.id));
  });

  // Body: { ids: [personId, ...] } in the new display order.
  router.put('/persons/order', requirePermission('persons:manage'), (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(parseId) : null;
    if (!ids) throw badRequest('ids must be a list of person ids');
    const update = db.prepare('UPDATE persons SET sort_order = ? WHERE id = ? AND deleted_at IS NULL');
    db.exec('BEGIN');
    try {
      ids.forEach((id, index) => update.run(index + 1, id));
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    res.status(204).end();
  });

  // Soft delete: the person and everything under it goes to the recycle bin.
  router.delete('/persons/:id', requirePermission('persons:manage'), (req, res) => {
    const person = access.getPerson(req.user, parseId(req.params.id));
    access.softDeletePerson(person.id, req.user.id, new Date().toISOString());
    res.status(204).end();
  });

  // Contents of one folder, or of the person's root when no folder_id is given.
  router.get('/persons/:id/browse', (req, res) => {
    const person = access.getPerson(req.user, parseId(req.params.id));
    const folderId = parseOptionalId(req.query.folder_id);
    let folder = null;
    let breadcrumb = [];
    if (folderId !== null) {
      folder = access.getFolder(req.user, folderId);
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
      WHERE person_id = ? AND parent_id IS ? AND deleted_at IS NULL
    `).all(person.id, folderId);
    const files = db.prepare(`
      SELECT f.id, f.name, f.mime_type, f.size, f.created_at, f.doc_created_at, f.uploaded_by,
        u.email AS uploaded_by_email, ${tagsSubquery} AS tags
      FROM files f LEFT JOIN users u ON u.id = f.uploaded_by
      WHERE f.person_id = ? AND f.folder_id IS ? AND f.deleted_at IS NULL
    `).all(person.id, folderId).map((f) => ({ ...f, tags: splitTags(f.tags) }));
    res.json({ person, folder, breadcrumb, folders, files });
  });

  // Every live folder of a person in one flat list, for the move dialog.
  router.get('/persons/:id/tree', (req, res) => {
    const person = access.getPerson(req.user, parseId(req.params.id));
    res.json(db.prepare(`
      SELECT id, parent_id, name FROM folders WHERE person_id = ? AND deleted_at IS NULL
      ORDER BY name COLLATE NOCASE
    `).all(person.id));
  });

  // ---- Folders ------------------------------------------------------------------

  router.post('/folders', (req, res) => {
    const person = access.getPerson(req.user, parseId(req.body?.person_id));
    const parentId = parseOptionalId(req.body?.parent_id);
    assertFolderInPerson(req.user, parentId, person.id);
    const name = cleanText(req.body?.name, 'Folder name');
    const { lastInsertRowid } = db.prepare('INSERT INTO folders (person_id, parent_id, name) VALUES (?, ?, ?)')
      .run(person.id, parentId, name);
    res.status(201).json(access.getFolder(req.user, Number(lastInsertRowid)));
  });

  router.patch('/folders/:id', (req, res) => {
    const folder = access.getFolder(req.user, parseId(req.params.id));
    const name = req.body?.name !== undefined ? cleanText(req.body.name, 'Folder name') : folder.name;
    let parentId = folder.parent_id;
    if (req.body?.parent_id !== undefined) {
      parentId = parseOptionalId(req.body.parent_id);
      assertFolderInPerson(req.user, parentId, folder.person_id);
      if (parentId !== null && isInSubtree(folder.id, parentId)) {
        throw badRequest('A folder cannot be moved into itself or into one of its subfolders');
      }
    }
    db.prepare('UPDATE folders SET name = ?, parent_id = ? WHERE id = ?').run(name, parentId, folder.id);
    res.json(access.getFolder(req.user, folder.id));
  });

  router.delete('/folders/:id', (req, res) => {
    const folder = access.getFolder(req.user, parseId(req.params.id));
    access.softDeleteFolder(folder.id, req.user.id, new Date().toISOString());
    res.status(204).end();
  });

  // ---- Files --------------------------------------------------------------------

  // Upload. Fields: person_id, folder_id (optional), tags (comma-separated, optional),
  // file_dates (JSON array of each file's last-modified time in ms, optional).
  router.post('/files', upload.array('files', 50), async (req, res) => {
    const uploaded = req.files ?? [];
    try {
      if (!uploaded.length) throw badRequest('No files were uploaded');
      const person = access.getPerson(req.user, parseId(req.body?.person_id));
      const folderId = parseOptionalId(req.body?.folder_id);
      assertFolderInPerson(req.user, folderId, person.id);
      const tags = cleanTags(req.body?.tags);
      const dates = parseDates(req.body?.file_dates);

      const records = [];
      for (const [i, file] of uploaded.entries()) {
        records.push({
          name: cleanFileName(file.originalname),
          storedName: file.filename,
          mime: mimeFor(file.originalname, typeof file.mimetype === 'string' ? file.mimetype.slice(0, 100) : undefined),
          size: file.size,
          sha256: await sha256File(file.path),
          docCreatedAt: dates[i] ?? null,
        });
      }

      const insert = db.prepare(`
        INSERT INTO files (person_id, folder_id, name, stored_name, mime_type, size, sha256, uploaded_by, doc_created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const ids = [];
      db.exec('BEGIN');
      try {
        for (const r of records) {
          const { lastInsertRowid } = insert.run(person.id, folderId, r.name, r.storedName, r.mime, r.size,
            r.sha256, req.user.id, r.docCreatedAt);
          ids.push(Number(lastInsertRowid));
          setTags(Number(lastInsertRowid), tags);
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      res.status(201).json(ids.map((id) => publicFile(fileRow(id))));
    } catch (err) {
      discardUploads(uploaded);
      throw err;
    }
  });

  // Metadata shown in the file details panel.
  router.get('/files/:id', (req, res) => {
    const file = access.getFile(req.user, parseId(req.params.id));
    const row = fileRow(file.id);
    const pathNames = db.prepare(`
      WITH RECURSIVE up(id, parent_id, name, depth) AS (
        SELECT id, parent_id, name, 0 FROM folders WHERE id = ?
        UNION ALL
        SELECT f.id, f.parent_id, f.name, up.depth + 1 FROM folders f JOIN up ON f.id = up.parent_id
      )
      SELECT name FROM up ORDER BY depth DESC
    `).all(file.folder_id ?? -1).map((r) => r.name);
    const person = db.prepare('SELECT name FROM persons WHERE id = ?').get(file.person_id);
    const info = previewFor(file.name);
    res.json({
      ...publicFile(row),
      person_name: person?.name ?? '',
      path: pathNames,
      preview: info.mode === 'none' ? 'none'
        : info.mode === 'native' ? info.category
          : info.converter === 'heic' ? 'converted-image' : 'document',
    });
  });

  router.patch('/files/:id', (req, res) => {
    const file = access.getFile(req.user, parseId(req.params.id));
    const name = req.body?.name !== undefined ? cleanText(req.body.name, 'File name') : file.name;
    let folderId = file.folder_id;
    if (req.body?.folder_id !== undefined) {
      folderId = parseOptionalId(req.body.folder_id);
      assertFolderInPerson(req.user, folderId, file.person_id);
    }
    db.prepare('UPDATE files SET name = ?, folder_id = ? WHERE id = ?').run(name, folderId, file.id);
    res.json(publicFile(fileRow(file.id)));
  });

  // Replaces the tags on a file. Body: { tags: "a, b" } or { tags: ["a", "b"] }.
  router.put('/files/:id/tags', (req, res) => {
    const file = access.getFile(req.user, parseId(req.params.id));
    setTags(file.id, cleanTags(req.body?.tags));
    res.json(publicFile(fileRow(file.id)));
  });

  router.get('/tags', (req, res) => {
    const scope = accessClause(req.user, 'f.person_id');
    res.json(db.prepare(`
      SELECT DISTINCT t.name FROM tags t
        JOIN file_tags ft ON ft.tag_id = t.id
        JOIN files f ON f.id = ft.file_id
      WHERE f.deleted_at IS NULL AND ${scope.sql}
      ORDER BY t.name COLLATE NOCASE
    `).all(...scope.params).map((r) => r.name));
  });

  router.delete('/files/:id', (req, res) => {
    const file = access.getFile(req.user, parseId(req.params.id));
    access.softDeleteFile(file.id, req.user.id, new Date().toISOString());
    res.status(204).end();
  });

  // Original bytes. Shown inline only for native types, and only with the type taken from the name.
  router.get('/files/:id/content', (req, res, next) => {
    const file = access.getFile(req.user, parseId(req.params.id));
    const mime = inlineMime(file.name);
    const inline = req.query.download !== '1' && mime !== null;
    res.setHeader('Content-Type', inline ? mime : 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDisposition(inline ? 'inline' : 'attachment', file.name));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-cache');
    if (mime === 'image/svg+xml' && inline) res.setHeader('Content-Security-Policy', SVG_CSP);
    res.sendFile(access.storedPath(file.stored_name), (err) => {
      if (err && !res.headersSent) next(notFound('File is missing from storage'));
    });
  });

  // Preview for types the browser cannot show directly (Office, text, Markdown, HEIC, CSV, ...).
  router.get('/files/:id/preview', async (req, res) => {
    const file = access.getFile(req.user, parseId(req.params.id));
    const info = previewFor(file.name);
    if (info.mode === 'none') throw new HttpError(415, 'No preview is available for this file type. Download it to open it.');
    if (info.mode === 'native') throw badRequest('This file is shown directly, use the content link');
    if (file.size > MAX_CONVERT_BYTES) throw new HttpError(413, 'This file is too large to preview. Download it instead.');

    fs.mkdirSync(previewsDir, { recursive: true });
    let out;
    try {
      out = await buildPreview({
        converter: info.converter,
        name: file.name,
        storedPath: access.storedPath(file.stored_name),
        cacheBase: path.join(previewsDir, file.stored_name),
      });
    } catch (err) {
      console.error('preview failed for file', file.id, err.message);
      throw new HttpError(422, 'This file could not be previewed. It may be damaged or password-protected. Download it instead.');
    }
    res.setHeader('Content-Type', out.contentType);
    res.setHeader('Content-Security-Policy', out.csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.sendFile(out.file);
  });

  // ---- Search ---------------------------------------------------------------------

  // q matches file names. A query starting with # searches by tag instead.
  router.get('/search', (req, res) => {
    const raw = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 200) : '';
    if (!raw) return res.json([]);
    const scope = accessClause(req.user, 'f.person_id');
    const conditions = ['f.deleted_at IS NULL', 'p.deleted_at IS NULL', scope.sql];
    const params = [...scope.params];
    if (raw.startsWith('#')) {
      const tag = raw.slice(1).replace(/[,#]/g, '').trim();
      conditions.push(`EXISTS (SELECT 1 FROM file_tags ft JOIN tags t ON t.id = ft.tag_id
        WHERE ft.file_id = f.id AND t.name = ? COLLATE NOCASE)`);
      params.push(tag);
    } else {
      conditions.push("f.name LIKE ? ESCAPE '\\'");
      params.push(`%${escapeLike(raw)}%`);
    }
    res.json(db.prepare(`
      SELECT f.id, f.name, f.mime_type, f.size, f.created_at, f.doc_created_at, f.person_id, f.folder_id,
        p.name AS person_name, fo.name AS folder_name, ${tagsSubquery} AS tags
      FROM files f
        JOIN persons p ON p.id = f.person_id
        LEFT JOIN folders fo ON fo.id = f.folder_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY f.name COLLATE NOCASE
      LIMIT 200
    `).all(...params).map((f) => ({ ...f, tags: splitTags(f.tags) })));
  });

  // ---- Helpers that need the db -------------------------------------------------------

  function setTags(fileId, tags) {
    db.prepare('DELETE FROM file_tags WHERE file_id = ?').run(fileId);
    const ensure = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
    const find = db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE');
    const link = db.prepare('INSERT OR IGNORE INTO file_tags (file_id, tag_id) VALUES (?, ?)');
    for (const tag of tags) {
      ensure.run(tag);
      link.run(fileId, find.get(tag).id);
    }
  }

  return router;
}

// Parses the per-file last-modified list sent by the browser. Invalid entries become null.
function parseDates(value) {
  let list = [];
  try {
    list = JSON.parse(value || '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return list.map((ms) => {
    const date = new Date(Number(ms));
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  });
}
