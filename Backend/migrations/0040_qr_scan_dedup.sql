-- QR scan tracking (public campaign page load).
--
-- One QR_SCANNED row per visitor per UTC day: `event_data` holds
-- `<visitor_hash>|<YYYY-MM-DD>` where visitor_hash is sha256(campaign:visitor),
-- the same identity used for participations.visitor_hash. The partial unique
-- index makes the INSERT idempotent, so a refresh, a back-button re-entry or
-- two concurrent first loads can never inflate the merchant's scan count.
CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_scan_dedup
  ON analytics_events(business_id, campaign_id, event_data)
  WHERE event_type = 'QR_SCANNED';
