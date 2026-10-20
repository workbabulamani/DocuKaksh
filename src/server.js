import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 3000;
const dataDir = process.env.DATA_DIR || path.join(root, 'data');

const { app, db } = createApp({
  dataDir,
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB) || 100,
});

const server = app.listen(port, () => {
  console.log(`DocuKaksh listening on http://localhost:${port} (data: ${dataDir})`);
});

// Close the server and database cleanly so SQLite flushes its WAL when Docker stops the container.
function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
