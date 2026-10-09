-- Email broadcasts move from "deliver inside the HTTP request" to a
-- Durable Object alarm loop: the campaign row itself now carries the
-- payload the sender needs (recipients, rendered content, tracking link).
ALTER TABLE email_campaigns ADD COLUMN recipients TEXT;
ALTER TABLE email_campaigns ADD COLUMN content TEXT;
ALTER TABLE email_campaigns ADD COLUMN link TEXT;
