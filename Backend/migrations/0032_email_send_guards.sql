-- Email send guards: unsubscribe/bounce suppression list + daily marketing
-- reserve (keeps transactional sends such as password resets alive when the
-- free-tier 100/day quota is near).

CREATE TABLE IF NOT EXISTS email_suppression (
  email TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  business_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_daily_usage (
  day TEXT PRIMARY KEY,
  reserved INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- The active-campaign partial index must cover PAUSED campaigns too:
-- a campaign paused on the daily quota still owns its business slot.
DROP INDEX IF EXISTS idx_email_campaigns_active;
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_campaigns_active
  ON email_campaigns(business_id) WHERE status IN ('PENDING', 'PROCESSING', 'PAUSED');
