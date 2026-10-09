-- P1-6: real password reset. Single-use, hashed, 15-minute tokens: the raw
-- value only ever exists in the emailed link, the database stores its SHA-256.
-- Consumption is a guarded DELETE, so two concurrent redemptions cannot both
-- succeed. Indexes cover the per-user purge on request and the expiry sweep.
CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);

CREATE INDEX IF NOT EXISTS idx_password_resets_expires ON password_resets(expires_at);
