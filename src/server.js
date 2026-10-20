import { createApp } from './app.js';
import { loadConfig } from './config.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(`Configuration error: ${err.message}`);
  process.exit(1);
}

if (!config.encryptionKey) {
  console.error('ENCRYPTION_KEY is not set. Create one with: npm run gen-key, then put it in .env');
  process.exit(1);
}

const { app, db, close } = createApp({
  dataDir: config.dataDir,
  encryptionKey: config.encryptionKey,
  cookieSecure: config.cookieSecure,
  maxUploadMb: config.maxUploadMb,
  recycleRetentionDays: config.recycleRetentionDays,
  loginMaxFailures: config.loginMaxFailures,
  loginLockMinutes: config.loginLockMinutes,
});

const server = app.listen(config.port, () => {
  console.log(`DocuKaksh listening on http://localhost:${config.port} (data: ${config.dataDir})`);
});

// Close the server and database cleanly so SQLite flushes its WAL when Docker stops the container.
function shutdown() {
  close();
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
