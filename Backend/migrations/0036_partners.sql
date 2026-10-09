-- Partner logos shown in the landing-page "ILS NOUS FONT CONFIANCE" marquee.
-- Managed by operators from the platform console; `logo_url` is the public
-- serving path (/api/public/partners/<id>/logo) and the bytes live in the
-- partner-logos R2 bucket under key `partners/<id>`.
CREATE TABLE IF NOT EXISTS partners (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  logo_url TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_partners_created_at ON partners(created_at);
