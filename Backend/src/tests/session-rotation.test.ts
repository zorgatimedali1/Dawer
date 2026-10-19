import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../types';
import { handleAuthRoute } from '../routes/auth';
import { handleOperatorAuthRoute } from '../platform/routes/auth';
import { sha256Hex } from '../lib/crypto';
import { createTestEnv, type TestDatabase, type TestEnv } from './helpers/d1';
import { OPERATOR_COOKIE_NAME, seedMerchant, seedOperator } from './helpers/fixtures';

const DAY_MS = 86_400_000;
const GRACE_MS = 120_000;

let raw: TestEnv;
let env: Env;

beforeEach(() => {
  raw = createTestEnv();
  env = raw as unknown as Env;
});

afterEach(() => {
  raw.DB.close();
});

function sessionRequest(token: string): Request {
  return new Request('https://example.test/api/auth/session', {
    headers: { cookie: `cf_session=${encodeURIComponent(token)}` },
  });
}

function operatorSessionRequest(token: string): Request {
  return new Request('https://example.test/api/auth/session', {
    headers: { cookie: `${OPERATOR_COOKIE_NAME}=${encodeURIComponent(token)}` },
  });
}

async function ageSession(db: TestDatabase, token: string, ageMs: number): Promise<void> {
  await db
    .prepare('UPDATE sessions SET created_at = ? WHERE token_hash = ?')
    .bind(new Date(Date.now() - ageMs).toISOString(), await sha256Hex(token))
    .run();
}

/** Value of the requested cookie from the response's Set-Cookie headers. */
function cookieToken(response: Response, names: string[]): string | null {
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(';');
    if (!pair) continue;
    const separator = pair.indexOf('=');
    if (separator < 0) continue;
    if (names.includes(pair.slice(0, separator).trim())) {
      return decodeURIComponent(pair.slice(separator + 1).trim());
    }
  }
  return null;
}

type SessionRow = { token_hash: string; created_at: string; expires_at: string };

describe('merchant session rotation (GET /api/auth/session)', () => {
  it('replaces a token older than one day with a fresh full-life session', async () => {
    const seeded = await seedMerchant(raw.DB, { withBusiness: false });
    await ageSession(raw.DB, seeded.token, 2 * DAY_MS);

    const response = await handleAuthRoute(sessionRequest(seeded.token), env);
    expect(response.status).toBe(200);

    // jsonRequest URLs are https, so the replacement cookie carries the
    // `__Host-` name.
    const nextToken = cookieToken(response, ['__Host-cf_session', 'cf_session']);
    expect(nextToken).toMatch(/^cf_[0-9a-f]{32}\.[0-9a-f]{32}$/);
    expect(nextToken).not.toBe(seeded.token);

    const oldHash = await sha256Hex(seeded.token);
    const nextHash = await sha256Hex(nextToken ?? '');
    const rows = raw.DB.query<SessionRow>(
      'SELECT token_hash, created_at, expires_at FROM sessions WHERE user_id = ?',
      seeded.userId,
    );
    expect(rows).toHaveLength(2);
    const fresh = rows.find((row) => row.token_hash === nextHash) ?? null;
    const aged = rows.find((row) => row.token_hash === oldHash) ?? null;
    expect(fresh).not.toBeNull();
    expect(aged).not.toBeNull();

    const now = Date.now();
    // The replacement token lives a full 3 days again...
    expect(Date.parse(fresh!.expires_at) - now).toBeGreaterThan(2.9 * DAY_MS);
    // ...while the old token is shrunk to the grace window: still valid, but
    // bounded, so in-flight requests cannot fail; it must also be excluded
    // from rotating a second time when the grace token is used.
    const agedRemaining = Date.parse(aged!.expires_at) - now;
    expect(agedRemaining).toBeGreaterThan(0);
    expect(agedRemaining).toBeLessThanOrEqual(GRACE_MS);
    expect(Date.parse(aged!.expires_at)).toBeGreaterThan(now); // shrink-only guard kept validity

    // The fresh cookie authenticates immediately.
    const next = await handleAuthRoute(sessionRequest(nextToken ?? ''), env);
    expect(next.status).toBe(200);
    expect(((await next.json()) as { user: { id: string } }).user.id).toBe(seeded.userId);

    // And the superseded token still works inside the grace window without
    // minting a third session (no re-rotation loop).
    const duringGrace = await handleAuthRoute(sessionRequest(seeded.token), env);
    expect(duringGrace.status).toBe(200);
    expect(duringGrace.headers.getSetCookie()).toHaveLength(0);
    expect(raw.DB.query('SELECT id FROM sessions')).toHaveLength(2);
  });

  it('leaves sessions below the rotation threshold untouched', async () => {
    const seeded = await seedMerchant(raw.DB, { withBusiness: false });

    const response = await handleAuthRoute(sessionRequest(seeded.token), env);
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toHaveLength(0);
    expect(raw.DB.query('SELECT id FROM sessions')).toHaveLength(1);
  });

  it('still 401s for an unknown token', async () => {
    const response = await handleAuthRoute(sessionRequest('cf_deadbeef.deadbeef'), env);
    expect(response.status).toBe(401);
  });
});

