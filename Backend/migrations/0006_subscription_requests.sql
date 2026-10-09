CREATE TABLE IF NOT EXISTS subscription_requests (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  duration_days INTEGER,
  resolved_at TEXT,
  resolved_by TEXT,
  reject_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_subscription_requests_status ON subscription_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_subscription_requests_business ON subscription_requests(business_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_business ON subscriptions(business_id);

INSERT OR IGNORE INTO plans (id, name, slug, price_cents, interval, features, active, created_at) VALUES
  ('plan_premium', 'Premium', 'premium', 19900, 'month',
   '{"limits":{"campaigns":-1,"customers":-1},"features":["Campagnes illimitees","Clients illimites","Analytics avancees","Support prioritaire 7j/7"]}',
   1, '2026-01-01T00:00:00.000Z');
