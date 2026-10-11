-- Hot path: the spin flow and the campaign page both read rewards per
-- campaign on every request; without this index they scan the whole table.
CREATE INDEX IF NOT EXISTS idx_rewards_campaign ON rewards(campaign_id);
