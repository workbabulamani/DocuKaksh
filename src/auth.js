import crypto from 'node:crypto';

export const SESSION_COOKIE = 'dk_session';
const SESSION_DAYS = 30;

// scrypt is built into Node, so there are no native password libraries to compile.
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// Only a hash of the session token is stored, so a leaked database cannot be used to sign in.
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export function createSession(db, userId) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(sha256(token), userId, expiresAt);
  return { token, expiresAt };
}

// Disabled accounts stop matching here, so their existing sessions stop working immediately.
export function findSessionUser(db, token) {
  if (!token) return null;
  return db.prepare(`
    SELECT u.id, u.email, u.role, u.theme, u.must_change_password FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1
  `).get(sha256(token), Date.now()) ?? null;
}

export function deleteSession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function deleteUserSessions(db, userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}
