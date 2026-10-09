-- WhatsApp broadcast marketing: campaign log + per-business monthly usage counter
CREATE TABLE IF NOT EXISTS whatsapp_campaigns (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  template_name TEXT NOT NULL,
  template_language TEXT NOT NULL DEFAULT 'fr',
  variables TEXT,
  recipients TEXT NOT NULL,
  total_recipients INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING',
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_campaigns_business ON whatsapp_campaigns(business_id, created_at);

ALTER TABLE subscriptions ADD COLUMN whatsapp_messages_sent_this_month INTEGER NOT NULL DEFAULT 0;
ALTER TABLE subscriptions ADD COLUMN whatsapp_usage_month TEXT;
