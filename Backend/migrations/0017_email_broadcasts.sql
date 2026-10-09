-- Email broadcast marketing (Resend): campaign log + per-user monthly usage counter
CREATE TABLE IF NOT EXISTS email_campaigns (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  sender_name TEXT,
  total_recipients INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING',
  last_error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_email_campaigns_business ON email_campaigns(business_id, created_at);

ALTER TABLE users ADD COLUMN email_messages_sent_this_month INTEGER DEFAULT 0;
-- SQLite forbids non-constant defaults (CURRENT_TIMESTAMP) on ALTER TABLE ADD COLUMN;
-- NULL reads as "no usage this month" and the first reserve stamps the reset date.
ALTER TABLE users ADD COLUMN email_reset_date DATETIME DEFAULT NULL;
