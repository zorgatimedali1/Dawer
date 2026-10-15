-- Gate step colour (badges + CTA buttons) shipped to Pro/Business/Enterprise.
--
-- Mirror the WHEEL_STEPS_COLOR_PLAN_LIMITS map in `subscription-limits.ts`:
-- the feature string is advertised on Pro/Business/Enterprise plan cards and
-- Starter intentionally omits it. The limit itself resolves from the legacy
-- slug map (no stored `wheelStepsColor` key needed), so only the marketing
-- bullet arrays are rewritten here.

UPDATE plans SET features = json_set(features, '$.features', json_array(
  '1 000 e-mails marketing inclus (bientôt disponible)',
  '200 SMS inclus (bientôt disponible)',
  '200 WhatsApp marketing inclus (bientôt disponible)',
  'Accès complet à la roue',
  'Support e-mail prioritaire',
  'Vue d’ensemble et analytics de base',
  'Plaque QR code incluse',
  'Gestion des récompenses',
  'Logo central de la roue',
  'Couleur des étapes et du bouton'
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
  'Logo central de la roue',
  'Couleur des étapes et du bouton'
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
  'Logo central de la roue',
  'Couleur des étapes et du bouton'
)) WHERE slug = 'premium';
