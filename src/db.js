import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

// Schema overview
//   users          accounts. role is 'super_admin' or 'user'.
//   persons        categories created by the super admin. Shared, not owned.
//   person_access  which non-admin users can see a person (assignment).
//   folders        nested inside a person. deleted_at marks soft-deleted rows.
//   files          documents inside a folder (or a person's root). deleted_at as above.
//   tags, file_tags many-to-many labels on files.
//   password_requests  "forgot password" requests waiting for the super admin.
export function openDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      active INTEGER NOT NULL DEFAULT 1,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      theme TEXT NOT NULL DEFAULT 'day',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS persons (
      id INTEGER PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#4f46e5',
      sort_order INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      deleted_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS person_access (
      person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (person_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY,
      person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
      parent_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      deleted_at TEXT,
      deleted_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY,
      person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
      folder_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      stored_name TEXT NOT NULL UNIQUE,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      uploaded_by INTEGER,
      doc_created_at TEXT,
      deleted_at TEXT,
      deleted_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE
    );

    CREATE TABLE IF NOT EXISTS file_tags (
      file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (file_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS password_requests (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_persons_user ON persons(user_id);
    CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(person_id, parent_id);
    CREATE INDEX IF NOT EXISTS idx_files_folder ON files(person_id, folder_id);
    CREATE INDEX IF NOT EXISTS idx_requests_status ON password_requests(status);
  `);
  migrate(db);
  return db;
}

// Adds a column to databases created by an earlier version. Existing rows are kept.
function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function migrate(db) {
  // Version 2: roles (earliest account becomes super admin when none exists).
  ensureColumn(db, 'users', 'role', "TEXT NOT NULL DEFAULT 'user'");
  ensureColumn(db, 'users', 'active', 'INTEGER NOT NULL DEFAULT 1');
  if (!db.prepare("SELECT 1 FROM users WHERE role = 'super_admin'").get()) {
    db.exec("UPDATE users SET role = 'super_admin' WHERE id = (SELECT MIN(id) FROM users)");
  }

  // Version 3: shared persons with assignments, soft delete, tags, recovery, themes.
  ensureColumn(db, 'users', 'must_change_password', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'users', 'theme', "TEXT NOT NULL DEFAULT 'day'");
  ensureColumn(db, 'persons', 'sort_order', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'persons', 'deleted_at', 'TEXT');
  ensureColumn(db, 'persons', 'deleted_by', 'INTEGER');
  ensureColumn(db, 'folders', 'deleted_at', 'TEXT');
  ensureColumn(db, 'folders', 'deleted_by', 'INTEGER');
  ensureColumn(db, 'files', 'uploaded_by', 'INTEGER');
  ensureColumn(db, 'files', 'doc_created_at', 'TEXT');
  ensureColumn(db, 'files', 'deleted_at', 'TEXT');
  ensureColumn(db, 'files', 'deleted_by', 'INTEGER');

  // Creators of existing persons keep access to them.
  db.exec(`
    INSERT OR IGNORE INTO person_access (person_id, user_id)
      SELECT id, user_id FROM persons WHERE user_id IS NOT NULL;
    UPDATE files SET uploaded_by = (SELECT user_id FROM persons WHERE persons.id = files.person_id)
      WHERE uploaded_by IS NULL;
    UPDATE files SET doc_created_at = created_at WHERE doc_created_at IS NULL;
  `);
}
