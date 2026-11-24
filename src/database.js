// Reuse a successful check within an isolate. Each request owns its own D1 I/O.
const ready = new WeakSet();

export async function ensureDiarySchema(db, recheck = false) {
  if (!recheck && ready.has(db)) return;
  const result = await db.prepare(
    "SELECT COUNT(*) AS present FROM sqlite_schema WHERE " +
    "(type = 'table' AND name IN ('diary_users', 'diary_sessions', 'diary_vaults', 'diary_login_attempts')) " +
    "OR (type = 'index' AND name = 'diary_sessions_user')"
  ).first();

  if (result.present !== 5) {
    const { default: schema } = await import("../schema.sql");
    const statements = schema.replace(/^\s*--[^\n]*/gm, "").split(";")
      .map(statement => statement.trim()).filter(Boolean);
    // D1 applies the batch atomically. Every statement uses IF NOT EXISTS.
    await db.batch(statements.map(statement => db.prepare(statement)));
  }
  ready.add(db);
}
