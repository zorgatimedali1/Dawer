-- Platform admin flag + account lifecycle for the operator console.
-- `status` blocks sign-in and API access when an account is suspended.
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE';

-- Backfill for rows that predate the column default.
UPDATE users SET is_admin = 0 WHERE is_admin IS NULL;
UPDATE users SET status = 'ACTIVE' WHERE status IS NULL OR status = '';

CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_analytics_events_business_created ON analytics_events(business_id, created_at);
