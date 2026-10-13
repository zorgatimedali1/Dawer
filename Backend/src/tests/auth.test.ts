import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../types';
import { handleAuthRoute } from '../routes/auth';
import { handleBusinessRoute } from '../routes/business';
import { sha256Hex } from '../lib/crypto';
import { createTestEnv, type TestDatabase } from './helpers/d1';
import { jsonRequest } from './helpers/fixtures';

let db: TestDatabase;
let env: Env;

const email = `owner-${crypto.randomUUID().slice(0, 8)}@example.test`;

function registerBody(overrides: Record<string, unknown> = {}) {
  return {
    email,
    password: 'Sup3rSecret!',
    firstName: 'Ada',
    lastName: 'Lovelace',
    businessName: 'Smoke Shop',
    ...overrides,
  };
}

async function body(response: Response) {
  return (await response.json()) as Record<string, any>;
}

/** Session value minted into the response's HttpOnly session cookie. */
function sessionCookieValue(response: Response): string {
  const first = (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  return decodeURIComponent(first.slice(first.indexOf('=') + 1));
}

function sessionCookieHeader(response: Response): string {
  return `__Host-cf_session=${sessionCookieValue(response)}`;
}

beforeEach(() => {
  const testEnv = createTestEnv();
  db = testEnv.DB;
  env = testEnv as unknown as Env;
});

afterEach(() => {
  vi.unstubAllGlobals();
  db.close();
});

describe('POST /api/auth/register', () => {
  it('creates a user, business and session that immediately authenticates', async () => {
    const registered = await handleAuthRoute(jsonRequest('/api/auth/register', 'POST', registerBody()), env);
    const payload = await body(registered);

    expect(payload.success).toBe(true);
    // P1-1: the token lives only in the HttpOnly cookie, never in the body.
    expect(payload.token).toBeUndefined();

    const guarded = await handleBusinessRoute(
      new Request('https://example.test/api/business/campaign-config', {
        method: 'GET',
        headers: { cookie: sessionCookieHeader(registered) },
      }),
      env,
    );
    expect(guarded.status).toBe(200);

    expect(db.query(`SELECT id FROM users`)).toHaveLength(1);
    expect(db.query(`SELECT id FROM businesses`)).toHaveLength(1);
    expect(db.query(`SELECT role FROM business_members`)).toEqual([{ role: 'OWNER' }]);
    expect(db.query(`SELECT id FROM sessions`)).toHaveLength(1);
    const trials = db.query<{ plan_id: string; status: string; created_at: string; current_period_end: string }>(
      `SELECT plan_id, status, created_at, current_period_end FROM subscriptions`,
    );
    expect(trials).toHaveLength(1);
    expect(trials[0]).toMatchObject({ plan_id: 'plan_starter', status: 'trialing' });
    expect(Date.parse(trials[0]!.current_period_end) - Date.parse(trials[0]!.created_at)).toBe(7 * 86_400_000);
  });

  it('stores the session row with the same 3-day TTL as the cookie', async () => {
    await handleAuthRoute(jsonRequest('/api/auth/register', 'POST', registerBody()), env);

    // The HttpOnly cookie is capped at 3 days; the DB row must not outlive
    // it or a replayed Bearer token would stay valid for a week.
    const session = db.query<{ created_at: string; expires_at: string }>(
      `SELECT created_at, expires_at FROM sessions`,
    )[0]!;
    const ttl = Date.parse(session.expires_at) - Date.parse(session.created_at);
    expect(ttl).toBeLessThanOrEqual(3 * 86_400_000 + 5);
    expect(ttl).toBeGreaterThan(3 * 86_400_000 - 10_000);
  });

  it('seeds the new business channel switches from the platform-wide controls', async () => {
    db.prepare(
      `INSERT INTO platform_settings (key, value, updated_at) VALUES ('whatsapp_enabled', '0', ?)`,
    )
      .bind(new Date().toISOString())
      .run();

    await handleAuthRoute(jsonRequest('/api/auth/register', 'POST', registerBody()), env);

    const business = db.query<{ whatsapp_enabled: number; email_enabled: number }>(
      'SELECT whatsapp_enabled, email_enabled FROM businesses',
    )[0];
    // A missing platform row now defaults to off, so email stays disabled too.
    expect(business).toMatchObject({ whatsapp_enabled: 0, email_enabled: 0 });
  });

  it('rejects a duplicate email with 409', async () => {
    await handleAuthRoute(jsonRequest('/api/auth/register', 'POST', registerBody()), env);
    const second = await handleAuthRoute(
      jsonRequest('/api/auth/register', 'POST', registerBody({ businessName: 'Other Shop' })),
      env,
    );

    expect(second.status).toBe(409);
    expect((await body(second)).message).toBe('This email is already registered.');
    expect(db.query(`SELECT id FROM businesses`)).toHaveLength(1);
  });

  it('still succeeds when the friendly business name collides with an existing slug', async () => {
    const first = await body(
      await handleAuthRoute(jsonRequest('/api/auth/register', 'POST', registerBody()), env),
    );
    const second = await body(
      await handleAuthRoute(
        jsonRequest('/api/auth/register', 'POST', registerBody({ email: 'second@example.test' })),
        env,
      ),
    );

    expect(second.success).toBe(true);
    expect(second.token).toBeUndefined();
    expect(second.user.id).not.toBe(first.user.id);

    const slugs = db.query<{ slug: string }>(`SELECT slug FROM businesses ORDER BY created_at`).map((row) => row.slug);
    expect(slugs).toHaveLength(2);
    expect(new Set(slugs).size).toBe(2);
    expect(slugs[0]).toBe('smoke-shop');
    expect(slugs[1]).toMatch(/^smoke-shop-[0-9a-f]{6}$/);
  });

  it('rejects a weak password with 400', async () => {
    const response = await handleAuthRoute(
      jsonRequest('/api/auth/register', 'POST', registerBody({ password: 'short' })),
      env,
    );
    expect(response.status).toBe(400);
    expect((await body(response)).message).toBe('Validation failed.');
    expect(db.query(`SELECT id FROM users`)).toHaveLength(0);
  });

  it('mints an HttpOnly session cookie that authenticates same-origin requests', async () => {
    const registered = await handleAuthRoute(jsonRequest('/api/auth/register', 'POST', registerBody()), env);

    const setCookie = registered.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('__Host-cf_session=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Secure');

    // No Authorization header — the cookie alone carries the session.
    const guarded = await handleBusinessRoute(
      new Request('https://example.test/api/business/campaign-config', {
        method: 'GET',
        headers: { cookie: setCookie.split(';')[0] },
      }),
      env,
    );
    expect(guarded.status).toBe(200);
  });

  it('still authenticates a pre-rename cf_session cookie', async () => {
    const registered = await handleAuthRoute(jsonRequest('/api/auth/register', 'POST', registerBody()), env);
    const token = sessionCookieValue(registered);

    const guarded = await handleBusinessRoute(
      new Request('https://example.test/api/business/campaign-config', {
        method: 'GET',
        headers: { cookie: `cf_session=${encodeURIComponent(token)}` },
      }),
      env,
    );
    expect(guarded.status).toBe(200);
  });

  it('logout expires both the current and the legacy session cookie names', async () => {
    const registered = await handleAuthRoute(jsonRequest('/api/auth/register', 'POST', registerBody()), env);
    const token = sessionCookieValue(registered);

    const loggedOut = await handleAuthRoute(
      new Request('https://example.test/api/auth/logout', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }),
      env,
    );
    expect(loggedOut.status).toBe(200);
    const cleared = loggedOut.headers.get('set-cookie') ?? '';
    expect(cleared).toContain('__Host-cf_session=;');
    expect(cleared).toContain('Max-Age=0');
    expect(cleared).toContain('cf_session=;');
  });

  it('logout with only the session cookie revokes the session', async () => {
    const registered = await handleAuthRoute(jsonRequest('/api/auth/register', 'POST', registerBody()), env);
    const token = sessionCookieValue(registered);

    const loggedOut = await handleAuthRoute(
      new Request('https://example.test/api/auth/logout', {
        method: 'POST',
        headers: { cookie: `__Host-cf_session=${encodeURIComponent(token)}` },
      }),
      env,
    );
    expect(loggedOut.status).toBe(200);
    expect(db.query(`SELECT id FROM sessions`)).toHaveLength(0);

    // The revoked token is dead even if a client still holds it.
    const guarded = await handleBusinessRoute(
      jsonRequest('/api/business/campaign-config', 'GET', undefined, token),
      env,
    );
    expect(guarded.status).toBe(401);
  });

  it('logout without any credential is idempotent and still clears cookies', async () => {
    const loggedOut = await handleAuthRoute(
      new Request('https://example.test/api/auth/logout', { method: 'POST' }),
      env,
    );

    expect(loggedOut.status).toBe(200);
    expect(loggedOut.headers.get('set-cookie') ?? '').toContain('Max-Age=0');
  });

  it('rejects a cross-site login POST (Origin host mismatch)', async () => {
    const response = await handleAuthRoute(
      new Request('https://example.test/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
        body: JSON.stringify({ email, password: 'Sup3rSecret!' }),
      }),
      env,
    );

    expect(response.status).toBe(403);
    expect((await body(response)).message).toBe('Cross-site request rejected.');
  });

  it('rejects an opaque Origin: null login POST', async () => {
    const response = await handleAuthRoute(
      new Request('https://example.test/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'null' },
        body: JSON.stringify({ email, password: 'Sup3rSecret!' }),
      }),
      env,
    );

    expect(response.status).toBe(403);
  });

  it('rejects a cross-site register POST', async () => {
    const response = await handleAuthRoute(
      new Request('https://example.test/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
        body: JSON.stringify(registerBody()),
      }),
      env,
    );

    expect(response.status).toBe(403);
    expect(db.query(`SELECT id FROM users`)).toHaveLength(0);
  });

  it('allows a same-origin login POST and one without an Origin header', async () => {
    await handleAuthRoute(jsonRequest('/api/auth/register', 'POST', registerBody()), env);

    const sameOrigin = await handleAuthRoute(
      new Request('https://example.test/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://example.test' },
        body: JSON.stringify({ email, password: 'Sup3rSecret!' }),
      }),
      env,
    );
    expect(sameOrigin.status).toBe(200);

    const noOrigin = await handleAuthRoute(
      jsonRequest('/api/auth/login', 'POST', { email, password: 'Sup3rSecret!' }),
      env,
    );
    expect(noOrigin.status).toBe(200);
  });
});

