-- Google OAuth PKCE (proof key for code exchange): the S256 challenge rides in
-- the authorization URL minted by /api/auth/google, while its verifier waits in
-- this column until the /api/auth/google/callback token exchange consumes it.
-- An authorization code that is intercepted or replayed can then no longer be
-- redeemed without the verifier the server held all along.
ALTER TABLE oauth_states ADD COLUMN pkce_verifier TEXT NOT NULL DEFAULT '';
