import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Every secret and deployment setting comes from the environment. For local runs they are read
// from a .env file in the project root (never committed). In Docker, docker compose passes .env.
// Variables already set in the real environment win over the file.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const int = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && value !== undefined && value !== '' ? n : fallback;
};

export function loadConfig(env = process.env) {
  const keyText = env.ENCRYPTION_KEY ?? '';
  let encryptionKey = null;
  if (keyText) {
    encryptionKey = Buffer.from(keyText, 'base64');
    if (encryptionKey.length !== 32) {
      throw new Error('ENCRYPTION_KEY must be 32 random bytes, base64 encoded. Run: npm run gen-key');
    }
  }
  return {
    port: int(env.PORT, 3000),
    dataDir: path.resolve(env.DATA_DIR || path.join(root, 'data')),
    encryptionKey,
    cookieSecure: env.COOKIE_SECURE === 'true',
    maxUploadMb: int(env.MAX_UPLOAD_MB, 100),
    // Items in the recycle bin are removed for good after this many days. 0 keeps them forever.
    recycleRetentionDays: int(env.RECYCLE_RETENTION_DAYS, 30),
    // Failed sign-ins: after this many failures for one account or address, sign-in is locked.
    loginMaxFailures: int(env.LOGIN_MAX_FAILURES, 5),
    loginLockMinutes: int(env.LOGIN_LOCK_MINUTES, 15),
  };
}
