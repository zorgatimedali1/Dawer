-- P2-5: an anonymous spin (no email/phone) must not materialize a customer
-- row — otherwise a farm fills the plan's storage quota and bricks every new
-- visitor with a permanent 409. `customer_id` becomes nullable and is filled
-- in later by the details endpoint, which runs under the quota check.
-- `coupons.participation_id` links an issued coupon back to the exact spin
-- that won it, so attaching details to an anonymous win never has to guess
-- between coupons that share a customer-less campaign row.
CREATE TABLE participations_v2 (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  customer_id TEXT,
  reward_id TEXT,
  result TEXT,
  visitor_hash TEXT,
  distance_meters REAL,
  created_at TEXT NOT NULL
);
INSERT INTO participations_v2 (id, campaign_id, customer_id, reward_id, result, visitor_hash, distance_meters, created_at)
  SELECT id, campaign_id, customer_id, reward_id, result, visitor_hash, distance_meters, created_at FROM participations;
DROP TABLE participations;
ALTER TABLE participations_v2 RENAME TO participations;
CREATE INDEX IF NOT EXISTS idx_participations_campaign ON participations(campaign_id);
CREATE INDEX IF NOT EXISTS idx_participations_customer ON participations(customer_id);
CREATE INDEX IF NOT EXISTS idx_participations_reward ON participations(reward_id);

CREATE TABLE coupons_v2 (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  customer_id TEXT,
  participation_id TEXT,
  reward_id TEXT,
  code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'ISSUED',
  issued_at TEXT NOT NULL,
  expires_at TEXT,
  redeemed_at TEXT
);
INSERT INTO coupons_v2 (id, business_id, campaign_id, customer_id, participation_id, reward_id, code, status, issued_at, expires_at, redeemed_at)
  SELECT id, business_id, campaign_id, customer_id, NULL, reward_id, code, status, issued_at, expires_at, redeemed_at FROM coupons;
DROP TABLE coupons;
ALTER TABLE coupons_v2 RENAME TO coupons;
CREATE INDEX IF NOT EXISTS idx_coupons_customer ON coupons(customer_id);
CREATE INDEX IF NOT EXISTS idx_coupons_campaign ON coupons(campaign_id);
CREATE INDEX IF NOT EXISTS idx_coupons_reward ON coupons(reward_id);
CREATE INDEX IF NOT EXISTS idx_coupons_business_status ON coupons(business_id, status);
CREATE INDEX IF NOT EXISTS idx_coupons_participation ON coupons(participation_id);
