-- Brute-force protection: after MAX_FAILED_LOGINS wrong passwords the account
-- is locked for LOCKOUT_MS, even if the password is correct from then on.
ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TEXT;
ALTER TABLE platform_operators ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE platform_operators ADD COLUMN locked_until TEXT;
