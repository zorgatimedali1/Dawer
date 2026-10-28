import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../types';
import { handleAuthRoute } from '../routes/auth';
import { handleBusinessRoute } from '../routes/business';
import { handleOauthDiscoveryRoute, handleOauthTokenRoute } from '../routes/oauth';
import { createTestEnv, type TestDatabase } from './helpers/d1';
import { jsonRequest } from './helpers/fixtures';

let db: TestDatabase;
let env: Env;

const password = 'Sup3rSecret!';

/** RFC 6749 §4.3.2 wire format */
function formRequest(body: Record<string, string>): Request {
  return new Request('https://dawer.tn/api/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
}

async function payload(response: Response): Promise<Record<string, any>> {
  return (await response.json()) as Record<string, any>;
}

async function seedRegisteredMerchant() {
  const email = `owner-${crypto.randomUUID().slice(0, 8)}@example.test`;
  const registered = await handleAuthRoute(
    jsonRequest('/api/auth/register', 'POST', {
      email,
      password,
      firstName: 'Ada',
      lastName: 'Lovelace',
      businessName: 'Smoke Shop',
    }),
    env,
  );
  return { email, registered };
}

function campaignConfigCall(token: string): Request {
  return new Request('https://dawer.tn/api/business/campaign-config', {
    method: 'GET',
    headers: { authorization: `Bearer ${token}` },
  });
}

beforeEach(() => {
  const testEnv = createTestEnv();
  db = testEnv.DB;
  env = testEnv as unknown as Env;
});

afterEach(() => {
  db.close();
});

describe('GET /.well-known/oauth-authorization-server', () => {
  it('publishes RFC 8414 discovery metadata', async () => {
    const response = await handleOauthDiscoveryRoute(
      new Request('https://dawer.tn/.well-known/oauth-authorization-server'),
      env,
    );
    const data = await payload(response);

    expect(response.status).toBe(200);
    expect(data.issuer).toBe('https://dawer.tn');
    expect(data.authorization_endpoint).toBe('https://dawer.tn/api/auth/google');
    expect(data.token_endpoint).toBe('https://dawer.tn/api/oauth/token');
    expect(data.grant_types_supported).toEqual(['password']);
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  it('404s for other well-known paths', async () => {
    const response = await handleOauthDiscoveryRoute(
      new Request('https://dawer.tn/.well-known/openid-configuration'),
      env,
    );
    expect(response.status).toBe(404);
  });
});

describe('POST /api/oauth/token', () => {
  it('mints a Bearer token from valid merchant credentials', async () => {
    const { email } = await seedRegisteredMerchant();

    const granted = await handleOauthTokenRoute(
      formRequest({ grant_type: 'password', username: email, password }),
      env,
    );
    const data = await payload(granted);

    expect(granted.status).toBe(200);
    expect(data.token_type).toBe('Bearer');
    expect(data.access_token).toBeTruthy();
    expect(data.scope).toBe('api');
    // RFC 6749 §5.1: token responses are never cached.
    expect(granted.headers.get('cache-control')).toBe('no-store');

    // Newly matted token is accepted by protected APIs.
    const guarded = await handleBusinessRoute(campaignConfigCall(data.access_token), env);
    expect(guarded.status).toBe(200);
  });

  it('email matching is case-insensitive', async () => {
    const { email } = await seedRegisteredMerchant();

    const granted = await handleOauthTokenRoute(
      formRequest({ grant_type: 'password', username: email.toUpperCase(), password }),
      env,
    );
    expect(granted.status).toBe(200);
  });

  it('rejects an invalid password with RFC invalid_grant, and existing session cookies keep working', async () => {
    const { email, registered } = await seedRegisteredMerchant();
    const loginCookieValue = (registered.headers.get('set-cookie') ?? '').split(';')[0]?.split('=')[1] ?? '';

    const bad = await handleOauthTokenRoute(
      formRequest({ grant_type: 'password', username: email, password: 'Wr0ngPass!' }),
      env,
    );
    const data = await payload(bad);

    expect(bad.status).toBe(400);
    expect(data.error).toBe('invalid_grant');
    // No token minted.
    expect(data.access_token).toBeUndefined();

    // The interactive login's cookie still authenticated the user minutes ago.
    const guarded = await handleBusinessRoute(
      new Request('https://dawer.tn/api/business/campaign-config', {
        method: 'GET',
        headers: { cookie: `__Host-cf_session=${loginCookieValue}` },
      }),
      env,
    );
    expect(guarded.status).toBe(200);
  });

  it('rejects an unknown account with the same invalid_grant response', async () => {
    const bad = await handleOauthTokenRoute(
      formRequest({ grant_type: 'password', username: 'ghost@example.test', password }),
      env,
    );
    const data = await payload(bad);

    expect(bad.status).toBe(400);
    expect(data.error).toBe('invalid_grant');
  });

  it('rejects unsupported grant types with unsupported_grant_type', async () => {
    const bad = await handleOauthTokenRoute(
      formRequest({ grant_type: 'client_credentials' }),
      env,
    );
    const data = await payload(bad);

    expect(bad.status).toBe(400);
    expect(data.error).toBe('unsupported_grant_type');
  });

  it('rejects missing credentials', async () => {
    await seedRegisteredMerchant();

    const missingPassword = await handleOauthTokenRoute(
      formRequest({ grant_type: 'password', username: 'owner@example.test' }),
      env,
    );
    expect((await payload(missingPassword)).error).toBe('invalid_request');

    const missingUsername = await handleOauthTokenRoute(
      formRequest({ grant_type: 'password', password }),
      env,
    );
    expect((await payload(missingUsername)).error).toBe('invalid_request');
  });

  it('404s for unknown subpaths and 405s for GET on the token endpoint', async () => {
    const notFound = await handleOauthTokenRoute(
      new Request('https://dawer.tn/api/oauth/authorize', { method: 'POST' }),
      env,
    );
    expect(notFound.status).toBe(404);

    const methodNotAllowed = await handleOauthTokenRoute(
      new Request('https://dawer.tn/api/oauth/token'),
      env,
    );
    expect(methodNotAllowed.status).toBe(405);
  });
});
