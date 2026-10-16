-- Optional per-spin proximity radius (H2/A3).
--
-- Previously the customer's reported coordinates were recorded as a soft
-- fraud-review signal but never gated anything, so a public campaign link could
-- be spun from anywhere on earth. Merchants can now opt in to a hard radius:
-- when `radius_meters` is set (and the campaign has resolved coordinates),
-- the participate endpoint rejects spins whose reported distance exceeds it.
-- NULL keeps the historic advisory-only behaviour, so existing campaigns are
-- unaffected.
ALTER TABLE campaigns ADD COLUMN radius_meters REAL;
