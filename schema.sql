-- MyDiary: encrypted vault only. Health data NEVER stored in SQL plaintext.
CREATE TABLE IF NOT EXISTS diary_users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 auth_salt TEXT NOT NULL,
 auth_hash TEXT NOT NULL,
 vault_salt TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS diary_sessions (
 token_hash TEXT PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES diary_users(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS diary_sessions_user ON diary_sessions(user_id);
CREATE TABLE IF NOT EXISTS diary_vaults (
 user_id INTEGER PRIMARY KEY REFERENCES diary_users(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL DEFAULT 0,
 ciphertext TEXT NOT NULL,
 updated_at INTEGER NOT NULL
);
