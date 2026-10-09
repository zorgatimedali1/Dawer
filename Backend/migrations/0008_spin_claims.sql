CREATE TABLE IF NOT EXISTS spin_claims (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  visitor_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_spin_claims_visitor
  ON spin_claims(campaign_id, visitor_key);

CREATE INDEX IF NOT EXISTS idx_spin_claims_campaign ON spin_claims(campaign_id);
