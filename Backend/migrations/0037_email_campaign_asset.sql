-- Campaign email attachments (photo/PDF uploaded from the composer).
-- The bytes live in R2 (binding CAMPAIGN_ASSETS, key email-assets/<uuid>); these
-- columns carry the reference so delivery and history can read it directly.
ALTER TABLE email_campaigns ADD COLUMN asset_id TEXT;
ALTER TABLE email_campaigns ADD COLUMN asset_name TEXT;
ALTER TABLE email_campaigns ADD COLUMN asset_mime TEXT;
