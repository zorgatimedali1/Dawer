import { secureRandomHex, sha256Hex } from './crypto';
import type { Env } from '../types';

/**
 * Rotation threshold for session tokens: a token older than this is replaced
 * by a fresh one on its next visit to the session endpoint, so a token stolen
 * today cannot keep working past tomorrow even if its nominal lifetime is
 * longer (merchant 3 days, operator 7 days).
 */
export const SESSION_ROTATE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * The superseded token stays valid this long after rotation so requests that
 * were already in flight with the old cookie never fail; after the grace the
 * row simply expires on its own.
 */
export const ROTATED_TOKEN_GRACE_MS = 120_000;

export type RotateSessionOptions = {
  /** The table is a trusted constant per caller, never user input. */
  table: 'sessions' | 'platform_sessions';
  ownerColumn: 'user_id' | 'operator_id';
  tokenPrefix: 'cf_' | 'op_';
  /** Lifetime of the replacement session (again, in seconds). */
  maxAgeSeconds: number;
};

/**
 * Mints a fresh session row (new token, full lifetime) once the given token's
 * session has aged past the rotation threshold, and pulls the old row's expiry
 * down to the grace window (a shrink-only guarded UPDATE — it never extends an
 * already-shorter expiry). Returns the replacement raw token for the caller to
 * hand to the browser, or null when there is nothing to do: token unknown or
 * expired, session still young, or any failure — which degrades silently to
 * "keep the current session" rather than risking a 401 mid-dashboard.
 */
export async function rotateSession(
  env: Env,
  token: string,
  options: RotateSessionOptions,
): Promise<string | null> {
  if (!token) return null;

  try {
    const tokenHash = await sha256Hex(token);
    const nowMs = Date.now();
    const row = await env.DB.prepare(
      `SELECT id, created_at, ${options.ownerColumn} AS owner_id FROM ${options.table}
       WHERE token_hash = ? AND expires_at > ? LIMIT 1`,
    )
      .bind(tokenHash, new Date(nowMs).toISOString())
      .first<{ id: string; created_at: string; owner_id: string }>();
    if (!row) return null;

    const ageMs = nowMs - Date.parse(row.created_at);
    if (!Number.isFinite(ageMs) || ageMs < SESSION_ROTATE_AFTER_MS) return null;

    const nextToken = `${options.tokenPrefix}${secureRandomHex(16)}.${secureRandomHex(16)}`;
    const now = new Date(nowMs).toISOString();
    const nextExpiresAt = new Date(nowMs + 1000 * options.maxAgeSeconds).toISOString();
    const graceExpiresAt = new Date(nowMs + ROTATED_TOKEN_GRACE_MS).toISOString();

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO ${options.table} (id, ${options.ownerColumn}, token_hash, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), row.owner_id, await sha256Hex(nextToken), now, nextExpiresAt),
      // Shrink the old expiry to the grace window AND stamp created_at to now:
      // the grace token must not re-enter the rotation path on its remaining
      // visits (its age would still exceed the threshold), so its "age" is
      // reset — created_at now doubles as the last-rotation marker.
      env.DB.prepare(
        `UPDATE ${options.table} SET created_at = ?, expires_at = ? WHERE id = ? AND expires_at > ?`,
      ).bind(now, graceExpiresAt, row.id, graceExpiresAt),
    ]);

    return nextToken;
  } catch (error) {
    // Rotation is a hardened nicety, never a correctness dependency: lose it
    // and keep the session as it was.
    console.error('Session rotation skipped.', error);
    return null;
  }
}
