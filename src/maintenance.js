import fs from 'node:fs';
import path from 'node:path';

// Upgrades files stored before encryption existed. Each plaintext file is encrypted into a
// temporary file, which then replaces the original. Runs once; files already encrypted are skipped.
export function encryptExistingFiles({ db, vault, uploadsDir }) {
  const plain = db.prepare('SELECT id, stored_name FROM files WHERE encrypted = 0').all();
  for (const row of plain) {
    const target = path.join(uploadsDir, row.stored_name);
    if (!fs.existsSync(target)) continue;
    const temporary = `${target}.enc-tmp`;
    vault.encryptBuffer(temporary, fs.readFileSync(target));
    fs.renameSync(temporary, target);
    db.prepare('UPDATE files SET encrypted = 1 WHERE id = ?').run(row.id);
  }
  return plain.length;
}

// Removes the bin items deleted more than `days` days ago. Items inside a removed folder or
// person go with it. Returns how many top-level items were removed.
export function purgeExpiredTrash({ db, access, audit, days, now = Date.now() }) {
  if (!days) return 0;
  const cutoff = new Date(now - days * 24 * 3600 * 1000).toISOString();
  const expired = access.listTrash().filter((item) => item.deleted_at < cutoff);
  for (const item of expired) {
    if (item.kind === 'person') {
      access.purgePerson({ id: item.id });
    } else if (item.kind === 'folder') {
      access.purgeFolder({ id: item.id });
    } else {
      const file = db.prepare('SELECT id, stored_name FROM files WHERE id = ?').get(item.id);
      if (file) access.purgeFile(file);
    }
  }
  if (expired.length) {
    audit.record(null, 'bin.auto_purge', { detail: `${expired.length} item(s) older than ${days} days` });
  }
  return expired.length;
}
