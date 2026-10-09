
-- Platform-operator play policy, stored per business and applied to every campaign of the account
ALTER TABLE businesses ADD COLUMN play_policy TEXT;
