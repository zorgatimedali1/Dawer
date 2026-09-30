CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  salt TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0,
  avatar_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  email TEXT,
  name TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(provider, provider_account_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  logo TEXT,
  description TEXT,
  website TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  timezone TEXT DEFAULT 'UTC',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS business_members (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'STAFF',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS business_settings (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  timezone TEXT,
  branding TEXT,
  google_maps_name TEXT,
  google_maps_url TEXT,
  google_place_id TEXT,
  facebook_url TEXT,
  instagram_url TEXT,
  notifications TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS business_branding (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  logo TEXT,
  primary_color TEXT,
  secondary_color TEXT,
  background_color TEXT,
  font_family TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  public_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  start_at TEXT,
  end_at TEXT,
  timezone TEXT DEFAULT 'UTC',
  game_type TEXT NOT NULL DEFAULT 'WHEEL',
  require_customer_information INTEGER NOT NULL DEFAULT 1,
  require_action TEXT DEFAULT 'NONE',
  google_maps_name TEXT,
  google_maps_url TEXT,
  google_place_id TEXT,
  facebook_url TEXT,
  instagram_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaign_actions (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  action_url TEXT,
  required INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  campaign_id TEXT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  config TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS game_configs (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  config_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wheel_segments (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  reward_id TEXT,
  name TEXT NOT NULL,
  weight INTEGER NOT NULL,
  position INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rewards (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  value TEXT,
  description TEXT,
  quantity INTEGER NOT NULL DEFAULT 0,
  quantity_initial INTEGER,
  weight INTEGER NOT NULL DEFAULT 0,
  expires_after TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS coupons (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  reward_id TEXT,
  code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'ISSUED',
  issued_at TEXT NOT NULL,
  expires_at TEXT,
  redeemed_at TEXT
);

CREATE TABLE IF NOT EXISTS participations (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  reward_id TEXT,
  result TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  birthday TEXT,
  marketing_consent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_activity_at TEXT
);

CREATE TABLE IF NOT EXISTS qr_codes (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  public_code TEXT NOT NULL UNIQUE,
  name TEXT,
  location TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS posters (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  template TEXT NOT NULL,
  title TEXT,
  subtitle TEXT,
  theme TEXT,
  configuration TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  plan_id TEXT,
  status TEXT NOT NULL,
  current_period_end TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  price_cents INTEGER NOT NULL,
  interval TEXT NOT NULL,
  features TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

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

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  subscription_id TEXT,
  provider TEXT NOT NULL,
  provider_payment_id TEXT,
  status TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  campaign_id TEXT,
  event_type TEXT NOT NULL,
  event_data TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  business_id TEXT,
  user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_business_members_user ON business_members(user_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_business ON campaigns(business_id);
CREATE INDEX IF NOT EXISTS idx_rewards_campaign ON rewards(campaign_id);
CREATE INDEX IF NOT EXISTS idx_coupons_customer ON coupons(customer_id);
CREATE INDEX IF NOT EXISTS idx_participations_campaign ON participations(campaign_id);
CREATE INDEX IF NOT EXISTS idx_customers_business ON customers(business_id);
CREATE INDEX IF NOT EXISTS idx_analytics_business ON analytics_events(business_id);
