-- Single-use Google OAuth handoff states, replacing the KV TTL store.
-- The callback consumes a state with DELETE ... and requires changes = 1, so
-- a replayed callback is rejected atomically; the reconciler sweep garbage-
-- collects leftovers older than 30 minutes (states expire after 15).
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_created_at ON oauth_states(created_at);
