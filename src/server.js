import os from 'node:os';
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
  backupDir: config.backupDir,
  onRestart: () => {
    // The data was replaced by a restore. Exit so the process (or Docker) starts again on the restored data.
    console.log('Restore staged. Restarting to apply it.');
    process.exit(0);
  },
});

// IPv4 addresses other devices on the same network can use.
// Virtual adapters (WSL, Hyper-V, Docker, VPNs) are skipped: phones on the Wi-Fi cannot reach them.
const VIRTUAL = /vEthernet|WSL|Docker|VMware|VirtualBox|Loopback|Hyper-V/i;
function lanAddresses() {
  return Object.entries(os.networkInterfaces())
    .filter(([name]) => !VIRTUAL.test(name))
    .flatMap(([, nets]) => nets ?? [])
    .filter((net) => net.family === 'IPv4' && !net.internal)
    .map((net) => net.address);
}

const server = app.listen(config.port, config.host, () => {
  console.log(`DocuKaksh is running (data: ${config.dataDir})`);
  console.log(`  On this computer:  http://localhost:${config.port}`);
  if (config.host === '127.0.0.1') {
    console.log('  Other devices cannot connect because HOST=127.0.0.1. Set HOST=0.0.0.0 in .env to allow them.');
  } else {
    for (const address of lanAddresses()) console.log(`  On your network:   http://${address}:${config.port}`);
    console.log(`  If other devices cannot connect, allow port ${config.port} in the firewall (see the README).`);
  }
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
