-- WhatsApp delivery feedback loop: the sender logs every wamid, webhook
-- status callbacks (sent/delivered/read/failed) update the log, and the
-- campaign row carries rolled-up delivered/read counters.
CREATE TABLE IF NOT EXISTS whatsapp_message_log (
  id TEXT PRIMARY KEY,
  wamid TEXT NOT NULL,
  campaign_id TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_message_log_wamid ON whatsapp_message_log(wamid);
CREATE INDEX IF NOT EXISTS idx_whatsapp_message_log_campaign ON whatsapp_message_log(campaign_id, status);

ALTER TABLE whatsapp_campaigns ADD COLUMN delivered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE whatsapp_campaigns ADD COLUMN read_count INTEGER NOT NULL DEFAULT 0;
