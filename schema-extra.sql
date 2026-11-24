CREATE TABLE IF NOT EXISTS diary_login_attempts (
 username TEXT PRIMARY KEY,
 window_start INTEGER NOT NULL,
 failures INTEGER NOT NULL
);
