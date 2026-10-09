-- WhatsApp Web gateway broadcast (parallel feature): campaign log + delivery log
CREATE TABLE IF NOT EXISTS whatsapp_web_campaigns (
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

CREATE INDEX IF NOT EXISTS idx_whatsapp_web_campaigns_business ON whatsapp_web_campaigns(business_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_web_campaigns_active
  ON whatsapp_web_campaigns(business_id) WHERE status IN ('QUEUED', 'PROCESSING');

CREATE TABLE IF NOT EXISTS whatsapp_web_message_log (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  phone TEXT,
  phone_normalized TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_web_log_campaign_phone
  ON whatsapp_web_message_log(campaign_id, phone_normalized);

CREATE INDEX IF NOT EXISTS idx_whatsapp_web_log_business_phone
  ON whatsapp_web_message_log(business_id, phone_normalized);
