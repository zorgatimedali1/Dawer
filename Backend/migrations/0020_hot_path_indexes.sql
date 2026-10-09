-- Hot-path indexes surfaced by the production-readiness audit.
-- Every authenticated request resolves the session by token hash, so the
-- lookup runs a full table scan without an index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);

-- Customer merge / analytics reads participations by customer and reward.
CREATE INDEX IF NOT EXISTS idx_participations_customer ON participations(customer_id);
CREATE INDEX IF NOT EXISTS idx_participations_reward ON participations(reward_id);

-- Coupon listings filter by campaign, reward and business status.
CREATE INDEX IF NOT EXISTS idx_coupons_campaign ON coupons(campaign_id);
CREATE INDEX IF NOT EXISTS idx_coupons_reward ON coupons(reward_id);
CREATE INDEX IF NOT EXISTS idx_coupons_business_status ON coupons(business_id, status);

-- Reward pages and rollups read rewards per business.
CREATE INDEX IF NOT EXISTS idx_rewards_business ON rewards(business_id);

-- Audit trail reads per business.
CREATE INDEX IF NOT EXISTS idx_audit_logs_business_created ON audit_logs(business_id, created_at);

-- Spin hot path: WHERE business_id = ? AND LOWER(COALESCE(email, phone, id)) = ?
CREATE INDEX IF NOT EXISTS idx_customers_identity
  ON customers(business_id, LOWER(COALESCE(email, phone, id)));

-- Redundant: idx_analytics_business_created already covers the (business_id)
-- prefix, users.email is already UNIQUE.
DROP INDEX IF EXISTS idx_analytics_business;
DROP INDEX IF EXISTS idx_users_email;
