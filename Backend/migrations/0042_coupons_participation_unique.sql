-- Coupon issuance hardening (M1).
--
-- Each won participation must yield exactly ONE coupon code. The issuance
-- guard at routes/public.ts used `WHERE NOT EXISTS`, which is a check-then-write
-- and can race under concurrent submits to the details endpoint, minting a
-- second redeemable code for a prize whose stock was already burned once.
--
-- Step 1: drop any duplicate coupons that already slipped past the old guard,
-- keeping the earliest issued code per participation.
DELETE FROM coupons
WHERE participation_id IS NOT NULL
  AND rowid NOT IN (
    SELECT MIN(rowid) FROM coupons
    WHERE participation_id IS NOT NULL
    GROUP BY participation_id
  );

-- Step 2: enforce one-coupon-per-participation at the database so the insert
-- can use `ON CONFLICT(participation_id) DO NOTHING` and be race-safe. A plain
-- UNIQUE index is used (not a partial one) so the upsert's conflict target
-- matches; SQLite treats NULLs as distinct, so legacy rows without a
-- participation link are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_coupons_participation_unique
  ON coupons(participation_id);
