-- Operator- and merchant-controlled wheel design, scoped per account.
-- wheel_theme: merchant-authored base theme (JSON).
-- wheel_theme_override: operator-authored theme that wins whenever it is set.
ALTER TABLE businesses ADD COLUMN wheel_theme TEXT;
ALTER TABLE businesses ADD COLUMN wheel_theme_override TEXT;

-- Center hub image shown on the wheel (mirrors business_logos storage).
CREATE TABLE IF NOT EXISTS business_wheel_logos (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  image_data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
