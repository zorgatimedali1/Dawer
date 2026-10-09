
-- Anti-fraud play rules per campaign (JSON) and an append-only audit trail of plays
ALTER TABLE campaigns ADD COLUMN play_rules TEXT;

CREATE TABLE IF NOT EXISTS spin_events (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  visitor_key TEXT NOT NULL,
  device_hash TEXT,
  ip_hash TEXT,
  ua_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_spin_events_campaign_created
  ON spin_events(campaign_id, created_at);

CREATE INDEX IF NOT EXISTS idx_spin_events_ip
  ON spin_events(campaign_id, ip_hash, created_at);

CREATE INDEX IF NOT EXISTS idx_spin_events_visitor
  ON spin_events(campaign_id, visitor_key, created_at);
