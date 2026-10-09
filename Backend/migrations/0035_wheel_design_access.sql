-- Operator-granted wheel design access. Merchants on Growth/Scale/Premium
-- may edit their wheel design only once the platform grants this flag;
-- it is off by default for every plan. Starter stays blocked regardless.
ALTER TABLE businesses ADD COLUMN wheel_design_access INTEGER NOT NULL DEFAULT 0;
