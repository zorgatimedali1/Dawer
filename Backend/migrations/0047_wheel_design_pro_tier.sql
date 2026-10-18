-- Wheel design moves from Business+ to Pro+. The growth plan row had its old
-- tiering frozen into the stored criteria blob by an earlier plans-form save,
-- and plan-stored criteria override the slug maps — so the row needs the same
-- fix as the code, not just the map.
UPDATE plans
SET features = json_set(features, '$.limits.wheelDesign', 1)
WHERE slug = 'growth' AND json_valid(features);
