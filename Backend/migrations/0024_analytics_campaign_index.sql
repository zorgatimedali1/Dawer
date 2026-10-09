-- Campaign detail events are read newest-first per campaign; without this
-- index the LIMIT 50 query sorts the whole analytics_events table per call.
CREATE INDEX IF NOT EXISTS idx_analytics_campaign_created
  ON analytics_events(campaign_id, created_at);
