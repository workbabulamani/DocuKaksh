import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.js';
import { createAccess } from './access.js';
import { createAudit } from './audit.js';
import { createVault } from './vault.js';
import { createApiRouter } from './routes.js';
import { encryptExistingFiles, purgeExpiredTrash } from './maintenance.js';
import { createBackups, applyPendingRestore } from './backup.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const SIX_HOURS = 6 * 3600 * 1000;

// Everything the app writes lives under dataDir: the database, encrypted uploads, and the
// encrypted preview cache. encryptionKey comes from ENCRYPTION_KEY and is required.
export function createApp({
  dataDir,
  encryptionKey,
  cookieSecure = false,
  maxUploadMb = 100,
  recycleRetentionDays = 30,
  loginMaxFailures = 5,
  loginLockMinutes = 15,
  backupDir = '',
  onRestart = () => {},
}) {
  if (!encryptionKey) {
    throw new Error('An encryption key is required. Set ENCRYPTION_KEY in .env (run: npm run gen-key).');
  }
  const uploadsDir = path.resolve(dataDir, 'uploads');
  const previewsDir = path.resolve(dataDir, 'previews');
  const incomingDir = path.resolve(dataDir, 'incoming');
  for (const dir of [uploadsDir, previewsDir]) fs.mkdirSync(dir, { recursive: true });
  // Unfinished uploads from a previous run are never kept. Previews are rebuilt when needed.
  fs.rmSync(incomingDir, { recursive: true, force: true });
  fs.mkdirSync(incomingDir, { recursive: true });
  fs.rmSync(previewsDir, { recursive: true, force: true });
  fs.mkdirSync(previewsDir, { recursive: true });

  // A restore requested from the admin screen is applied before the database is opened.
  applyPendingRestore(path.resolve(dataDir));
  const db = openDatabase(path.resolve(dataDir, 'docukaksh.db'));
  const backups = createBackups({
    db,
    dataDir: path.resolve(dataDir),
    backupDir: backupDir ? path.resolve(backupDir) : path.resolve(dataDir, 'backups'),
    uploadsDir,
  });
  const vault = createVault(encryptionKey);
  const access = createAccess({ db, uploadsDir });
  const audit = createAudit(db);
  encryptExistingFiles({ db, vault, uploadsDir });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);

  app.use((_req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'",
    );
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  app.use('/api', createApiRouter({
    db,
    backups,
    requestRestart: onRestart,
    access,
    audit,
    vault,
    dataDir,
    uploadsDir,
    incomingDir,
    previewsDir,
    cookieSecure,
    maxUploadBytes: maxUploadMb * 1024 * 1024,
    loginMaxFailures,
    loginLockMinutes,
    recycleRetentionDays,
  }));
  app.use(express.static(publicDir));

  // Empties the recycle bin of items older than the retention period. Runs now and every six hours.
  const maintain = () => purgeExpiredTrash({ db, access, audit, days: recycleRetentionDays });
  maintain();
  const timer = setInterval(maintain, SIX_HOURS);
  timer.unref();

  // Scheduled backups are checked every minute.
  const backupTimer = setInterval(() => {
    try {
      const meta = backups.tick();
      if (meta) audit.record(null, 'backup.auto', { name: meta.id, detail: `${meta.files} files` });
    } catch (err) {
      console.error('scheduled backup failed:', err.message);
    }
  }, 60 * 1000);
  backupTimer.unref();

  return {
    app,
    db,
    close() {
      clearInterval(timer);
      clearInterval(backupTimer);
    },
  };
}
