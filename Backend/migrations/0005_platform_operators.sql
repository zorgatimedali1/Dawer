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

-- First operator. Password hash is PBKDF2-SHA256 / 100000 iterations, produced
-- by Backend/src/lib/crypto.ts hashPassword() — SQL cannot compute it inline.
INSERT INTO platform_operators (id, email, password_hash, salt, first_name, last_name, status, created_at, updated_at)
VALUES (
  '9f1c0d2a-5b3e-4c71-8a64-2d9e7b1f3a55',
  'admin@dawer.com',
  'b794fa8138fe5d10f06c16040270089b2eebeeff0a75a0b2085e2ffc32083ae0',
  '77fdbe77049837f549ed16d7fe525e7f',
  'Platform',
  'Admin',
  'ACTIVE',
  '2026-10-01T00:00:00.000Z',
  '2026-10-01T00:00:00.000Z'
);
