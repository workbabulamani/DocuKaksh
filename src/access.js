import fs from 'node:fs';
import path from 'node:path';
import { SUBTREE_CTE, badRequest, notFound } from './http.js';

// Returns a SQL condition that is true when the user may see the person in `personColumn`.
// Super admins see every person. Other users see only persons assigned to them.
export function accessClause(user, personColumn) {
  if (user.role === 'super_admin') return { sql: '1 = 1', params: [] };
  return {
    sql: `EXISTS (SELECT 1 FROM person_access pa WHERE pa.person_id = ${personColumn} AND pa.user_id = ?)`,
    params: [user.id],
  };
}

// Everything that changes or removes documents goes through here, so the soft delete
// rules are in one place.
export function createAccess({ db, uploadsDir }) {
  const storedPath = (storedName) => path.join(uploadsDir, storedName);

  const removeStored = (rows) => {
    for (const row of rows) fs.rmSync(storedPath(row.stored_name), { force: true });
  };

  const getPerson = (user, personId, { trashed = false } = {}) => {
    const access = accessClause(user, 'p.id');
    const row = db.prepare(`
      SELECT p.* FROM persons p
      WHERE p.id = ? AND ${trashed ? '1 = 1' : 'p.deleted_at IS NULL'} AND ${access.sql}
    `).get(personId, ...access.params);
    if (!row) throw notFound('Person not found');
    return row;
  };

  const getFolder = (user, folderId, { trashed = false } = {}) => {
    const access = accessClause(user, 'f.person_id');
    const row = db.prepare(`
      SELECT f.* FROM folders f
      WHERE f.id = ? AND ${trashed ? '1 = 1' : 'f.deleted_at IS NULL'} AND ${access.sql}
    `).get(folderId, ...access.params);
    if (!row) throw notFound('Folder not found');
    return row;
  };

  const getFile = (user, fileId, { trashed = false } = {}) => {
    const access = accessClause(user, 'f.person_id');
    const row = db.prepare(`
      SELECT f.* FROM files f
      WHERE f.id = ? AND ${trashed ? '1 = 1' : 'f.deleted_at IS NULL'} AND ${access.sql}
    `).get(fileId, ...access.params);
    if (!row) throw notFound('File not found');
    return row;
  };

  const isFolderAlive = (folderId) =>
    Boolean(folderId) && db.prepare('SELECT 1 FROM folders WHERE id = ? AND deleted_at IS NULL').get(folderId) !== undefined;

  const isPersonAlive = (personId) =>
    db.prepare('SELECT 1 FROM persons WHERE id = ? AND deleted_at IS NULL').get(personId) !== undefined;

  // ---- Soft delete: marks the item and everything under it with one timestamp -----

  function softDeleteFolder(folderId, userId, stamp) {
    db.prepare(`${SUBTREE_CTE} UPDATE folders SET deleted_at = ?, deleted_by = ?
      WHERE id IN (SELECT id FROM subtree) AND deleted_at IS NULL`).run(folderId, stamp, userId);
    db.prepare(`${SUBTREE_CTE} UPDATE files SET deleted_at = ?, deleted_by = ?
      WHERE folder_id IN (SELECT id FROM subtree) AND deleted_at IS NULL`).run(folderId, stamp, userId);
  }

  function softDeleteFile(fileId, userId, stamp) {
    db.prepare('UPDATE files SET deleted_at = ?, deleted_by = ? WHERE id = ?').run(stamp, userId, fileId);
  }

  function softDeletePerson(personId, userId, stamp) {
    db.prepare('UPDATE persons SET deleted_at = ?, deleted_by = ? WHERE id = ?').run(stamp, userId, personId);
    db.prepare('UPDATE folders SET deleted_at = ?, deleted_by = ? WHERE person_id = ? AND deleted_at IS NULL')
      .run(stamp, userId, personId);
    db.prepare('UPDATE files SET deleted_at = ?, deleted_by = ? WHERE person_id = ? AND deleted_at IS NULL')
      .run(stamp, userId, personId);
  }

  // ---- Restore: only undoes what the same delete did, so older separate deletes stay in the bin

  function restoreFolder(folder) {
    if (folder.parent_id && !isFolderAlive(folder.parent_id)) {
      throw badRequest('Restore the parent folder first');
    }
    if (!isPersonAlive(folder.person_id)) throw badRequest('Restore the person first');
    db.prepare(`${SUBTREE_CTE} UPDATE folders SET deleted_at = NULL, deleted_by = NULL
      WHERE id IN (SELECT id FROM subtree) AND deleted_at = ?`).run(folder.id, folder.deleted_at);
    db.prepare(`${SUBTREE_CTE} UPDATE files SET deleted_at = NULL, deleted_by = NULL
      WHERE folder_id IN (SELECT id FROM subtree) AND deleted_at = ?`).run(folder.id, folder.deleted_at);
  }

  function restoreFile(file) {
    if (file.folder_id && !isFolderAlive(file.folder_id)) throw badRequest('Restore the folder first');
    if (!isPersonAlive(file.person_id)) throw badRequest('Restore the person first');
    db.prepare('UPDATE files SET deleted_at = NULL, deleted_by = NULL WHERE id = ?').run(file.id);
  }

  function restorePerson(person) {
    db.prepare('UPDATE persons SET deleted_at = NULL, deleted_by = NULL WHERE id = ? AND deleted_at = ?')
      .run(person.id, person.deleted_at);
    db.prepare('UPDATE folders SET deleted_at = NULL, deleted_by = NULL WHERE person_id = ? AND deleted_at = ?')
      .run(person.id, person.deleted_at);
    db.prepare('UPDATE files SET deleted_at = NULL, deleted_by = NULL WHERE person_id = ? AND deleted_at = ?')
      .run(person.id, person.deleted_at);
  }

  // ---- Permanent delete (super admin, from the recycle bin only) --------------------

  function purgeFolder(folder) {
    const stored = db.prepare(`${SUBTREE_CTE} SELECT stored_name FROM files WHERE folder_id IN (SELECT id FROM subtree)`)
      .all(folder.id);
    db.prepare('DELETE FROM folders WHERE id = ?').run(folder.id);
    removeStored(stored);
  }

  function purgeFile(file) {
    db.prepare('DELETE FROM files WHERE id = ?').run(file.id);
    removeStored([file]);
  }

  function purgePerson(person) {
    const stored = db.prepare('SELECT stored_name FROM files WHERE person_id = ?').all(person.id);
    db.prepare('DELETE FROM persons WHERE id = ?').run(person.id);
    removeStored(stored);
  }

  // ---- Recycle bin listing ---------------------------------------------------------

  // Lists only the top-most deleted items. Their children are shown inside them.
  function listTrash() {
    const persons = db.prepare(`
      SELECT 'person' AS kind, p.id, p.name, p.id AS person_id, p.name AS person_name, p.deleted_at,
        u.email AS deleted_by_email, 0 AS size
      FROM persons p LEFT JOIN users u ON u.id = p.deleted_by
      WHERE p.deleted_at IS NOT NULL
    `).all();
    const folders = db.prepare(`
      SELECT 'folder' AS kind, f.id, f.name, f.person_id, p.name AS person_name, f.deleted_at,
        u.email AS deleted_by_email, 0 AS size
      FROM folders f
        JOIN persons p ON p.id = f.person_id AND p.deleted_at IS NULL
        LEFT JOIN folders parent ON parent.id = f.parent_id
        LEFT JOIN users u ON u.id = f.deleted_by
      WHERE f.deleted_at IS NOT NULL AND (f.parent_id IS NULL OR parent.deleted_at IS NULL)
    `).all();
    const files = db.prepare(`
      SELECT 'file' AS kind, f.id, f.name, f.person_id, p.name AS person_name, f.deleted_at,
        u.email AS deleted_by_email, f.size
      FROM files f
        JOIN persons p ON p.id = f.person_id AND p.deleted_at IS NULL
        LEFT JOIN folders parent ON parent.id = f.folder_id
        LEFT JOIN users u ON u.id = f.deleted_by
      WHERE f.deleted_at IS NOT NULL AND (f.folder_id IS NULL OR parent.deleted_at IS NULL)
    `).all();
    return [...persons, ...folders, ...files].sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
  }

  return {
    storedPath, removeStored,
    getPerson, getFolder, getFile, isFolderAlive, isPersonAlive,
    softDeleteFolder, softDeleteFile, softDeletePerson,
    restoreFolder, restoreFile, restorePerson,
    purgeFolder, purgeFile, purgePerson,
    listTrash,
  };
}