describe('POST /api/auth/login', () => {
  it('does not restart a trial or overwrite a paid subscription on subsequent login', async () => {
    await handleAuthRoute(jsonRequest('/api/auth/register', 'POST', registerBody()), env);
    const now = new Date().toISOString();
    const paidEnd = new Date(Date.now() + 30 * 86_400_000).toISOString();
    db.prepare(
      `UPDATE subscriptions SET plan_id = 'plan_growth', status = 'active', current_period_end = ?, updated_at = ?`,
    )
      .bind(paidEnd, now)
      .run();

    await handleAuthRoute(
      jsonRequest('/api/auth/login', 'POST', { email, password: 'Sup3rSecret!' }),
      env,
    );
    await handleAuthRoute(
      jsonRequest('/api/auth/login', 'POST', { email, password: 'Sup3rSecret!' }),
      env,
    );

    expect(db.query(`SELECT plan_id, status, current_period_end FROM subscriptions`)).toEqual([
      { plan_id: 'plan_growth', status: 'active', current_period_end: paidEnd },
    ]);
  });

  it('mints an HttpOnly session cookie for correct credentials', async () => {
    await handleAuthRoute(jsonRequest('/api/auth/register', 'POST', registerBody()), env);

    const loginResponse = await handleAuthRoute(
      jsonRequest('/api/auth/login', 'POST', { email, password: 'Sup3rSecret!' }),
      env,
    );
    const payload = await body(loginResponse);

    expect(payload.success).toBe(true);
    expect(payload.token).toBeUndefined();
    expect(loginResponse.headers.get('set-cookie')).toContain('__Host-cf_session=');

    const guarded = await handleBusinessRoute(
      new Request('https://example.test/api/business/campaign-config', {
        method: 'GET',
        headers: { cookie: sessionCookieHeader(loginResponse) },
      }),
      env,
    );
    expect(guarded.status).toBe(200);
  });

  it('stores the login session row with the same 3-day TTL as the cookie', async () => {
    await handleAuthRoute(jsonRequest('/api/auth/register', 'POST', registerBody()), env);

    await handleAuthRoute(jsonRequest('/api/auth/login', 'POST', { email, password: 'Sup3rSecret!' }), env);

    const session = db.query<{ created_at: string; expires_at: string }>(
      `SELECT created_at, expires_at FROM sessions ORDER BY created_at DESC`,
    )[0]!;
    const ttl = Date.parse(session.expires_at) - Date.parse(session.created_at);
    expect(ttl).toBeLessThanOrEqual(3 * 86_400_000 + 5);
    expect(ttl).toBeGreaterThan(3 * 86_400_000 - 10_000);
  });

  it('rejects a wrong password', async () => {
    await handleAuthRoute(jsonRequest('/api/auth/register', 'POST', registerBody()), env);

    const response = await handleAuthRoute(
      jsonRequest('/api/auth/login', 'POST', { email, password: 'WrongPassw0rd!' }),
      env,
    );

    expect(response.status).toBe(401);
  });

  it('answers an unknown email with the same 401 as a wrong password', async () => {
    const response = await handleAuthRoute(
      jsonRequest('/api/auth/login', 'POST', { email: 'nobody@example.test', password: 'Sup3rSecret!' }),
      env,
    );

    expect(response.status).toBe(401);
    expect((await body(response)).message).toBe('Invalid email or password.');
  });

  it('locks the account after five wrong passwords, even for the right one', async () => {
    await handleAuthRoute(jsonRequest('/api/auth/register', 'POST', registerBody()), env);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await handleAuthRoute(
        jsonRequest('/api/auth/login', 'POST', { email, password: 'WrongPassw0rd!' }),
        env,
      );
      expect(failed.status).toBe(401);
    }

    const locked = await handleAuthRoute(
      jsonRequest('/api/auth/login', 'POST', { email, password: 'Sup3rSecret!' }),
      env,
    );
    expect(locked.status).toBe(429);
    expect((await body(locked)).message).toBe('Too many failed attempts. Try again later.');
    // Only the registration session exists — the lock granted nothing.
    expect(db.query(`SELECT id FROM sessions`)).toHaveLength(1);

    // Simulate the lockout window elapsing: the next correct login recovers
    // and clears the counter.
    const userId = db.query<{ id: string }>(`SELECT id FROM users`)[0]!.id;
    db.prepare(`UPDATE users SET locked_until = ? WHERE id = ?`)
      .bind(new Date(Date.now() - 1000).toISOString(), userId)
      .run();

    const recovered = await handleAuthRoute(
      jsonRequest('/api/auth/login', 'POST', { email, password: 'Sup3rSecret!' }),
      env,
    );
    expect(recovered.status).toBe(200);
    expect(db.query(`SELECT failed_login_attempts, locked_until FROM users`)).toEqual([
      { failed_login_attempts: 0, locked_until: null },
    ]);
    expect(db.query(`SELECT id FROM sessions`)).toHaveLength(2);
  });
});

