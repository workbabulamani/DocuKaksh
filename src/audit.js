// Audit trail: who viewed, downloaded, uploaded, changed, shared or deleted what, and when.
// Entries are written by the server. Nothing in the audit log is ever edited or deleted by the app.

export function createAudit(db) {
  const insert = db.prepare(`
    INSERT INTO audit_log (user_id, user_email, action, target_kind, target_id, target_name, detail)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  return {
    record(user, action, { kind = null, id = null, name = null, detail = null } = {}) {
      insert.run(
        user?.id ?? null,
        user?.email ?? null,
        action,
        kind,
        id,
        name,
        detail == null ? null : String(detail).slice(0, 500),
      );
    },

    // Newest first. Filters are optional: a user id, an action name, and a text search on the target name.
    list({ userId = null, action = null, search = null, limit = 200 } = {}) {
      const where = [];
      const params = [];
      if (userId) {
        where.push('user_id = ?');
        params.push(userId);
      }
      if (action) {
        where.push('action = ?');
        params.push(action);
      }
      if (search) {
        where.push('target_name LIKE ?');
        params.push(`%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      return db.prepare(`
        SELECT id, created_at, user_email, action, target_kind, target_id, target_name, detail
        FROM audit_log ${clause}
        ORDER BY id DESC
        LIMIT ?
      `).all(...params, Math.min(limit, 1000));
    },

    count(sinceIso) {
      return db.prepare('SELECT COUNT(*) AS count FROM audit_log WHERE created_at >= ?').get(sinceIso).count;
    },
  };
}
