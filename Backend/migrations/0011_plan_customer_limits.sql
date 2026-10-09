UPDATE plans
SET features = '{"limits":{"campaigns":-1,"customers":1000},"features":["1 000 e-mails marketing inclus","200 SMS inclus","200 WhatsApp marketing inclus","Accès complet à la roue","Support e-mail prioritaire","Vue d’ensemble et analytics de base","Plaque QR code incluse"]}'
WHERE slug = 'growth';

UPDATE plans
SET features = '{"limits":{"campaigns":-1,"customers":10000},"features":["10 000 e-mails marketing inclus","300 SMS inclus par an","300 WhatsApp marketing inclus par an","Accès complet à la roue","Analytics avancées","Support prioritaire","Meilleur rapport qualité-prix à long terme","Offre réservée aux 50 premiers commerçants"]}'
WHERE slug = 'scale';