-- Rewards plan gating + plan-description refresh.
--
-- 1. Add the "Gestion des récompenses" feature string to Pro/Business/Enterprise
--    so the dashboard nav + /dashboard/rewards route + the rewards GET/PATCH
--    endpoints can gate on it (mirrors the /analytics/ feature-string pattern).
--    Starter intentionally omits it -> no Rewards page, wheel builder untouched.
-- 2. Add wheel-design bullets (Business+ colors/motion, Pro+ centre logo) to
--    match the WHEEL_DESIGN_PLAN_LIMITS / WHEEL_CENTER_LOGO_PLAN_LIMITS maps.
-- 3. Mark every e-mail / SMS / WhatsApp bullet "bientôt disponible" (the channels
--    ship disabled by default and are re-enabled from the operator console).
-- 4. Default the marketing master switches OFF for existing rows.

-- Platform master switches -> off (upsert in case a row is absent).
INSERT INTO platform_settings (key, value, updated_at)
VALUES ('whatsapp_enabled', '0', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
       ('email_enabled', '0', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;

-- Every existing business inherits the off switches.
UPDATE businesses SET whatsapp_enabled = 0, email_enabled = 0;

-- Plan feature arrays (FR) -> rewards gate + wheel-design + coming-soon copy.
UPDATE plans SET features = json_set(features, '$.features', json_array(
  '200 e-mails marketing inclus (bientôt disponible)',
  '100 SMS inclus (bientôt disponible)',
  '100 WhatsApp marketing inclus (bientôt disponible)',
  'Accès complet à la roue',
  'Support par e-mail',
  'Sans engagement'
)) WHERE slug = 'starter';

UPDATE plans SET features = json_set(features, '$.features', json_array(
  '1 000 e-mails marketing inclus (bientôt disponible)',
  '200 SMS inclus (bientôt disponible)',
  '200 WhatsApp marketing inclus (bientôt disponible)',
  'Accès complet à la roue',
  'Support e-mail prioritaire',
  'Vue d’ensemble et analytics de base',
  'Plaque QR code incluse',
  'Gestion des récompenses',
  'Logo central de la roue'
)) WHERE slug = 'growth';

UPDATE plans SET features = json_set(features, '$.features', json_array(
  '10 000 e-mails marketing inclus (bientôt disponible)',
  '300 SMS inclus par an (bientôt disponible)',
  '300 WhatsApp marketing inclus par an (bientôt disponible)',
  'Accès complet à la roue',
  'Analytics avancées',
  'Support prioritaire',
  'Meilleur rapport qualité-prix à long terme',
  'Offre réservée aux 50 premiers commerçants',
  'Gestion des récompenses',
  'Configuration avancée de la roue (couleurs et animations)',
  'Logo central de la roue'
)) WHERE slug = 'scale';

UPDATE plans SET features = json_set(features, '$.features', json_array(
  'Clients illimités',
  'Volumes e-mail, SMS et WhatsApp personnalisés (bientôt disponible)',
  'Accès complet à la roue',
  'Analytics avancées multi-sites',
  'API et intégrations sur mesure',
  'Accompagnement dédié',
  'Support prioritaire',
  'Gestion des récompenses',
  'Configuration avancée de la roue (couleurs et animations)',
  'Logo central de la roue'
)) WHERE slug = 'premium';
