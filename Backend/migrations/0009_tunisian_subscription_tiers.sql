UPDATE plans
SET name = 'Starter', price_cents = 14900, interval = '3_months',
    features = '{"limits":{"campaigns":-1,"customers":-1},"features":["Clients illimités","200 e-mails marketing inclus","100 SMS inclus","100 WhatsApp marketing inclus","Accès complet à la roue","Support par e-mail","Sans engagement"]}'
WHERE slug = 'starter';

UPDATE plans
SET name = 'Pro', price_cents = 34900, interval = 'year',
    features = '{"limits":{"campaigns":-1,"customers":-1},"features":["Clients illimités","1 000 e-mails marketing inclus","200 SMS inclus","200 WhatsApp marketing inclus","Accès complet à la roue","Support e-mail prioritaire","Vue d’ensemble et analytics de base","Plaque QR code incluse"]}'
WHERE slug = 'growth';

UPDATE plans
SET name = 'Business', price_cents = 79900, interval = '3_years',
    features = '{"limits":{"campaigns":-1,"customers":-1},"features":["Clients illimités","10 000 e-mails marketing inclus","300 SMS inclus par an","300 WhatsApp marketing inclus par an","Accès complet à la roue","Analytics avancées","Support prioritaire","Meilleur rapport qualité-prix à long terme","Offre réservée aux 50 premiers commerçants"]}'
WHERE slug = 'scale';

UPDATE plans
SET name = 'Enterprise', price_cents = 149900, interval = '3_years',
    features = '{"limits":{"campaigns":-1,"customers":-1},"features":["Clients illimités","Volumes e-mail, SMS et WhatsApp personnalisés","Accès complet à la roue","Analytics avancées multi-sites","API et intégrations sur mesure","Accompagnement dédié","Support prioritaire"]}'
WHERE slug = 'premium';