-- Broadcasts gain a merchant reply-to address: the From stays on the
-- platform's verified Resend domain, but replies land in the merchant's own
-- inbox (Resend `reply_to`, Mailjet `ReplyTo`). NULL = the composer's account
-- email is used instead.
ALTER TABLE email_campaigns ADD COLUMN reply_to TEXT;
