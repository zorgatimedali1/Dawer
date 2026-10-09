-- Anti-fraud audit (P2-2 / P2-8):
--   * spin_events.is_win turns the audit trail into a per-network win budget
--     that works in every play mode and survives Durable Object loss.
--     Legacy rows default to 0 (unknown) — an undercount that only ever makes
--     old history more permissive.
--   * participations.visitor_hash binds a participation to the signed visitor
--     identity that created it, so the details endpoint no longer trusts a
--     bare UUID. Nullable: cookie-less (no-win slice) spins have no identity.
ALTER TABLE spin_events ADD COLUMN is_win INTEGER NOT NULL DEFAULT 0;
ALTER TABLE participations ADD COLUMN visitor_hash TEXT;
