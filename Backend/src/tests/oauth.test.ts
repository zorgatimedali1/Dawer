import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../types';
import { handleAuthRoute } from '../routes/auth';
import { codeChallengeS256 } from '../lib/crypto';
import { createTestEnv, type TestEnv } from './helpers/d1';
import { jsonRequest, seedMerchant } from './helpers/fixtures';

const CLIENT = {
  GOOGLE_CLIENT_ID: 'client-id.test',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  GOOGLE_REDIRECT_URI: 'http://localhost/api/auth/google/callback',
};

let raw: TestEnv;
let env: Env;

function setCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const combined = response.headers.get('set-cookie');
  return combined ? [combined] : [];
}

function cookieNamed(cookies: string[], name: string): string | null {
  for (const cookie of cookies) {
    const [pair] = cookie.split(';');
    if (!pair) continue;
    const separator = pair.indexOf('=');
    if (separator < 0) continue;
    if (pair.slice(0, separator).trim() === name) return decodeURIComponent(pair.slice(separator + 1).trim());
  }
  return null;
}

function cookieHeader(cookies: string[]): string {
  return cookies.map((cookie) => cookie.split(';')[0]).join('; ');
}

function callbackUrl(state: string): string {
  return `/api/auth/google/callback?code=auth-code&state=${encodeURIComponent(state)}`;
}

async function startFlow(): Promise<{ cookies: string[]; state: string }> {
  const response = await handleAuthRoute(jsonRequest('/api/auth/google', 'GET'), env);
  const cookies = setCookies(response);
  const location = response.headers.get('location') ?? '';
  const state = new URL(location).searchParams.get('state') ?? '';
  return { cookies, state };
}

function stubGoogleFetch(captured: { tokenBody?: string } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const json = (payload: unknown) =>
        new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });

      if (url.includes('oauth2.googleapis.com/token')) {
        captured.tokenBody = init?.body ? String(init.body) : '';
        return json({ access_token: 'google-access-token' });
      }
      if (url.includes('openidconnect.googleapis.com')) {
        return json({ sub: 'google-sub-1', email: 'ada@example.test', name: 'Ada Lovelace' });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }),
  );
}

beforeEach(() => {
  raw = createTestEnv();
  env = raw as unknown as Env;
  Object.assign(env, CLIENT);
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  raw.DB.close();
});

