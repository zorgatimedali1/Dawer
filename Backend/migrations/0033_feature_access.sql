-- Feature access control: per-account WhatsApp / email marketing switches plus
-- platform-wide master switches. A feature is usable only when both the
-- platform switch and every business switch of the account are on.

ALTER TABLE businesses ADD COLUMN whatsapp_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE businesses ADD COLUMN email_enabled INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO platform_settings (key, value, updated_at)
VALUES ('whatsapp_enabled', '1', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
       ('email_enabled', '1', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
