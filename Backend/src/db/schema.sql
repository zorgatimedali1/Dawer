CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  salt TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0,
  avatar_url TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  email_messages_sent_this_month INTEGER DEFAULT 0,
  email_reset_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_operators (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_sessions (
  id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
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
  updated_at TEXT NOT NULL,
  play_policy TEXT,
  whatsapp_enabled INTEGER NOT NULL DEFAULT 1,
  email_enabled INTEGER NOT NULL DEFAULT 1,
  wheel_theme TEXT,
  wheel_theme_override TEXT,
  wheel_design_access INTEGER NOT NULL DEFAULT 0,
  wheel_design_enabled INTEGER NOT NULL DEFAULT 1
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
  twitter_url TEXT,
  linkedin_url TEXT,
  tiktok_url TEXT,
  youtube_url TEXT,
  logo_url TEXT,
  notifications TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS business_logos (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  image_data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS business_wheel_logos (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  image_data TEXT NOT NULL,
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
  updated_at TEXT NOT NULL,
  play_rules TEXT,
  latitude REAL,
  longitude REAL,
  radius_meters REAL
);

CREATE TABLE IF NOT EXISTS campaign_actions (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  action_url TEXT,
  required INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS action_claims (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  anonymous_id TEXT NOT NULL,
  action TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_action_claims_visitor
  ON action_claims(campaign_id, anonymous_id);

CREATE INDEX IF NOT EXISTS idx_action_claims_campaign ON action_claims(campaign_id);

CREATE TABLE IF NOT EXISTS spin_claims (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  visitor_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_spin_claims_visitor
  ON spin_claims(campaign_id, visitor_key);

-- The standalone campaign_id index was redundant with the unique composite
-- above (migration 0050); the drop keeps fresh local envs aligned with prod.
DROP INDEX IF EXISTS idx_spin_claims_campaign;

CREATE TABLE IF NOT EXISTS spin_events (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  visitor_key TEXT NOT NULL,
  device_hash TEXT,
  ip_hash TEXT,
  ua_hash TEXT,
  is_win INTEGER NOT NULL DEFAULT 0,
  distance_meters REAL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_spin_events_campaign_created
  ON spin_events(campaign_id, created_at);

CREATE INDEX IF NOT EXISTS idx_spin_events_ip
  ON spin_events(campaign_id, ip_hash, created_at);

CREATE INDEX IF NOT EXISTS idx_spin_events_visitor
  ON spin_events(campaign_id, visitor_key, created_at);

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
  stored_weight INTEGER NOT NULL DEFAULT 0,
  expires_after TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- customer_id is nullable: an anonymous spin stores no customer row (P2-5);
-- the details endpoint attaches one later under the plan's storage quota.
CREATE TABLE IF NOT EXISTS coupons (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  customer_id TEXT,
  participation_id TEXT,
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
  customer_id TEXT,
  reward_id TEXT,
  result TEXT,
  visitor_hash TEXT,
  distance_meters REAL,
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

CREATE TABLE IF NOT EXISTS whatsapp_campaigns (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  template_name TEXT NOT NULL,
  template_language TEXT NOT NULL,
  variables TEXT,
  recipients TEXT NOT NULL,
  total_recipients INTEGER NOT NULL,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  delivered_count INTEGER NOT NULL DEFAULT 0,
  read_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING',
  last_error TEXT,
  message_delay_ms INTEGER NOT NULL DEFAULT 150,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS whatsapp_message_log (
  id TEXT PRIMARY KEY,
  wamid TEXT NOT NULL,
  campaign_id TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_message_log_wamid ON whatsapp_message_log(wamid);
CREATE INDEX IF NOT EXISTS idx_whatsapp_message_log_campaign ON whatsapp_message_log(campaign_id, status);

-- WhatsApp Web gateway broadcast (parallel feature): campaign log + delivery log
CREATE TABLE IF NOT EXISTS whatsapp_web_campaigns (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  message TEXT NOT NULL,
  recipients TEXT NOT NULL,
  total_recipients INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_web_campaigns_business ON whatsapp_web_campaigns(business_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_web_campaigns_active
  ON whatsapp_web_campaigns(business_id) WHERE status IN ('QUEUED', 'PROCESSING');

CREATE TABLE IF NOT EXISTS whatsapp_web_message_log (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  phone TEXT,
  phone_normalized TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_web_log_campaign_phone
  ON whatsapp_web_message_log(campaign_id, phone_normalized);

CREATE INDEX IF NOT EXISTS idx_whatsapp_web_log_business_phone
  ON whatsapp_web_message_log(business_id, phone_normalized);


CREATE TABLE IF NOT EXISTS email_campaigns (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  sender_name TEXT,
  recipients TEXT,
  content TEXT,
  link TEXT,
  asset_id TEXT,
  asset_name TEXT,
  asset_mime TEXT,
  reply_to TEXT,
  total_recipients INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING',
  last_error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  plan_id TEXT,
  status TEXT NOT NULL,
  current_period_end TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  whatsapp_messages_sent_this_month INTEGER NOT NULL DEFAULT 0,
  whatsapp_usage_month TEXT
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

CREATE TABLE IF NOT EXISTS subscription_requests (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  duration_days INTEGER,
  resolved_at TEXT,
  resolved_by TEXT,
  reject_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO plans (id, name, slug, price_cents, interval, features, active, created_at) VALUES
  ('plan_starter', 'Starter', 'starter', 14900, '3_months',
    '{"limits":{"campaigns":-1,"customers":200},"features":["200 e-mails marketing inclus (bientôt disponible)","100 SMS inclus (bientôt disponible)","100 WhatsApp marketing inclus (bientôt disponible)","Accès complet à la roue","Support par e-mail","Sans engagement"]}',
   1, '2026-01-01T00:00:00.000Z'),
  ('plan_growth', 'Pro', 'growth', 34900, 'year',
    '{"limits":{"campaigns":-1,"customers":1000,"wheelStepsColor":1},"features":["1 000 e-mails marketing inclus (bientôt disponible)","200 SMS inclus (bientôt disponible)","200 WhatsApp marketing inclus (bientôt disponible)","Accès complet à la roue","Support e-mail prioritaire","Vue d’ensemble et analytics de base","Plaque QR code incluse","Gestion des récompenses","Logo central de la roue","Couleur des étapes et du bouton"]}',
   1, '2026-01-01T00:00:00.000Z'),
  ('plan_scale', 'Business', 'scale', 79900, '2_years',
    '{"limits":{"campaigns":-1,"customers":10000,"wheelStepsColor":1},"features":["10 000 e-mails marketing inclus (bientôt disponible)","300 SMS inclus par an (bientôt disponible)","300 WhatsApp marketing inclus par an (bientôt disponible)","Accès complet à la roue","Analytics avancées","Support prioritaire","Meilleur rapport qualité-prix à long terme","Offre réservée aux 50 premiers commerçants","Gestion des récompenses","Configuration avancée de la roue (couleurs et animations)","Logo central de la roue","Couleur des étapes et du bouton"]}',
   1, '2026-01-01T00:00:00.000Z'),
  ('plan_premium', 'Enterprise', 'premium', 149900, '3_years',
   '{"limits":{"campaigns":-1,"customers":-1,"wheelStepsColor":1},"features":["Clients illimités","Volumes e-mail, SMS et WhatsApp personnalisés (bientôt disponible)","Accès complet à la roue","Analytics avancées multi-sites","API et intégrations sur mesure","Accompagnement dédié","Support prioritaire","Gestion des récompenses","Configuration avancée de la roue (couleurs et animations)","Logo central de la roue","Couleur des étapes et du bouton"]}',
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
  platform_operator_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_business_members_user ON business_members(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_operators_email ON platform_operators(email);
CREATE INDEX IF NOT EXISTS idx_platform_operators_status ON platform_operators(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_sessions_token ON platform_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_platform_sessions_operator ON platform_sessions(operator_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_business ON campaigns(business_id);
-- QR dashboard lists `WHERE business_id = ? ... ORDER BY created_at DESC` (migration 0050).
CREATE INDEX IF NOT EXISTS idx_qr_codes_business_created ON qr_codes(business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_rewards_campaign ON rewards(campaign_id);
CREATE INDEX IF NOT EXISTS idx_rewards_business ON rewards(business_id);
CREATE INDEX IF NOT EXISTS idx_coupons_customer ON coupons(customer_id);
CREATE INDEX IF NOT EXISTS idx_coupons_campaign ON coupons(campaign_id);
CREATE INDEX IF NOT EXISTS idx_coupons_reward ON coupons(reward_id);
CREATE INDEX IF NOT EXISTS idx_coupons_business_status ON coupons(business_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_coupons_participation_unique
  ON coupons(participation_id);
CREATE INDEX IF NOT EXISTS idx_participations_campaign ON participations(campaign_id);
-- Daily spin-cap count reads `WHERE campaign_id = ? AND created_at >= ?`
-- (migration 0050): the composite keeps the count bounded by one day.
CREATE INDEX IF NOT EXISTS idx_participations_campaign_created ON participations(campaign_id, created_at);
CREATE INDEX IF NOT EXISTS idx_participations_customer ON participations(customer_id);
CREATE INDEX IF NOT EXISTS idx_participations_customer ON participations(customer_id);
CREATE INDEX IF NOT EXISTS idx_participations_reward ON participations(reward_id);
CREATE INDEX IF NOT EXISTS idx_customers_business ON customers(business_id);
CREATE INDEX IF NOT EXISTS idx_customers_identity
  ON customers(business_id, LOWER(COALESCE(email, phone, id)));
-- Phone-half of the split duplicate lookup in handleCustomerDetails
-- (migration 0050): `WHERE business_id = ? AND phone = ?`.
CREATE INDEX IF NOT EXISTS idx_customers_business_phone ON customers(business_id, phone);
CREATE INDEX IF NOT EXISTS idx_analytics_business_created ON analytics_events(business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_campaign_created ON analytics_events(campaign_id, created_at);
-- One QR_SCANNED row per (business, campaign, visitor-day): event_data is
-- `<visitor_hash>|<YYYY-MM-DD>` (migration 0040).
CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_scan_dedup
  ON analytics_events(business_id, campaign_id, event_data)
  WHERE event_type = 'QR_SCANNED';
CREATE INDEX IF NOT EXISTS idx_audit_logs_business_created ON audit_logs(business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_subscription_requests_status ON subscription_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_subscription_requests_business ON subscription_requests(business_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_campaigns_business ON whatsapp_campaigns(business_id, created_at);
-- Cron reconciler scans stale PENDING/PROCESSING rows each tick (migration 0050).
CREATE INDEX IF NOT EXISTS idx_whatsapp_campaigns_status ON whatsapp_campaigns(status, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_campaigns_active
  ON whatsapp_campaigns(business_id) WHERE status IN ('PENDING', 'PROCESSING');
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_campaigns_active
  ON email_campaigns(business_id) WHERE status IN ('PENDING', 'PROCESSING', 'PAUSED');
-- The old index under this name was non-unique; drop it so the UNIQUE (the
-- target of the ON CONFLICT upserts in lib/business.ts) can be created.
DROP INDEX IF EXISTS idx_subscriptions_business;
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_business ON subscriptions(business_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_business_settings_business ON business_settings(business_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_email
  ON customers(business_id, LOWER(email))
  WHERE email IS NOT NULL AND email <> '';

-- Single-use Google OAuth handoff states (see migrations/0026_oauth_states.sql).
-- pkce_verifier holds the S256 code verifier minted at /api/auth/google and
-- consumed by the token exchange in the callback (migration 0051); rows that
-- predate the column keep the pre-PKCE empty default.
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  pkce_verifier TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_states_created_at ON oauth_states(created_at);

-- Single-use password reset tokens (see migrations/0030_p16_password_resets.sql):
-- only the SHA-256 of the emailed raw value is stored, 15-minute expiry.
CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
CREATE INDEX IF NOT EXISTS idx_password_resets_expires ON password_resets(expires_at);

-- Suppression list: one-click unsubscribes plus Resend bounce/complaint
-- feedback (see migrations/0032_email_send_guards.sql).
CREATE TABLE IF NOT EXISTS email_suppression (
  email TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  business_id TEXT,
  created_at TEXT NOT NULL
);

-- Daily marketing reserve: campaigns reserve recipients up-front so a cap
-- (default 80/day) always leaves headroom for transactional mail.
CREATE TABLE IF NOT EXISTS email_daily_usage (
  day TEXT PRIMARY KEY,
  reserved INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- Landing-page partner marquee (see migrations/0036_partners.sql): rows are
-- managed by platform operators, logo bytes live in the partner-logos R2
-- bucket under key `partners/<id>` and are served from /api/public/partners.
CREATE TABLE IF NOT EXISTS partners (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  logo_url TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_partners_created_at ON partners(created_at);
