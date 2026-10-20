// Command-line tools for the server machine.
//   npm run gen-key                              create an encryption key for .env
//   docker compose exec docukaksh node src/cli.js reset-password admin@example.com
// reset-password is for when no other super admin can approve a recovery request.
import crypto from 'node:crypto';
import path from 'node:path';
import { openDatabase } from './db.js';
import { hashPassword } from './auth.js';
import { loadConfig } from './config.js';

const [command, argument] = process.argv.slice(2);

function genKey() {
  console.log(crypto.randomBytes(32).toString('base64'));
  console.error('Put this in .env as ENCRYPTION_KEY. Keep a copy somewhere safe: without it the files cannot be opened.');
}

function resetPassword(address) {
  const config = loadConfig();
  const db = openDatabase(path.resolve(config.dataDir, 'docukaksh.db'));
  const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(address.trim().toLowerCase());
  if (!user) {
    console.error(`No account with email ${address}`);
    process.exitCode = 1;
  } else {
    const temporaryPassword = crypto.randomBytes(9).toString('base64url');
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?')
      .run(hashPassword(temporaryPassword), user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    console.log(`Temporary password for ${user.email}: ${temporaryPassword}`);
    console.log('They must change it at the next sign-in.');
  }
  db.close();
}

// Turns off two-factor sign-in for an account, for when the authenticator app is lost.
function disableTwoFactor(address) {
  const config = loadConfig();
  const db = openDatabase(path.resolve(config.dataDir, 'docukaksh.db'));
  const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(address.trim().toLowerCase());
  if (!user) {
    console.error(`No account with email ${address}`);
    process.exitCode = 1;
  } else {
    db.prepare("UPDATE users SET totp_enabled = 0, totp_secret = '', totp_last_step = 0 WHERE id = ?").run(user.id);
    db.prepare('DELETE FROM trusted_devices WHERE user_id = ?').run(user.id);
    console.log(`Two-factor sign-in is now off for ${user.email}.`);
  }
  db.close();
}

if (command === 'gen-key') {
  genKey();
} else if (command === 'disable-2fa' && argument) {
  disableTwoFactor(argument);
} else if (command === 'reset-password' && argument) {
  resetPassword(argument);
} else {
  console.log('Usage:');
  console.log('  node src/cli.js gen-key');
  console.log('  node src/cli.js reset-password <email>');
  console.log('  node src/cli.js disable-2fa <email>');
  process.exitCode = 1;
}
