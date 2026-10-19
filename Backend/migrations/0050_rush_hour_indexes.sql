-- Rush-hour indexes surfaced by the infrastructure & performance audit.
--
-- Spin hot path: the per-campaign daily spin cap counts today's participations
-- (`WHERE campaign_id = ? AND created_at >= ?`). The existing single-column
-- index walks every row the campaign ever produced once per spin; the
-- composite keeps the count bounded by one day's traffic.
CREATE INDEX IF NOT EXISTS idx_participations_campaign_created
  ON participations(campaign_id, created_at);

-- QR dashboard lists read `WHERE business_id = ? ... ORDER BY created_at DESC`.
-- Without a composite the sort happens on the full per-business set.
CREATE INDEX IF NOT EXISTS idx_qr_codes_business_created
  ON qr_codes(business_id, created_at);

-- Customer-details submit resolves duplicates by exact phone match once the
-- `LOWER(COALESCE(email,...)) OR COALESCE(phone,...)` OR-expression is split
-- into two single-column lookups; this index serves the phone half.
CREATE INDEX IF NOT EXISTS idx_customers_business_phone
  ON customers(business_id, phone);

-- Redundant: idx_spin_claims_visitor's (campaign_id, visitor_key) prefix
-- already answers every campaign_id lookup on spin_claims.
DROP INDEX IF EXISTS idx_spin_claims_campaign;

-- The cron reconciler scans `WHERE status IN ('PENDING','PROCESSING')
-- AND updated_at < ? ORDER BY updated_at` across all tenants each tick.
CREATE INDEX IF NOT EXISTS idx_whatsapp_campaigns_status
  ON whatsapp_campaigns(status, updated_at);
