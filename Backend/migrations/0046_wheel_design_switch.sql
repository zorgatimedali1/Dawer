-- Operator kill-switch for the wheel-design feature, mirroring the WhatsApp /
-- email platform switches. Unlike those, wheel design already has a plan-based
-- gate (Business+ via `wheelDesignAllowed`), so this is a second, independent
-- lock: when off, no merchant can edit wheel colours / motion / hub logo /
-- step colour regardless of plan. It ships default-on so Business+ merchants
-- keep the access they already have until the operator turns it off.

ALTER TABLE businesses ADD COLUMN wheel_design_enabled INTEGER NOT NULL DEFAULT 1;

INSERT OR IGNORE INTO platform_settings (key, value, updated_at)
VALUES ('wheel_design_enabled', '1', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
