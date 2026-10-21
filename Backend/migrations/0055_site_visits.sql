-- Website analytics for the operator console: one row per SPA page view
-- beaconed by the frontend (home page, merchant dashboard, everything else).
-- `visitor` is a salted SHA-256 of IP + user agent + day, truncated to 16 hex
-- chars: counts uniques without storing anything reversible.
CREATE TABLE IF NOT EXISTS site_visits (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  referrer TEXT,
  visitor TEXT NOT NULL,
  device TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_site_visits_day ON site_visits(created_at);
CREATE INDEX IF NOT EXISTS idx_site_visits_path_day ON site_visits(path, created_at);
