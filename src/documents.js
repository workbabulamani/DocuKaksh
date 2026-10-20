import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { previewFor, inlineMime, mimeFor } from './filetypes.js';
import { buildPreview, MAX_CONVERT_BYTES } from './previews.js';
import { accessClause } from './access.js';
import { FOLDER_ICONS, isFolderIcon } from './icons.js';
import {
  HttpError, SUBTREE_CTE, badRequest, cleanFileName, cleanTags, cleanText, contentDisposition,
  escapeLike, notFound, parseId, parseOptionalId, sha256File,
} from './http.js';

const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox";
const SHARE_PERMISSIONS = ['view', 'edit', 'dropbox'];
const tagsSubquery = `(SELECT group_concat(t.name, ',') FROM file_tags ft JOIN tags t ON t.id = ft.tag_id WHERE ft.file_id = f.id)`;
const splitTags = (value) => (value ? value.split(',') : []);

const cleanDescription = (value) => (typeof value === 'string' ? value.replace(/\r/g, '').trim().slice(0, 2000) : '');

function cleanDate(value) {
  if (value === undefined || value === null || value === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) throw badRequest('Expiry date must be YYYY-MM-DD');
  return value;
}

function cleanIcon(value) {
  if (value === undefined) return 'folder';
  if (!isFolderIcon(value)) throw badRequest(`Icon must be one of: ${FOLDER_ICONS.join(', ')}`);
  return value;
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

// Routes for persons, folders, files, sharing, stars, tags, search and the dashboard.
// Mounted under /api after login.
export function createDocumentsRouter({ db, access, audit, vault, incomingDir, previewsDir, maxUploadBytes, requirePermission }) {
  const router = express.Router();
  router.use(requirePermission('documents'));

  const upload = multer({
    storage: multer.diskStorage({
      destination: incomingDir,
      filename: (_req, _file, cb) => cb(null, crypto.randomUUID()),
    }),
    limits: { fileSize: maxUploadBytes, files: 50 },
  });

  const discardUploads = (uploaded) => {
    for (const file of uploaded) fs.rmSync(file.path, { force: true });
  };

  // Reads the original bytes of a stored file, decrypting when needed.
  const plainStream = (row) => (row.encrypted
    ? vault.decryptStream(access.storedPath(row.stored_name))
    : fs.createReadStream(access.storedPath(row.stored_name)));
  const plainBuffer = (row) => (row.encrypted
    ? vault.decryptBuffer(access.storedPath(row.stored_name))
    : fs.readFileSync(access.storedPath(row.stored_name)));

  const publicFile = (row) => {
    const { stored_name, encrypted, ...file } = row;
    return { ...file, tags: splitTags(file.tags) };
  };

  const fileRow = (id, userId) => db.prepare(`
    SELECT f.id, f.person_id, f.folder_id, f.name, f.mime_type, f.size, f.sha256, f.created_at,
      f.doc_created_at, f.uploaded_by, f.stored_name, f.encrypted, f.description, f.expires_on,
      u.email AS uploaded_by_email, ${tagsSubquery} AS tags,
      EXISTS (SELECT 1 FROM stars s WHERE s.user_id = ? AND s.kind = 'file' AND s.item_id = f.id) AS starred
    FROM files f LEFT JOIN users u ON u.id = f.uploaded_by
    WHERE f.id = ?
  `).get(userId, id);

  const folderRow = (id) => db.prepare('SELECT * FROM folders WHERE id = ?').get(id);

  const isInSubtree = (rootId, candidateId) =>
    db.prepare(`${SUBTREE_CTE} SELECT 1 FROM subtree WHERE id = ?`).get(rootId, candidateId) !== undefined;

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

  // Folder ancestor names for the details panel (from the top-most folder the user may see).
  const pathNamesFor = (user, folderId) => {
    if (!folderId) return [];
    const folder = folderRow(folderId);
    return access.breadcrumbFor(user, folder).map((c) => c.name);
  };

  // Files of the given person that identical content already exists in, visible to this user.
  const visibleDuplicates = (user, sha256) => {
    const scope = accessClause(user, 'f.person_id');
    return db.prepare(`
      SELECT f.id, f.name, p.name AS person_name FROM files f JOIN persons p ON p.id = f.person_id
      WHERE f.sha256 = ? AND f.deleted_at IS NULL AND p.deleted_at IS NULL AND ${scope.sql}
      ORDER BY f.created_at DESC LIMIT 10
    `).all(sha256, ...scope.params);
  };

  // ---- Persons ----------------------------------------------------------------

  router.get('/persons', (req, res) => {
    const scope = accessClause(req.user, 'p.id');
    res.json(db.prepare(`
      SELECT p.id, p.name, p.color, p.description, p.sort_order, p.created_at,
        (SELECT COUNT(*) FROM files f WHERE f.person_id = p.id AND f.deleted_at IS NULL) AS file_count,
        (SELECT COUNT(*) FROM folders d WHERE d.person_id = p.id AND d.deleted_at IS NULL) AS folder_count
      FROM persons p
      WHERE p.deleted_at IS NULL AND ${scope.sql}
      ORDER BY p.sort_order, p.name COLLATE NOCASE
    `).all(...scope.params));
  });

  router.post('/persons', requirePermission('persons:manage'), (req, res) => {
    const name = cleanText(req.body?.name, 'Name', 120);
    const color = typeof req.body?.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(req.body.color) ? req.body.color : '#4f46e5';
    const description = cleanDescription(req.body?.description);
    const { next } = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM persons').get();
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO persons (user_id, name, color, description, sort_order) VALUES (?, ?, ?, ?, ?)',
    ).run(req.user.id, name, color, description, next);
    audit.record(req.user, 'person.create', { kind: 'person', id: Number(lastInsertRowid), name });
    res.status(201).json(access.getPerson(req.user, Number(lastInsertRowid)));
  });

  router.patch('/persons/:id', requirePermission('persons:manage'), (req, res) => {
    const person = access.getPerson(req.user, parseId(req.params.id));
    const name = req.body?.name !== undefined ? cleanText(req.body.name, 'Name', 120) : person.name;
    const color = req.body?.color !== undefined
      ? (/^#[0-9a-fA-F]{6}$/.test(req.body.color) ? req.body.color : person.color)
      : person.color;
    const description = req.body?.description !== undefined ? cleanDescription(req.body.description) : person.description;
    db.prepare('UPDATE persons SET name = ?, color = ?, description = ? WHERE id = ?').run(name, color, description, person.id);
    audit.record(req.user, 'person.update', { kind: 'person', id: person.id, name });
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
    audit.record(req.user, 'person.delete', { kind: 'person', id: person.id, name: person.name });
    res.status(204).end();
  });

  // Contents of a person's root folder. Only people assigned to the user (or the super admin).
  router.get('/persons/:id/browse', (req, res) => {
    const person = access.getPerson(req.user, parseId(req.params.id));
    const folders = db.prepare(`
      SELECT id, name, icon, description, created_at FROM folders
      WHERE person_id = ? AND parent_id IS NULL AND deleted_at IS NULL
    `).all(person.id);
    const files = db.prepare(`
      SELECT f.id, f.name, f.mime_type, f.size, f.created_at, f.doc_created_at, f.uploaded_by, f.expires_on,
        u.email AS uploaded_by_email, ${tagsSubquery} AS tags
      FROM files f LEFT JOIN users u ON u.id = f.uploaded_by
      WHERE f.person_id = ? AND f.folder_id IS NULL AND f.deleted_at IS NULL
    `).all(person.id).map((f) => ({ ...f, tags: splitTags(f.tags) }));
    res.json({ person, folder: null, breadcrumb: [], folders, files, level: 'edit' });
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

  // Contents of any folder the user can reach: their own persons, or a folder shared with them.
  // A drop-box folder accepts uploads but does not list its contents.
  router.get('/folders/:id/browse', (req, res) => {
    const id = parseId(req.params.id);
    const raw = folderRow(id);
    const level = raw && !raw.deleted_at ? access.folderLevelFor(req.user, raw) : null;
    if (!level) throw notFound('Folder not found');
    if (level === 'dropbox') {
      throw new HttpError(403, 'This folder only accepts uploads. You cannot see what is inside it.', 'DROPBOX');
    }
    const folder = access.getFolder(req.user, id, { action: 'read' });
    const person = db.prepare('SELECT id, name, color FROM persons WHERE id = ?').get(folder.person_id);
    const folders = db.prepare(`
      SELECT id, name, icon, description, created_at FROM folders
      WHERE person_id = ? AND parent_id IS ? AND deleted_at IS NULL
    `).all(folder.person_id, folder.id);
    const files = db.prepare(`
      SELECT f.id, f.name, f.mime_type, f.size, f.created_at, f.doc_created_at, f.uploaded_by, f.expires_on,
        u.email AS uploaded_by_email, ${tagsSubquery} AS tags
      FROM files f LEFT JOIN users u ON u.id = f.uploaded_by
      WHERE f.person_id = ? AND f.folder_id IS ? AND f.deleted_at IS NULL
    `).all(folder.person_id, folder.id).map((f) => ({ ...f, tags: splitTags(f.tags) }));
    res.json({
      person,
      folder,
      breadcrumb: access.breadcrumbFor(req.user, folder),
      folders,
      files,
      level,
    });
  });

  // Every live folder below this one, for move dialogs when the user has no person-wide view.
  router.get('/folders/:id/subtree', (req, res) => {
    const folder = access.getFolder(req.user, parseId(req.params.id), { action: 'read' });
    res.json(db.prepare(`
      ${SUBTREE_CTE} SELECT f.id, f.parent_id, f.name FROM folders f
      WHERE f.id IN (SELECT id FROM subtree) AND f.deleted_at IS NULL
      ORDER BY f.name COLLATE NOCASE
    `).all(folder.id));
  });

  router.post('/folders', (req, res) => {
    const parentId = parseOptionalId(req.body?.parent_id);
    let personId;
    if (parentId !== null) {
      const parent = access.getFolder(req.user, parentId, { action: 'write' });
      personId = parent.person_id;
      if (req.body?.person_id !== undefined && parseId(req.body.person_id) !== personId) {
        throw badRequest('That folder belongs to a different person');
      }
    } else {
      personId = access.getPerson(req.user, parseId(req.body?.person_id)).id;
    }
    const name = cleanText(req.body?.name, 'Folder name');
    const icon = cleanIcon(req.body?.icon);
    const description = cleanDescription(req.body?.description);
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO folders (person_id, parent_id, name, icon, description) VALUES (?, ?, ?, ?, ?)
    `).run(personId, parentId, name, icon, description);
    audit.record(req.user, 'folder.create', { kind: 'folder', id: Number(lastInsertRowid), name });
    res.status(201).json(access.getFolder(req.user, Number(lastInsertRowid), { action: 'read' }));
  });

  router.patch('/folders/:id', (req, res) => {
    const folder = access.getFolder(req.user, parseId(req.params.id), { action: 'write' });
    const name = req.body?.name !== undefined ? cleanText(req.body.name, 'Folder name') : folder.name;
    const icon = req.body?.icon !== undefined ? cleanIcon(req.body.icon) : folder.icon;
    const description = req.body?.description !== undefined ? cleanDescription(req.body.description) : folder.description;
    let parentId = folder.parent_id;
    if (req.body?.parent_id !== undefined) {
      parentId = parseOptionalId(req.body.parent_id);
      if (parentId !== null) {
        const target = access.getFolder(req.user, parentId, { action: 'write' });
        if (target.person_id !== folder.person_id) throw badRequest('That folder belongs to a different person');
        if (isInSubtree(folder.id, parentId)) {
          throw badRequest('A folder cannot be moved into itself or into one of its subfolders');
        }
      }
    }
    db.prepare('UPDATE folders SET name = ?, parent_id = ?, icon = ?, description = ? WHERE id = ?')
      .run(name, parentId, icon, description, folder.id);
    audit.record(req.user, 'folder.update', { kind: 'folder', id: folder.id, name });
    res.json(access.getFolder(req.user, folder.id, { action: 'read' }));
  });

  router.delete('/folders/:id', (req, res) => {
    const folder = access.getFolder(req.user, parseId(req.params.id), { action: 'write' });
    access.softDeleteFolder(folder.id, req.user.id, new Date().toISOString());
    audit.record(req.user, 'folder.delete', { kind: 'folder', id: folder.id, name: folder.name });
    res.status(204).end();
  });

  // ---- Files --------------------------------------------------------------------

  // Upload. Fields: person_id, folder_id (optional), tags, file_dates (JSON), description (optional).
  // Files are encrypted before they are stored; the original is never written in plain form.
  router.post('/files', upload.array('files', 50), async (req, res) => {
    const uploaded = req.files ?? [];
    try {
      if (!uploaded.length) throw badRequest('No files were uploaded');
      const folderId = parseOptionalId(req.body?.folder_id);
      let personId;
      if (folderId !== null) {
        const folder = access.getFolder(req.user, folderId, { action: 'upload' });
        personId = folder.person_id;
        if (req.body?.person_id !== undefined && parseId(req.body.person_id) !== personId) {
          throw badRequest('That folder belongs to a different person');
        }
      } else {
        personId = access.getPerson(req.user, parseId(req.body?.person_id)).id;
      }
      const tags = cleanTags(req.body?.tags);
      const dates = parseDates(req.body?.file_dates);
      const description = cleanDescription(req.body?.description);

      const records = [];
      for (const [i, file] of uploaded.entries()) {
        const name = cleanFileName(file.originalname);
        records.push({
          name,
          storedName: crypto.randomUUID(),
          tmpPath: file.path,
          mime: mimeFor(name, typeof file.mimetype === 'string' ? file.mimetype.slice(0, 100) : undefined),
          size: file.size,
          sha256: await sha256File(file.path),
          docCreatedAt: dates[i] ?? null,
        });
      }

      const duplicatesByName = new Map(records.map((r) => [r.name, visibleDuplicates(req.user, r.sha256)]));

      // Encrypt first (this awaits), then write the rows in one short transaction.
      for (const r of records) await vault.encryptFile(r.tmpPath, access.storedPath(r.storedName));

      const insert = db.prepare(`
        INSERT INTO files (person_id, folder_id, name, stored_name, mime_type, size, sha256, uploaded_by,
          doc_created_at, encrypted, description)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `);
      const ids = [];
      db.exec('BEGIN');
      try {
        for (const r of records) {
          const { lastInsertRowid } = insert.run(personId, folderId, r.name, r.storedName, r.mime, r.size,
            r.sha256, req.user.id, r.docCreatedAt, description);
          ids.push(Number(lastInsertRowid));
          setTags(Number(lastInsertRowid), tags);
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        for (const r of records) fs.rmSync(access.storedPath(r.storedName), { force: true });
        throw err;
      }
      for (const r of records) fs.rmSync(r.tmpPath, { force: true });
      records.forEach((r, i) => audit.record(req.user, 'file.upload', { kind: 'file', id: ids[i], name: r.name }));

      res.status(201).json(ids.map((id, i) => ({
        ...publicFile(fileRow(id, req.user.id)),
        duplicates: duplicatesByName.get(records[i].name).filter((d) => d.id !== id),
      })));
    } catch (err) {
      discardUploads(uploaded);
      throw err;
    }
  });

  // Details for the preview panel.
  router.get('/files/:id', (req, res) => {
    const file = access.getFile(req.user, parseId(req.params.id), { action: 'read' });
    const row = fileRow(file.id, req.user.id);
    const person = db.prepare('SELECT name FROM persons WHERE id = ?').get(file.person_id);
    const info = previewFor(file.name);
    res.json({
      ...publicFile(row),
      person_name: person?.name ?? '',
      path: pathNamesFor(req.user, file.folder_id),
      preview: info.mode === 'none' ? 'none'
        : info.mode === 'native' ? info.category
          : info.converter === 'heic' ? 'converted-image' : 'document',
      can_write: access.canFile(req.user, file, 'write'),
    });
  });

  router.patch('/files/:id', (req, res) => {
    const file = access.getFile(req.user, parseId(req.params.id), { action: 'write' });
    const name = req.body?.name !== undefined ? cleanText(req.body.name, 'File name') : file.name;
    const description = req.body?.description !== undefined ? cleanDescription(req.body.description) : file.description;
    const expiresOn = req.body?.expires_on !== undefined ? cleanDate(req.body.expires_on) : file.expires_on;
    let folderId = file.folder_id;
    if (req.body?.folder_id !== undefined) {
      folderId = parseOptionalId(req.body.folder_id);
      if (folderId !== null) {
        const target = access.getFolder(req.user, folderId, { action: 'write' });
        if (target.person_id !== file.person_id) throw badRequest('That folder belongs to a different person');
      }
    }
    db.prepare('UPDATE files SET name = ?, folder_id = ?, description = ?, expires_on = ? WHERE id = ?')
      .run(name, folderId, description, expiresOn, file.id);
    audit.record(req.user, 'file.update', { kind: 'file', id: file.id, name });
    res.json(publicFile(fileRow(file.id, req.user.id)));
  });

  // Replaces the tags on a file. Body: { tags: "a, b" } or { tags: ["a", "b"] }.
  router.put('/files/:id/tags', (req, res) => {
    const file = access.getFile(req.user, parseId(req.params.id), { action: 'write' });
    setTags(file.id, cleanTags(req.body?.tags));
    audit.record(req.user, 'file.tags', { kind: 'file', id: file.id, name: file.name });
    res.json(publicFile(fileRow(file.id, req.user.id)));
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
    const file = access.getFile(req.user, parseId(req.params.id), { action: 'write' });
    access.softDeleteFile(file.id, req.user.id, new Date().toISOString());
    audit.record(req.user, 'file.delete', { kind: 'file', id: file.id, name: file.name });
    res.status(204).end();
  });

  // Original bytes, decrypted as they stream. Inline only for native types; otherwise a download.
  router.get('/files/:id/content', (req, res, next) => {
    const file = access.getFile(req.user, parseId(req.params.id), { action: 'read' });
    const mime = inlineMime(file.name);
    const download = req.query.download === '1' || mime === null;
    res.setHeader('Content-Type', download ? 'application/octet-stream' : mime);
    res.setHeader('Content-Disposition', contentDisposition(download ? 'attachment' : 'inline', file.name));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-cache');
    if (mime === 'image/svg+xml' && !download) res.setHeader('Content-Security-Policy', SVG_CSP);
    audit.record(req.user, download ? 'file.download' : 'file.view', { kind: 'file', id: file.id, name: file.name });

    const stream = plainStream(file);
    stream.on('error', (err) => {
      console.error('stream failed for file', file.id, err.message);
      if (res.headersSent) return res.destroy();
      res.removeHeader('Content-Disposition');
      next(new HttpError(500, 'This file could not be read from storage'));
    });
    stream.pipe(res);
  });

  // Preview for types the browser cannot show directly (Office, text, Markdown, HEIC, CSV, ...).
  router.get('/files/:id/preview', async (req, res) => {
    const file = access.getFile(req.user, parseId(req.params.id), { action: 'read' });
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
        readPlain: () => plainBuffer(file),
        cacheBase: path.join(previewsDir, file.stored_name),
        vault,
      });
    } catch (err) {
      console.error('preview failed for file', file.id, err.message);
      throw new HttpError(422, 'This file could not be previewed. It may be damaged or password-protected. Download it instead.');
    }
    audit.record(req.user, 'file.view', { kind: 'file', id: file.id, name: file.name, detail: 'preview' });
    res.setHeader('Content-Type', out.contentType);
    res.setHeader('Content-Security-Policy', out.csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-cache');
    res.end(out.body);
  });

  // Duplicate groups: the same content stored more than once, among files this user can see.
  router.get('/duplicates', (req, res) => {
    const scope = accessClause(req.user, 'f.person_id');
    const groups = db.prepare(`
      SELECT f.sha256, COUNT(*) AS copies FROM files f
      WHERE f.deleted_at IS NULL AND ${scope.sql}
      GROUP BY f.sha256 HAVING COUNT(*) > 1
      ORDER BY copies DESC
      LIMIT 50
    `).all(...scope.params);
    res.json(groups.map((g) => ({
      copies: g.copies,
      files: db.prepare(`
        SELECT f.id, f.name, f.size, f.created_at, f.folder_id, p.name AS person_name
        FROM files f JOIN persons p ON p.id = f.person_id
        WHERE f.sha256 = ? AND f.deleted_at IS NULL AND ${scope.sql}
        ORDER BY f.created_at
      `).all(g.sha256, ...scope.params),
    })));
  });

  // ---- Stars ------------------------------------------------------------------

  // Body: { kind: 'file' | 'folder', id, starred: boolean }. Stars are personal to each user.
  router.put('/stars', (req, res) => {
    const kind = req.body?.kind;
    if (kind !== 'file' && kind !== 'folder') throw badRequest('kind must be file or folder');
    const id = parseId(req.body?.id);
    if (kind === 'file') access.getFile(req.user, id, { action: 'read' });
    else access.getFolder(req.user, id, { action: 'read' });
    if (req.body?.starred) {
      db.prepare('INSERT OR IGNORE INTO stars (user_id, kind, item_id) VALUES (?, ?, ?)').run(req.user.id, kind, id);
    } else {
      db.prepare('DELETE FROM stars WHERE user_id = ? AND kind = ? AND item_id = ?').run(req.user.id, kind, id);
    }
    res.status(204).end();
  });

  router.get('/starred', (req, res) => {
    const rows = db.prepare(`
      SELECT s.kind, s.item_id AS id FROM stars s WHERE s.user_id = ?
    `).all(req.user.id);
    const items = [];
    for (const row of rows) {
      try {
        if (row.kind === 'file') {
          const f = access.getFile(req.user, row.id, { action: 'read' });
          items.push({ kind: 'file', id: f.id, name: f.name, folder_id: f.folder_id, person_id: f.person_id, size: f.size });
        } else {
          const f = access.getFolder(req.user, row.id, { action: 'read' });
          items.push({ kind: 'folder', id: f.id, name: f.name, folder_id: f.id, person_id: f.person_id, size: null });
        }
      } catch (err) {
        if (!(err instanceof HttpError)) throw err; // no longer visible: skip it
      }
    }
    res.json(items);
  });

  // ---- Sharing ----------------------------------------------------------------

  // Users a share can be given to. Only active accounts; the requester is left out.
  router.get('/share-users', (req, res) => {
    res.json(db.prepare('SELECT id, email FROM users WHERE active = 1 AND id != ? ORDER BY email').all(req.user.id));
  });

  // Who can share: anyone with edit rights on the item. Body: { kind, id, user_id, permission }.
  router.post('/shares', (req, res) => {
    const kind = req.body?.kind;
    if (kind !== 'file' && kind !== 'folder') throw badRequest('kind must be file or folder');
    const id = parseId(req.body?.id);
    const item = kind === 'file'
      ? access.getFile(req.user, id, { action: 'write' })
      : access.getFolder(req.user, id, { action: 'write' });
    const target = db.prepare('SELECT id, email FROM users WHERE id = ? AND active = 1').get(parseId(req.body?.user_id));
    if (!target) throw notFound('User not found');
    if (target.id === req.user.id) throw badRequest('You cannot share with yourself');
    const permission = req.body?.permission;
    if (!SHARE_PERMISSIONS.includes(permission)) throw badRequest('permission must be view, edit or dropbox');
    db.prepare(`
      INSERT INTO shares (kind, item_id, user_id, permission, created_by) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (kind, item_id, user_id) DO UPDATE SET permission = excluded.permission
    `).run(kind, id, target.id, permission, req.user.id);
    const name = item.name;
    audit.record(req.user, 'share.create', { kind, id, name, detail: `${permission} for ${target.email}` });
    res.status(201).json(db.prepare(`
      SELECT s.id, s.kind, s.item_id, s.user_id, s.permission, s.created_at, u.email
      FROM shares s JOIN users u ON u.id = s.user_id
      WHERE s.kind = ? AND s.item_id = ? AND s.user_id = ?
    `).get(kind, id, target.id));
  });

  // Who an item is shared with. Visible to anyone who can edit the item.
  router.get('/shares', (req, res) => {
    const kind = req.query.kind;
    if (kind !== 'file' && kind !== 'folder') throw badRequest('kind must be file or folder');
    const id = parseId(req.query.id);
    if (kind === 'file') access.getFile(req.user, id, { action: 'write' });
    else access.getFolder(req.user, id, { action: 'write' });
    res.json(db.prepare(`
      SELECT s.id, s.permission, s.created_at, u.email FROM shares s JOIN users u ON u.id = s.user_id
      WHERE s.kind = ? AND s.item_id = ? ORDER BY u.email
    `).all(kind, id));
  });

  router.delete('/shares/:id', (req, res) => {
    const share = db.prepare('SELECT * FROM shares WHERE id = ?').get(parseId(req.params.id));
    if (!share) throw notFound('Share not found');
    if (share.kind === 'file') access.getFile(req.user, share.item_id, { action: 'write' });
    else access.getFolder(req.user, share.item_id, { action: 'write' });
    db.prepare('DELETE FROM shares WHERE id = ?').run(share.id);
    const target = db.prepare('SELECT email FROM users WHERE id = ?').get(share.user_id);
    audit.record(req.user, 'share.revoke', { kind: share.kind, id: share.item_id, detail: `removed ${target?.email ?? 'user'}` });
    res.status(204).end();
  });

  // Items shared with the signed-in user, for the "Shared with me" section.
  router.get('/shared', (req, res) => {
    res.json(db.prepare(`
      SELECT s.id AS share_id, s.kind, s.item_id AS id, s.permission, s.created_at,
        owner.email AS shared_by_email,
        CASE s.kind WHEN 'folder' THEN fo.name ELSE fi.name END AS name,
        CASE s.kind WHEN 'folder' THEN fo.person_id ELSE fi.person_id END AS person_id,
        CASE s.kind WHEN 'folder' THEN fo.icon ELSE NULL END AS icon,
        CASE s.kind WHEN 'folder' THEN NULL ELSE fi.size END AS size,
        p.name AS person_name
      FROM shares s
        LEFT JOIN folders fo ON s.kind = 'folder' AND fo.id = s.item_id AND fo.deleted_at IS NULL
        LEFT JOIN files fi ON s.kind = 'file' AND fi.id = s.item_id AND fi.deleted_at IS NULL
        LEFT JOIN users owner ON owner.id = s.created_by
        LEFT JOIN persons p ON p.id = COALESCE(fo.person_id, fi.person_id) AND p.deleted_at IS NULL
      WHERE s.user_id = ? AND (fo.id IS NOT NULL OR fi.id IS NOT NULL)
      ORDER BY s.created_at DESC
    `).all(req.user.id));
  });

  // ---- Search -----------------------------------------------------------------

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

  // ---- Dashboard -----------------------------------------------------------------

  router.get('/dashboard', (req, res) => {
    const scope = accessClause(req.user, 'p.id');
    const persons = db.prepare(`
      SELECT p.id, p.name, p.color,
        (SELECT COUNT(*) FROM files f WHERE f.person_id = p.id AND f.deleted_at IS NULL) AS file_count,
        (SELECT COUNT(*) FROM folders d WHERE d.person_id = p.id AND d.deleted_at IS NULL) AS folder_count,
        (SELECT COALESCE(SUM(f.size), 0) FROM files f WHERE f.person_id = p.id AND f.deleted_at IS NULL) AS bytes
      FROM persons p WHERE p.deleted_at IS NULL AND ${scope.sql}
      ORDER BY p.sort_order, p.name COLLATE NOCASE
    `).all(...scope.params);
    const fileScope = accessClause(req.user, 'f.person_id');
    const expiring = db.prepare(`
      SELECT f.id, f.name, f.expires_on, p.name AS person_name
      FROM files f JOIN persons p ON p.id = f.person_id
      WHERE f.deleted_at IS NULL AND p.deleted_at IS NULL AND f.expires_on IS NOT NULL
        AND f.expires_on <= date('now', '+30 days') AND ${fileScope.sql}
      ORDER BY f.expires_on LIMIT 20
    `).all(...fileScope.params);
    const duplicateGroups = db.prepare(`
      SELECT COUNT(*) AS groups FROM (
        SELECT f.sha256 FROM files f WHERE f.deleted_at IS NULL AND ${fileScope.sql}
        GROUP BY f.sha256 HAVING COUNT(*) > 1
      )
    `).get(...fileScope.params).groups;
    const starred = db.prepare('SELECT COUNT(*) AS count FROM stars WHERE user_id = ?').get(req.user.id).count;
    const storage = persons.reduce((sum, p) => sum + p.bytes, 0);
    const activity = audit.list({ userId: access.isAdmin(req.user) ? null : req.user.id, limit: 20 });
    res.json({ persons, storage_bytes: storage, expiring, duplicate_groups: duplicateGroups, starred, activity });
  });

  return router;
}
