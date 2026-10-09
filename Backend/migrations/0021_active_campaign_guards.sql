-- Unique guards for rows the application treats as "one per business", plus
-- the dedupe that must run before each index is created. Without them two
-- concurrent requests can create duplicate active broadcasts (permanent 409
-- for the tenant), duplicate subscriptions/settings (stale reads) and
-- duplicate customer records for the same email.

-- ---------------------------------------------------------------------------
-- 1) Settle stranded broadcasts: no progress for 30 minutes. The runtime cron
--    reconciler does this continuously; this clears the backlog so the unique
--    guards below can be created. Marker text feeds the refund in step 3.
-- ---------------------------------------------------------------------------
UPDATE whatsapp_campaigns
SET status = 'FAILED',
    last_error = 'Settled by migration 0021: no progress for 30 minutes.',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status IN ('PENDING', 'PROCESSING')
  AND updated_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 minutes');

UPDATE email_campaigns
SET status = 'FAILED',
    last_error = 'Settled by migration 0021: no progress for 30 minutes.',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status IN ('PENDING', 'PROCESSING')
  AND updated_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 minutes');

-- ---------------------------------------------------------------------------
-- 2) Keep only the newest active broadcast per business: the older one cannot
--    have a live sender (the API 409s a second create), so it is a leftover.
-- ---------------------------------------------------------------------------
UPDATE whatsapp_campaigns
SET status = 'FAILED',
    last_error = 'Settled by migration 0021: superseded by a newer broadcast.',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status IN ('PENDING', 'PROCESSING')
  AND id NOT IN (
    SELECT keep_id FROM (
      SELECT id AS keep_id, ROW_NUMBER() OVER (PARTITION BY business_id ORDER BY rowid DESC) AS rn
      FROM whatsapp_campaigns
      WHERE status IN ('PENDING', 'PROCESSING')
    )
    WHERE rn = 1
  );

UPDATE email_campaigns
SET status = 'FAILED',
    last_error = 'Settled by migration 0021: superseded by a newer broadcast.',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status IN ('PENDING', 'PROCESSING')
  AND id NOT IN (
    SELECT keep_id FROM (
      SELECT id AS keep_id, ROW_NUMBER() OVER (PARTITION BY business_id ORDER BY rowid DESC) AS rn
      FROM email_campaigns
      WHERE status IN ('PENDING', 'PROCESSING')
    )
    WHERE rn = 1
  );

-- ---------------------------------------------------------------------------
-- 3) Refund the reservations held by the broadcasts settled above — only the
--    ones created this month (older reservations were already zeroed by the
--    lazy monthly reset).
-- ---------------------------------------------------------------------------
UPDATE subscriptions
SET whatsapp_messages_sent_this_month = max(0, whatsapp_messages_sent_this_month - r.refund)
FROM (
  SELECT business_id, SUM(MAX(total_recipients - sent_count, 0)) AS refund
  FROM whatsapp_campaigns
  WHERE status = 'FAILED'
    AND last_error LIKE 'Settled by migration 0021:%'
    AND substr(created_at, 1, 7) = strftime('%Y-%m', 'now')
  GROUP BY business_id
) r
WHERE subscriptions.business_id = r.business_id
  AND subscriptions.whatsapp_usage_month = strftime('%Y-%m', 'now');

UPDATE users
SET email_messages_sent_this_month = max(0, email_messages_sent_this_month - r.refund)
FROM (
  SELECT user_id, SUM(MAX(total_recipients - sent_count, 0)) AS refund
  FROM email_campaigns
  WHERE status = 'FAILED'
    AND last_error LIKE 'Settled by migration 0021:%'
    AND substr(created_at, 1, 7) = strftime('%Y-%m', 'now')
  GROUP BY user_id
) r
WHERE users.id = r.user_id
  AND substr(COALESCE(users.email_reset_date, ''), 1, 7) = strftime('%Y-%m', 'now');

