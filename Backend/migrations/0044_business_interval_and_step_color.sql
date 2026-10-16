-- Business plan is now billed every 2 years instead of 3, and the step-colour
-- entitlement (badges + CTA buttons) is made an explicit stored limit for
-- Pro/Business/Enterprise instead of relying on the legacy slug map.
--
-- The explicit `wheelStepsColor: 1` keeps the feature unlocked even if an
-- operator later saves a plan from the console with the checkbox unchecked
-- (the stored value wins over WHEEL_STEPS_COLOR_PLAN_LIMITS). Starter is
-- intentionally left without the key so it stays locked.

UPDATE plans SET interval = '2_years' WHERE slug = 'scale';

UPDATE plans
SET features = json_set(features, '$.limits.wheelStepsColor', 1)
WHERE slug IN ('growth', 'scale', 'premium');
