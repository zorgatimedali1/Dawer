-- Business level integrations + notification preferences + default plans.
ALTER TABLE business_settings ADD COLUMN google_maps_name TEXT;
ALTER TABLE business_settings ADD COLUMN google_maps_url TEXT;
ALTER TABLE business_settings ADD COLUMN google_place_id TEXT;
ALTER TABLE business_settings ADD COLUMN facebook_url TEXT;
ALTER TABLE business_settings ADD COLUMN instagram_url TEXT;
ALTER TABLE business_settings ADD COLUMN notifications TEXT;

INSERT OR IGNORE INTO plans (id, name, slug, price_cents, interval, features, active, created_at) VALUES
  ('plan_starter', 'Starter', 'starter', 2900, 'month',
   '{"limits":{"campaigns":1,"customers":100},"features":["1 campagne active","100 clients","3 recompenses","Support email"]}',
   1, '2026-01-01T00:00:00.000Z'),
  ('plan_growth', 'Growth', 'growth', 7900, 'month',
   '{"limits":{"campaigns":10,"customers":10000},"features":["10 campagnes","10 000 clients","Reseaux sociaux","Analytics avances"]}',
   1, '2026-01-01T00:00:00.000Z'),
  ('plan_scale', 'Scale', 'scale', 14900, 'month',
   '{"limits":{"campaigns":-1,"customers":-1},"features":["Campagnes illimitees","Support prioritaire","API / integrations","SSO"]}',
   1, '2026-01-01T00:00:00.000Z');