describe('transactional batch', () => {
  it('rolls every statement back when any of them fails', async () => {
    const now = new Date().toISOString();

    await expect(
      db.batch([
        db.prepare(
          `INSERT INTO users (id, email, password_hash, salt, first_name, last_name, email_verified, created_at, updated_at)
           VALUES (?, ?, 'h', 's', 'Ada', 'Lovelace', 0, ?, ?)`,
        ).bind('user-1', 'a@example.test', now, now),
        db.prepare(
          `INSERT INTO users (id, email, password_hash, salt, first_name, last_name, email_verified, created_at, updated_at)
           VALUES (?, ?, 'h', 's', 'Bob', 'Builder', 0, ?, ?)`,
        ).bind('user-2', 'a@example.test', now, now),
      ]),
    ).rejects.toThrow();

    expect(db.query(`SELECT id FROM users`)).toHaveLength(0);
  });
});

describe('password reset (P1-6)', () => {
  const GENERIC_MESSAGE = 'If that email is registered, a password reset link has been sent.';

  type CapturedSend = {
    From: { Email: string; Name?: string };
    To: Array<{ Email: string; Name?: string }>;
    Subject: string;
    TextPart?: string;
    HTMLPart: string;
  };

  /** Stubs the Mailjet send call and captures every message it was given. */
  function stubProvider(options: { status?: number } = {}): CapturedSend[] {
    const captured: CapturedSend[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        const parsed = JSON.parse(String(init?.body ?? '{}')) as { Messages?: CapturedSend[] };
        if (parsed.Messages?.[0]) captured.push(parsed.Messages[0]);
        return new Response(JSON.stringify({ Messages: [{ Status: 'success' }] }), {
          status: options.status ?? 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    return captured;
  }

  async function requestResetEmail(target: string, envOverride: Env = env): Promise<Response> {
    return handleAuthRoute(jsonRequest('/api/auth/forgot-password', 'POST', { email: target }), envOverride);
  }

  async function redeemToken(rawToken: string, password: string): Promise<Response> {
    return handleAuthRoute(
      jsonRequest('/api/auth/reset-password', 'POST', { token: rawToken, password }),
      env,
    );
  }

  async function extractTokenFromLastSend(captured: CapturedSend[]): Promise<string> {
    const match = captured.at(-1)?.HTMLPart.match(/token=(cfr_[0-9a-f]+)/);
    expect(match, 'reset email must contain the token link').toBeTruthy();
    return match![1]!;
  }

  async function registerAccount(): Promise<void> {
    const response = await handleAuthRoute(jsonRequest('/api/auth/register', 'POST', registerBody()), env);
    expect(response.status).toBe(200);
  }

  it('emails a single-use link and stores only its SHA-256 hash', async () => {
    await registerAccount();
    const captured = stubProvider();

    const response = await requestResetEmail(email);
    expect(response.status).toBe(200);
    expect((await body(response)).message).toBe(GENERIC_MESSAGE);

    expect(captured).toHaveLength(1);
    expect(captured[0]!.To).toEqual([{ Email: email }]);
    expect(captured[0]!.From).toEqual({ Email: 'no-reply@example.test', Name: 'CampaignFlow' });
    expect(captured[0]!.HTMLPart).toContain('/auth/reset-password?token=');

    const rawToken = await extractTokenFromLastSend(captured);
    const rows = db.query<{ token_hash: string; expires_at: string; used_at: string | null }>(
      'SELECT token_hash, expires_at, used_at FROM password_resets',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).toBe(await sha256Hex(rawToken));
    expect(rows[0]!.used_at).toBeNull();
    const ttl = Date.parse(rows[0]!.expires_at) - Date.now();
    expect(ttl).toBeGreaterThan(14 * 60_000);
    expect(ttl).toBeLessThanOrEqual(15 * 60_000);
    // The raw token must never be persisted anywhere.
    expect(JSON.stringify(db.query('SELECT * FROM password_resets'))).not.toContain(rawToken);
  });

  it('answers known and unknown emails with the exact same response', async () => {
    await registerAccount();
    const captured = stubProvider();

    const known = await requestResetEmail(email);
    const unknown = await requestResetEmail('nobody-' + crypto.randomUUID() + '@example.test');

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(await body(unknown)).toEqual(await body(known));
    expect(captured).toHaveLength(1);
    expect(db.query('SELECT id FROM password_resets')).toHaveLength(1);
  });

  it('redeems the token once, rewrites the password and revokes every session', async () => {
    await registerAccount();
    const captured = stubProvider();
    await requestResetEmail(email);
    const rawToken = await extractTokenFromLastSend(captured);

    const first = await redeemToken(rawToken, 'NewPass123!');
    expect(first.status).toBe(200);
    expect(db.query('SELECT id FROM password_resets')).toHaveLength(0);
    // The registration session died with the password change.
    expect(db.query('SELECT id FROM sessions')).toHaveLength(0);

    const oldPassword = await handleAuthRoute(
      jsonRequest('/api/auth/login', 'POST', { email, password: 'Sup3rSecret!' }),
      env,
    );
    expect(oldPassword.status).toBe(401);

    const newPassword = await handleAuthRoute(
      jsonRequest('/api/auth/login', 'POST', { email, password: 'NewPass123!' }),
      env,
    );
    expect(newPassword.status).toBe(200);

    const replay = await redeemToken(rawToken, 'ThirdPass123!');
    expect(replay.status).toBe(400);
    expect((await body(replay)).message).toContain('invalid or has expired');
  });

  it('rejects unknown and expired tokens without touching the account', async () => {
    await registerAccount();
    const unknown = await redeemToken('cfr_' + 'a'.repeat(64), 'NewPass123!');
    expect(unknown.status).toBe(400);

    const userId = db.query<{ id: string }>('SELECT id FROM users')[0]!.id;
    const expiredRaw = 'cfr_' + 'b'.repeat(64);
    db.prepare(
      `INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), userId, await sha256Hex(expiredRaw), '2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z')
      .run();

    const expired = await redeemToken(expiredRaw, 'NewPass123!');
    expect(expired.status).toBe(400);
    expect(db.query('SELECT id FROM sessions')).toHaveLength(1);
  });

  it('returns 503 without a mail provider, for any email', async () => {
    await registerAccount();
    const keyless = { ...env } as { MAILJET_API_KEY?: string };
    delete keyless.MAILJET_API_KEY;

    const known = await requestResetEmail(email, keyless as Env);
    const unknown = await requestResetEmail('nobody@example.test', keyless as Env);

    expect(known.status).toBe(503);
    expect(unknown.status).toBe(503);
    expect(await body(unknown)).toEqual(await body(known));
    expect(db.query('SELECT id FROM password_resets')).toHaveLength(0);
  });

  it('discards the token when the provider rejects the send', async () => {
    await registerAccount();
    stubProvider({ status: 500 });

    const response = await requestResetEmail(email);
    expect(response.status).toBe(503);
    expect(db.query('SELECT id FROM password_resets')).toHaveLength(0);
  });

  it('keeps only the newest token per account', async () => {
    await registerAccount();
    const captured = stubProvider();

    await requestResetEmail(email);
    const firstToken = await extractTokenFromLastSend(captured);
    // Bypass the per-minute reset cooldown so the second request actually sends.
    await env.TOKENS.delete(`pwreset:${email}`);
    await requestResetEmail(email);

    expect(db.query('SELECT id FROM password_resets')).toHaveLength(1);

    const stale = await redeemToken(firstToken, 'NewPass123!');
    expect(stale.status).toBe(400);

    const currentToken = await extractTokenFromLastSend(captured);
    const fresh = await redeemToken(currentToken, 'NewPass123!');
    expect(fresh.status).toBe(200);
  });

  it('rate-limits repeat reset requests without revealing it', async () => {
    await registerAccount();
    const captured = stubProvider();

    const first = await requestResetEmail(email);
    const second = await requestResetEmail(email);

    // The second call is swallowed by the cooldown: same generic answer,
    // but no second email goes out (email-bombing / quota-burn guard).
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await body(second)).message).toBe(GENERIC_MESSAGE);
    expect(captured).toHaveLength(1);
  });

  it('rejects cross-site POSTs to both endpoints', async () => {
    const headers = { 'content-type': 'application/json', origin: 'https://evil.test' };

    const forgot = await handleAuthRoute(
      new Request('https://example.test/api/auth/forgot-password', {
        method: 'POST',
        headers,
        body: JSON.stringify({ email }),
      }),
      env,
    );
    expect(forgot.status).toBe(403);
    expect((await body(forgot)).message).toBe('Cross-site request rejected.');

    const reset = await handleAuthRoute(
      new Request('https://example.test/api/auth/reset-password', {
        method: 'POST',
        headers,
        body: JSON.stringify({ token: 'cfr_x', password: 'NewPass123!' }),
      }),
      env,
    );
    expect(reset.status).toBe(403);
    expect(db.query('SELECT id FROM password_resets')).toHaveLength(0);
  });
});
