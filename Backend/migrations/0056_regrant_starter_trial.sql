-- One-time re-grant of the 7-day Starter trial to merchants who do not have an
-- active subscription: dead trials (status 'trialing' with a past period),
-- expired paid subs and businesses without any subscriptions row at all.
-- While the fresh window runs, lib/subscription-access.ts maps
-- status='trialing' + future period to state 'trial' with canManage=true, so
-- these merchants get the full Starter permission set for 7 days. Businesses
-- with an 'active' subscription row are never touched.
UPDATE subscriptions
SET status = 'trialing',
    plan_id = 'plan_starter',
    current_period_end = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+7 days'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status <> 'active'
  AND (
    current_period_end IS NULL
    OR current_period_end <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  );

INSERT INTO subscriptions (
  id, business_id, plan_id, status, current_period_end, created_at, updated_at
)
SELECT
  lower(hex(randomblob(16))),
  b.id,
  'plan_starter',
  'trialing',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+7 days'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM businesses b
WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.business_id = b.id);
