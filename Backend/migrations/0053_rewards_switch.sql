-- Operator kill-switch for the rewards module, mirroring the WhatsApp / email
-- / wheel-design platform switches. Rewards are core to live wheel campaigns,
-- so unlike those it ships default-on: merchants keep the access they already
-- have until the operator turns it off.

ALTER TABLE businesses ADD COLUMN rewards_enabled INTEGER NOT NULL DEFAULT 1;

INSERT OR IGNORE INTO platform_settings (key, value, updated_at)
VALUES ('rewards_enabled', '1', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