-- ---------------------------------------------------------------------------
-- 4) Subscriptions: one active row per business. Sync the usage counters to
--    the highest value across duplicates first so no reservation is lost.
-- ---------------------------------------------------------------------------
UPDATE subscriptions
SET whatsapp_messages_sent_this_month = (
      SELECT MAX(s2.whatsapp_messages_sent_this_month)
      FROM subscriptions s2 WHERE s2.business_id = subscriptions.business_id),
    whatsapp_usage_month = (
      SELECT s2.whatsapp_usage_month
      FROM subscriptions s2 WHERE s2.business_id = subscriptions.business_id
      ORDER BY s2.whatsapp_messages_sent_this_month DESC, s2.rowid DESC LIMIT 1)
WHERE business_id IN (
  SELECT business_id FROM subscriptions GROUP BY business_id HAVING COUNT(*) > 1
);

DELETE FROM subscriptions
WHERE id NOT IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY business_id ORDER BY rowid DESC) AS rn
    FROM subscriptions
  )
  WHERE rn = 1
);

DROP INDEX IF EXISTS idx_subscriptions_business;
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_business ON subscriptions(business_id);

-- ---------------------------------------------------------------------------
-- 5) Settings and branding: one row per business (keep the most recent).
-- ---------------------------------------------------------------------------
DELETE FROM business_settings
WHERE id NOT IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY business_id ORDER BY updated_at DESC, rowid DESC) AS rn
    FROM business_settings
  )
  WHERE rn = 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_business_settings_business ON business_settings(business_id);

DELETE FROM business_branding
WHERE id NOT IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY business_id ORDER BY updated_at DESC, rowid DESC) AS rn
    FROM business_branding
  )
  WHERE rn = 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_business_branding_business ON business_branding(business_id);

-- ---------------------------------------------------------------------------
-- 6) Customers: merge duplicates that share an email within one business
--    (keep the most recently updated), re-pointing their participations and
--    coupons before the rows are deleted.
-- ---------------------------------------------------------------------------
WITH dupes AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY business_id, LOWER(email)
           ORDER BY updated_at DESC, rowid DESC
         ) AS rn,
         FIRST_VALUE(id) OVER (
           PARTITION BY business_id, LOWER(email)
           ORDER BY updated_at DESC, rowid DESC
         ) AS keep_id
  FROM customers
  WHERE email IS NOT NULL AND email <> ''
)
UPDATE participations
SET customer_id = (SELECT keep_id FROM dupes WHERE dupes.id = participations.customer_id AND rn > 1)
WHERE EXISTS (SELECT 1 FROM dupes WHERE dupes.id = participations.customer_id AND rn > 1);

WITH dupes AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY business_id, LOWER(email)
           ORDER BY updated_at DESC, rowid DESC
         ) AS rn,
         FIRST_VALUE(id) OVER (
           PARTITION BY business_id, LOWER(email)
           ORDER BY updated_at DESC, rowid DESC
         ) AS keep_id
  FROM customers
  WHERE email IS NOT NULL AND email <> ''
)
UPDATE coupons
SET customer_id = (SELECT keep_id FROM dupes WHERE dupes.id = coupons.customer_id AND rn > 1)
WHERE EXISTS (SELECT 1 FROM dupes WHERE dupes.id = coupons.customer_id AND rn > 1);

DELETE FROM customers
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
             PARTITION BY business_id, LOWER(email)
             ORDER BY updated_at DESC, rowid DESC
           ) AS rn
    FROM customers
    WHERE email IS NOT NULL AND email <> ''
  )
  WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_email
  ON customers(business_id, LOWER(email))
  WHERE email IS NOT NULL AND email <> '';

-- ---------------------------------------------------------------------------
-- 7) One active broadcast per business: enforced by the database, not just
--    the read-then-write 409 check in the routes.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_campaigns_active
  ON whatsapp_campaigns(business_id)
  WHERE status IN ('PENDING', 'PROCESSING');

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_campaigns_active
  ON email_campaigns(business_id)
  WHERE status IN ('PENDING', 'PROCESSING');
