
-- Add optional social networks and logo to business settings
ALTER TABLE business_settings ADD COLUMN twitter_url TEXT;
ALTER TABLE business_settings ADD COLUMN linkedin_url TEXT;
ALTER TABLE business_settings ADD COLUMN tiktok_url TEXT;
ALTER TABLE business_settings ADD COLUMN youtube_url TEXT;
ALTER TABLE business_settings ADD COLUMN logo_url TEXT;

