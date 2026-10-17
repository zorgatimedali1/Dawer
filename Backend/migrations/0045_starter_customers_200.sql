-- The Starter plan's customer-storage quota grows from 100 to 200 contacts.
-- The quota is a rolling window (at the cap, the oldest stored customer is
-- evicted and the newest winner takes their slot), so this only widens how
-- many recent winners a Starter merchant can see — it is never a hard stop.
UPDATE plans
SET features = json_set(features, '$.limits.customers', 200)
WHERE slug = 'starter';
