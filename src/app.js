import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.js';
import { createApiRouter } from './routes.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

// Everything the app writes lives under dataDir: the database, uploads, and preview cache.
export function createApp({ dataDir, cookieSecure = false, maxUploadMb = 100 }) {
  const uploadsDir = path.resolve(dataDir, 'uploads');
  const previewsDir = path.resolve(dataDir, 'previews');
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.mkdirSync(previewsDir, { recursive: true });
  const db = openDatabase(path.resolve(dataDir, 'docukaksh.db'));

  const app = express();
  app.disable('x-powered-by');

  app.use((_req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'",
    );
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  app.use('/api', createApiRouter({
    db,
    uploadsDir,
    previewsDir,
    cookieSecure,
    maxUploadBytes: maxUploadMb * 1024 * 1024,
  }));
  app.use(express.static(publicDir));

  return { app, db };
}
