// Command-line tools for the server machine. Run inside the container with:
//   docker compose exec docukaksh node src/cli.js reset-password admin@example.com
// Use this when no other super admin is available to approve a recovery request.
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.js';
import { hashPassword } from './auth.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const [command, email] = process.argv.slice(2);

function resetPassword(address) {
  const db = openDatabase(path.resolve(dataDir, 'docukaksh.db'));
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

if (command === 'reset-password' && email) {
  resetPassword(email);
} else {
  console.log('Usage: node src/cli.js reset-password <email>');
  process.exitCode = 1;
}
