import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { unzipSync } from 'fflate';

// Backups: a consistent snapshot of the database plus every encrypted file.
//   <backupDir>/<id>/docukaksh.db
//   <backupDir>/<id>/uploads/...       unchanged files are hard-linked to the previous backup
//   <backupDir>/<id>/meta.json
// Backups contain encrypted files only. Restoring them also needs the same ENCRYPTION_KEY.

export const MODES = ['manual', 'daily', 'weekly'];
const PENDING = 'restore-pending.json';

const pad = (n) => String(n).padStart(2, '0');
const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function copyOrLink(src, dst) {
  try {
    fs.linkSync(src, dst);
  } catch {
    fs.copyFileSync(src, dst);
  }
}

function folderBytes(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? folderBytes(full) : fs.statSync(full).size;
  }
  return total;
}

export function createBackups({ db, dataDir, backupDir, uploadsDir }) {
  fs.mkdirSync(backupDir, { recursive: true });

  const getSetting = (key, fallback) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? fallback;
  const setSetting = (key, value) => db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));

  function readMeta(id) {
    try {
      return JSON.parse(fs.readFileSync(path.join(backupDir, id, 'meta.json'), 'utf8'));
    } catch {
      return null;
    }
  }

  function list() {
    return fs.readdirSync(backupDir)
      .map((id) => readMeta(id))
      .filter(Boolean)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  function schedule() {
    return {
      mode: getSetting('backup_mode', 'manual'),
      time: getSetting('backup_time', '02:00'),
      weekday: Number(getSetting('backup_weekday', '1')),
      keep: Number(getSetting('backup_keep', '7')),
      lastRun: getSetting('backup_last_run', ''),
    };
  }

  function saveSchedule(input) {
    const mode = input.mode;
    if (!MODES.includes(mode)) throw new Error('Mode must be manual, daily or weekly');
    const time = String(input.time ?? '02:00');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Time must be HH:MM (24 hour)');
    const weekday = Number(input.weekday ?? 1);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new Error('Weekday must be 0 (Sunday) to 6 (Saturday)');
    const keep = Number(input.keep ?? 7);
    if (!Number.isInteger(keep) || keep < 1 || keep > 365) throw new Error('Keep between 1 and 365 backups');
    setSetting('backup_mode', mode);
    setSetting('backup_time', time);
    setSetting('backup_weekday', weekday);
    setSetting('backup_keep', keep);
    return schedule();
  }

  function prune(keep) {
    for (const meta of list().slice(keep)) fs.rmSync(path.join(backupDir, meta.id), { recursive: true, force: true });
  }

  function create(label = 'manual') {
    const now = new Date();
    const id = now.toISOString().replace(/[:.]/g, '-');
    const target = path.join(backupDir, id);
    const previous = list()[0];
    fs.mkdirSync(path.join(target, 'uploads'), { recursive: true });

    // A consistent copy of the database, taken while the app keeps running.
    db.exec(`VACUUM INTO '${path.join(target, 'docukaksh.db').replace(/'/g, "''")}'`);

    let files = 0;
    if (fs.existsSync(uploadsDir)) {
      for (const name of fs.readdirSync(uploadsDir)) {
        const src = path.join(uploadsDir, name);
        const dst = path.join(target, 'uploads', name);
        const old = previous ? path.join(backupDir, previous.id, 'uploads', name) : null;
        if (old && fs.existsSync(old) && fs.statSync(old).size === fs.statSync(src).size) copyOrLink(old, dst);
        else fs.copyFileSync(src, dst);
        files++;
      }
    }
    const meta = { id, createdAt: now.toISOString(), label, files, bytes: folderBytes(target) };
    fs.writeFileSync(path.join(target, 'meta.json'), JSON.stringify(meta, null, 2));
    prune(schedule().keep);
    return meta;
  }

  // Called once a minute. Runs a scheduled backup when it is due and not yet done for that slot.
  function tick(now = new Date()) {
    const s = schedule();
    if (s.mode === 'manual') return null;
    const [hh, mm] = s.time.split(':').map(Number);
    if (now.getHours() !== hh || now.getMinutes() !== mm) return null;
    if (s.mode === 'weekly' && now.getDay() !== s.weekday) return null;
    const today = localDay(now);
    if (s.lastRun.startsWith(today)) return null;
    setSetting('backup_last_run', now.toISOString());
    return create('scheduled');
  }

  function remove(id) {
    if (!readMeta(id)) throw new Error('Backup not found');
    fs.rmSync(path.join(backupDir, id), { recursive: true, force: true });
  }

  function folderFor(id) {
    const meta = readMeta(id);
    if (!meta) throw new Error('Backup not found');
    return path.join(backupDir, id);
  }

  // Writes the backup folder as a zip file, streamed to the response. Stored without compression,
  // because encrypted files do not compress anyway. Zip entries are limited to 4 GB in total.
  async function writeZip(id, out) {
    const root = folderFor(id);
    const entries = [];
    const walk = (dir, rel) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const name = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(full, name);
        else entries.push({ name, full, size: fs.statSync(full).size });
      }
    };
    walk(root, id);

    let offset = 0;
    const central = [];
    const write = (buf) => {
      out.write(buf);
      offset += buf.length;
    };
    const dos = new Date();
    const time = (dos.getHours() << 11) | (dos.getMinutes() << 5) | (dos.getSeconds() >> 1);
    const date = ((dos.getFullYear() - 1980) << 9) | ((dos.getMonth() + 1) << 5) | dos.getDate();

    for (const entry of entries) {
      const name = Buffer.from(entry.name, 'utf8');
      const localOffset = offset;
      const head = Buffer.alloc(30);
      head.writeUInt32LE(0x04034b50, 0);
      head.writeUInt16LE(20, 4);
      head.writeUInt16LE(0x0808, 6); // data descriptor follows, UTF-8 names
      head.writeUInt16LE(0, 8);
      head.writeUInt16LE(time, 10);
      head.writeUInt16LE(date, 12);
      head.writeUInt32LE(0, 14);
      head.writeUInt32LE(0, 18);
      head.writeUInt32LE(0, 22);
      head.writeUInt16LE(name.length, 26);
      head.writeUInt16LE(0, 28);
      write(Buffer.concat([head, name]));

      let crc = 0;
      let size = 0;
      for await (const chunk of fs.createReadStream(entry.full)) {
        crc = zlib.crc32(chunk, crc);
        size += chunk.length;
        write(chunk);
      }
      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc >>> 0, 4);
      descriptor.writeUInt32LE(size, 8);
      descriptor.writeUInt32LE(size, 12);
      write(descriptor);

      const dir = Buffer.alloc(46);
      dir.writeUInt32LE(0x02014b50, 0);
      dir.writeUInt16LE(20, 4);
      dir.writeUInt16LE(20, 6);
      dir.writeUInt16LE(0x0808, 8);
      dir.writeUInt16LE(0, 10);
      dir.writeUInt16LE(time, 12);
      dir.writeUInt16LE(date, 14);
      dir.writeUInt32LE(crc >>> 0, 16);
      dir.writeUInt32LE(size, 20);
      dir.writeUInt32LE(size, 24);
      dir.writeUInt16LE(name.length, 28);
      dir.writeUInt32LE(localOffset, 42);
      central.push(Buffer.concat([dir, name]));
    }

    const centralStart = offset;
    for (const record of central) write(record);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(offset - centralStart, 12);
    end.writeUInt32LE(centralStart, 16);
    write(end);
    out.end();
  }

  // Restoring a file that was uploaded: unpack it into a new backup entry, then stage it.
  function importZip(buffer) {
    const files = unzipSync(new Uint8Array(buffer));
    const hasDb = Object.keys(files).some((name) => name.endsWith('docukaksh.db'));
    if (!hasDb) throw new Error('This file is not a DocuKaksh backup (docukaksh.db is missing)');
    const id = `uploaded-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const target = path.join(backupDir, id);
    for (const [name, bytes] of Object.entries(files)) {
      const clean = name.replace(/\\/g, '/');
      if (clean.includes('..') || path.isAbsolute(clean)) throw new Error('The backup file has an unsafe path');
      const parts = clean.split('/');
      const relative = parts.length > 1 ? parts.slice(1).join('/') : parts[0];
      if (!relative) continue;
      const dest = path.join(target, relative);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, bytes);
    }
    const meta = { id, createdAt: new Date().toISOString(), label: 'uploaded', files: 0, bytes: folderBytes(target) };
    fs.writeFileSync(path.join(target, 'meta.json'), JSON.stringify(meta, null, 2));
    return meta;
  }

  // Restores happen at the next start: the current data is moved aside first, never deleted.
  function stageRestore(id) {
    folderFor(id);
    fs.writeFileSync(path.join(dataDir, PENDING), JSON.stringify({ source: path.join(backupDir, id), requestedAt: new Date().toISOString() }));
  }

  return { list, schedule, saveSchedule, create, tick, remove, writeZip, importZip, stageRestore, folderFor, readMeta };
}

// Runs before the database is opened. If a restore was requested, the current database and
// uploads are moved into a dated folder, and the backup takes their place.
export function applyPendingRestore(dataDir) {
  const marker = path.join(dataDir, PENDING);
  if (!fs.existsSync(marker)) return null;
  const { source } = JSON.parse(fs.readFileSync(marker, 'utf8'));
  if (!fs.existsSync(path.join(source, 'docukaksh.db'))) {
    fs.rmSync(marker);
    throw new Error(`Cannot restore: ${source} has no database`);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const aside = path.join(dataDir, `before-restore-${stamp}`);
  fs.mkdirSync(aside, { recursive: true });
  for (const name of ['docukaksh.db', 'docukaksh.db-wal', 'docukaksh.db-shm']) {
    const current = path.join(dataDir, name);
    if (fs.existsSync(current)) fs.renameSync(current, path.join(aside, name));
  }
  const uploads = path.join(dataDir, 'uploads');
  if (fs.existsSync(uploads)) fs.renameSync(uploads, path.join(aside, 'uploads'));

  fs.copyFileSync(path.join(source, 'docukaksh.db'), path.join(dataDir, 'docukaksh.db'));
  const sourceUploads = path.join(source, 'uploads');
  fs.mkdirSync(uploads, { recursive: true });
  if (fs.existsSync(sourceUploads)) {
    for (const name of fs.readdirSync(sourceUploads)) {
      try {
        fs.linkSync(path.join(sourceUploads, name), path.join(uploads, name));
      } catch {
        fs.copyFileSync(path.join(sourceUploads, name), path.join(uploads, name));
      }
    }
  }
  fs.rmSync(marker);
  return { aside, source };
}
