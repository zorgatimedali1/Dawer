-- The business_branding table (brand colour pickers: "Couleur principale" /
-- "Couleur secondaire") was never consumed by any renderer — the public wheel
-- uses the plan-gated wheel-design palette and the Dawer brand tokens. The
-- pickers are removed from Settings and the table is dropped with its data.
DROP TABLE IF EXISTS business_branding;