describe('operator session rotation (GET /api/auth/session)', () => {
  it('replaces an aged operator token with a fresh full-life session', async () => {
    const seeded = await seedOperator(raw.DB);
    await raw.DB
      .prepare('UPDATE platform_sessions SET created_at = ? WHERE token_hash = ?')
      .bind(new Date(Date.now() - 3 * DAY_MS).toISOString(), await sha256Hex(seeded.token))
      .run();

    const response = await handleOperatorAuthRoute(operatorSessionRequest(seeded.token), env);
    expect(response.status).toBe(200);

    const nextToken = cookieToken(response, ['__Host-cf_op_session', 'cf_op_session']);
    expect(nextToken).toMatch(/^op_[0-9a-f]{32}\.[0-9a-f]{32}$/);
    expect(nextToken).not.toBe(seeded.token);

    const rows = raw.DB.query<{ token_hash: string; expires_at: string }>(
      'SELECT token_hash, expires_at FROM platform_sessions WHERE operator_id = ?',
      seeded.operatorId,
    );
    expect(rows).toHaveLength(2);
    const now = Date.now();
    const nextHash = await sha256Hex(nextToken ?? '');
    const agedHash = await sha256Hex(seeded.token);
    // Fresh token: full operator lifetime (7 days) again.
    const fresh = rows.find((row) => row.token_hash === nextHash)!;
    expect(Date.parse(fresh.expires_at) - now).toBeGreaterThan(6.9 * DAY_MS);
    // Old token: shrunk into the grace window, never extended.
    const aged = rows.find((row) => row.token_hash === agedHash)!;
    const agedRemaining = Date.parse(aged.expires_at) - now;
    expect(agedRemaining).toBeGreaterThan(0);
    expect(agedRemaining).toBeLessThanOrEqual(GRACE_MS);

    // New token authenticates immediately; the superseded token survives the
    // grace window without triggering a second rotation.
    const after = await handleOperatorAuthRoute(operatorSessionRequest(nextToken ?? ''), env);
    expect(after.status).toBe(200);
    const duringGrace = await handleOperatorAuthRoute(operatorSessionRequest(seeded.token), env);
    expect(duringGrace.status).toBe(200);
    expect(((await duringGrace.json()) as { operator: { id: string } }).operator.id).toBe(seeded.operatorId);
    expect(raw.DB.query('SELECT id FROM platform_sessions')).toHaveLength(2);
  });

  it('leaves fresh operator tokens alone', async () => {
    const seeded = await seedOperator(raw.DB);

    const response = await handleOperatorAuthRoute(operatorSessionRequest(seeded.token), env);
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toHaveLength(0);
    expect(raw.DB.query('SELECT id FROM platform_sessions')).toHaveLength(1);
  });
});
