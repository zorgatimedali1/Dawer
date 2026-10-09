CREATE TABLE IF NOT EXISTS action_claims (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  anonymous_id TEXT NOT NULL,
  action TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_action_claims_visitor
  ON action_claims(campaign_id, anonymous_id);

CREATE INDEX IF NOT EXISTS idx_action_claims_campaign ON action_claims(campaign_id);