describe('GET /api/auth/google', () => {
  it('redirects to Google with a single-use HttpOnly state cookie and PKCE', async () => {
    const response = await handleAuthRoute(jsonRequest('/api/auth/google', 'GET'), env);

    expect(response.status).toBe(302);
    const location = response.headers.get('location') ?? '';
    expect(location.startsWith('https://accounts.google.com/o/oauth2/v2/auth?')).toBe(true);

    // PKCE (S256): the authorization URL carries only the challenge; the
    // verifier is held server-side in the single-use oauth_states row.
    const params = new URL(location).searchParams;
    expect(params.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(params.get('code_challenge_method')).toBe('S256');

    const stored = raw.DB.query<{ pkce_verifier: string }>('SELECT pkce_verifier FROM oauth_states');
    expect(stored).toHaveLength(1);
    expect((await codeChallengeS256(stored[0].pkce_verifier)) === params.get('code_challenge')).toBe(true);

    const cookies = setCookies(response);
    const state = cookieNamed(cookies, '__Host-cf_oauth_state');
    expect(state).toBeTruthy();
    expect(cookies.find((cookie) => cookie.startsWith('__Host-cf_oauth_state='))).toMatch(/HttpOnly/);
    expect(params.get('state')).toBe(state);
    expect(stored[0].pkce_verifier).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns 501 when OAuth is not configured', async () => {
    Object.assign(env, { GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GOOGLE_REDIRECT_URI: '' });
    const response = await handleAuthRoute(jsonRequest('/api/auth/google', 'GET'), env);
    expect(response.status).toBe(501);
  });
});

describe('GET /api/auth/google/callback', () => {
  // The callback is a browser navigation (Google redirects the user here), so
  // failures must land on the login page with `?error=`, never as raw JSON.
  function oauthErrorParam(response: Response): string | null {
    const location = response.headers.get('location') ?? '';
    return new URL(location, 'https://example.test').searchParams.get('error');
  }

  it('rejects a state that did not come from our cookie', async () => {
    const response = await handleAuthRoute(
      jsonRequest('/api/auth/google/callback?code=abc&state=forged', 'GET'),
      env,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toMatch(/^\/auth\/login\?error=/);
    expect(oauthErrorParam(response)).toMatch(/state/i);
    expect(setCookies(response).join(';')).toMatch(/cf_oauth_state=;.*Max-Age=0/);
  });

  it('rejects a state our cookie does not match', async () => {
    const { state } = await startFlow();
    const request = new Request(`https://example.test${callbackUrl(state)}`, {
      headers: { cookie: 'cf_oauth_state=someone-elses-state' },
    });

    const response = await handleAuthRoute(request, env);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toMatch(/^\/auth\/login\?error=/);
  });

  it('issues the session as an HttpOnly cookie and never puts the token in the URL', async () => {
    stubGoogleFetch();
    const { cookies, state } = await startFlow();

    const response = await handleAuthRoute(
      new Request(`https://example.test${callbackUrl(state)}`, { headers: { cookie: cookieHeader(cookies) } }),
      env,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/auth/callback');

    const responseCookies = setCookies(response);
    const session = cookieNamed(responseCookies, '__Host-cf_session');
    expect(session).toMatch(/^cf_[0-9a-f]{32}\.[0-9a-f]{32}$/);
    expect(responseCookies.find((cookie) => cookie.startsWith('__Host-cf_session='))).toMatch(/HttpOnly/);
    expect(raw.DB.query('SELECT state FROM oauth_states')).toHaveLength(0);

    // The session is persisted, and the SPA can now exchange the cookie.
    const exchange = await handleAuthRoute(
      new Request('https://example.test/api/auth/session', { headers: { cookie: cookieHeader(responseCookies) } }),
      env,
    );
    expect(exchange.status).toBe(200);
    const payload = (await exchange.json()) as { token?: string; user: { email: string } };
    // P1-1: the profile is returned without the token — the cookie is HttpOnly.
    expect(payload.token).toBeUndefined();
    expect(payload.user.email).toBe('ada@example.test');
  });

  it('redeems the authorization code with the PKCE verifier it held', async () => {
    const captured: { tokenBody?: string } = {};
    stubGoogleFetch(captured);
    const { cookies, state } = await startFlow();
    const [{ pkce_verifier: verifier }] = raw.DB.query<{ pkce_verifier: string }>(
      'SELECT pkce_verifier FROM oauth_states',
    );

    const response = await handleAuthRoute(
      new Request(`https://example.test${callbackUrl(state)}`, { headers: { cookie: cookieHeader(cookies) } }),
      env,
    );

    expect(response.status).toBe(302);
    expect(captured.tokenBody).toContain(`code_verifier=${verifier}`);
  });

  it('seeds a business so a fresh Google account can use the dashboard', async () => {
    stubGoogleFetch();
    const { cookies, state } = await startFlow();

    const response = await handleAuthRoute(
      new Request(`https://example.test${callbackUrl(state)}`, { headers: { cookie: cookieHeader(cookies) } }),
      env,
    );
    expect(response.status).toBe(302);

    const businesses = raw.DB.query<{ name: string; slug: string }>(`SELECT name, slug FROM businesses`);
    expect(businesses).toEqual([{ name: 'Ada Lovelace', slug: 'ada-lovelace' }]);
    expect(raw.DB.query(`SELECT plan_id, status FROM subscriptions`)).toEqual([
      { plan_id: 'plan_starter', status: 'trialing' },
    ]);

    const members = raw.DB.query<{ role: string }>(`SELECT role FROM business_members`);
    expect(members).toEqual([{ role: 'OWNER' }]);

    // The account can now reach a business-scoped route (the legacy cookie
    // name still authenticates through the dual-read fallback).
    const session = cookieNamed(setCookies(response), '__Host-cf_session');
    const exchange = await handleAuthRoute(
      new Request('https://example.test/api/auth/session', {
        headers: { cookie: `cf_session=${encodeURIComponent(session ?? '')}` },
      }),
      env,
    );
    expect(exchange.status).toBe(200);
  });

  it('does not add a second business when the account already has one', async () => {
    stubGoogleFetch();
    await seedMerchant(raw.DB, { email: 'ada@example.test', businessName: 'Existing Shop' });
    const { cookies, state } = await startFlow();

    const response = await handleAuthRoute(
      new Request(`https://example.test${callbackUrl(state)}`, { headers: { cookie: cookieHeader(cookies) } }),
      env,
    );
    expect(response.status).toBe(302);

    expect(raw.DB.query(`SELECT id FROM businesses`)).toHaveLength(1);
    expect(raw.DB.query<{ name: string }>(`SELECT name FROM businesses`)).toEqual([{ name: 'Existing Shop' }]);
  });

  it('refuses to absorb an unverified password account (account-takeover guard)', async () => {
    stubGoogleFetch();
    await seedMerchant(raw.DB, { email: 'ada@example.test', businessName: 'Pre-registered Shop' });
    // Password registration never verifies the email; a Google sign-in with
    // the same address must not silently take the account over.
    raw.DB.prepare(`UPDATE users SET email_verified = 0 WHERE email = ?`).bind('ada@example.test').run();

    const { cookies, state } = await startFlow();
    const response = await handleAuthRoute(
      new Request(`https://example.test${callbackUrl(state)}`, { headers: { cookie: cookieHeader(cookies) } }),
      env,
    );

    expect(response.status).toBe(302);
    expect(oauthErrorParam(response)).toMatch(/password/i);
    expect(raw.DB.query(`SELECT id FROM accounts`)).toHaveLength(0);
  });

  it('cannot be replayed once the state has been consumed', async () => {
    stubGoogleFetch();
    const { cookies, state } = await startFlow();

    const first = await handleAuthRoute(
      new Request(`https://example.test${callbackUrl(state)}`, { headers: { cookie: cookieHeader(cookies) } }),
      env,
    );
    expect(first.status).toBe(302);

    const replay = await handleAuthRoute(
      new Request(`https://example.test${callbackUrl(state)}`, { headers: { cookie: cookieHeader(cookies) } }),
      env,
    );
    expect(replay.status).toBe(302);
    expect(oauthErrorParam(replay)).toMatch(/state/i);
  });
});

describe('GET /api/auth/session', () => {
  it('401s without a session cookie', async () => {
    const response = await handleAuthRoute(jsonRequest('/api/auth/session', 'GET'), env);
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: string }).error).toMatch(/expired/i);
  });

  it('401s for a token that is not a live session', async () => {
    const response = await handleAuthRoute(
      new Request('https://example.test/api/auth/session', {
        headers: { cookie: 'cf_session=cf_deadbeef.deadbeef' },
      }),
      env,
    );
    expect(response.status).toBe(401);
  });

  it('returns the profile for a live session created by registration', async () => {
    const registered = await handleAuthRoute(
      jsonRequest('/api/auth/register', 'POST', {
        email: 'ada@example.test',
        password: 'Sup3rSecret!',
        firstName: 'Ada',
        lastName: 'Lovelace',
      }),
      env,
    );
    const sessionValue = decodeURIComponent(
      (registered.headers.get('set-cookie') ?? '').split(';')[0]!.split('=').slice(1).join('='),
    );

    const response = await handleAuthRoute(
      new Request('https://example.test/api/auth/session', {
        headers: { cookie: `cf_session=${encodeURIComponent(sessionValue)}` },
      }),
      env,
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { token?: string; user: { firstName: string; lastName: string } };
    expect(payload.token).toBeUndefined();
    expect(payload.user).toMatchObject({ firstName: 'Ada', lastName: 'Lovelace' });
  });
});

describe('tenant scoping regression guards', () => {
  it('does not leak sessions across users', async () => {
    const mine = await seedMerchant(raw.DB, { email: 'mine@example.test' });
    const theirs = await seedMerchant(raw.DB, { email: 'theirs@example.test' });

    const mineSession = await handleAuthRoute(
      new Request('https://example.test/api/auth/session', {
        headers: { cookie: `cf_session=${encodeURIComponent(mine.token)}` },
      }),
      env,
    );
    expect(((await mineSession.json()) as { user: { email: string } }).user.email).toBe('mine@example.test');
    expect(theirs.token).not.toBe(mine.token);
  });
});
