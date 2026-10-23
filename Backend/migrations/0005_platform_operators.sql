-- Separate operator platform (campaignflow-platform Worker).
-- Operators live in their own table with their own sessions: a merchant can
-- never be an admin, and an operator credential never resolves on the
-- merchant Worker (which only reads `sessions` joined to `users`).
CREATE TABLE platform_operators (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_platform_operators_email ON platform_operators(email);
CREATE INDEX idx_platform_operators_status ON platform_operators(status);

CREATE TABLE platform_sessions (
  id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_platform_sessions_token ON platform_sessions(token_hash);
CREATE INDEX idx_platform_sessions_operator ON platform_sessions(operator_id);

-- Operator actions are not user actions: `user_id` stays null and the actor is
-- tracked separately, so a merchant's own audit trail never gains a stranger's id.
ALTER TABLE audit_logs ADD COLUMN platform_operator_id TEXT;

-- The operator console no longer runs inside the merchant app, so the merchant
-- flag is dead weight and a standing invitation to confuse the two.
ALTER TABLE users DROP COLUMN is_admin;

-- First operator: provisioned at deployment time via POST /api/bootstrap
-- (Backend/src/platform/routes/bootstrap.ts) with a PLATFORM_BOOTSTRAP_TOKEN
-- secret. No PBKDF2 hash/salt is committed here — a published credential pair
-- on a public repo is an offline brute-force oracle.
