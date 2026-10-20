-- SMS broadcast marketing (SMS-Gate 3rd-party gateway): campaign log, per-recipient
-- delivery log and stop-list, plus the per-business monthly usage counters.
CREATE TABLE IF NOT EXISTS sms_campaigns (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  message TEXT NOT NULL,
  recipients TEXT NOT NULL,
  total_recipients INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sms_campaigns_business ON sms_campaigns(business_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_campaigns_active
  ON sms_campaigns(business_id) WHERE status IN ('QUEUED', 'PROCESSING');

CREATE INDEX IF NOT EXISTS idx_sms_campaigns_status ON sms_campaigns(status, created_at);

CREATE TABLE IF NOT EXISTS sms_message_log (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  phone_normalized TEXT NOT NULL,
  gateway_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_message_log_unique
  ON sms_message_log(campaign_id, phone_normalized);

CREATE INDEX IF NOT EXISTS idx_sms_message_log_gateway
  ON sms_message_log(gateway_message_id);

-- Suppression list keyed by E.164 digits; a row here silences future sends.
CREATE TABLE IF NOT EXISTS sms_suppression (
  phone_normalized TEXT PRIMARY KEY,
  reason TEXT NOT NULL DEFAULT 'STOP',
  business_id TEXT,
  created_at TEXT NOT NULL
);

ALTER TABLE subscriptions ADD COLUMN sms_messages_sent_this_month INTEGER NOT NULL DEFAULT 0;
ALTER TABLE subscriptions ADD COLUMN sms_usage_month TEXT;

ALTER TABLE businesses ADD COLUMN sms_enabled INTEGER NOT NULL DEFAULT 0;
