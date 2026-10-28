import { beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from './helpers/d1';
import { handleAgentIdentityRoute } from '../routes/agent-identity';
import { handleOauthTokenRoute } from '../routes/oauth';
import type { Env } from '../types';

let env: TestEnv;

beforeEach(() => {
  env = createTestEnv();
});

function jsonRequest(body: unknown): Request {
  return new Request('https://dawer.tn/api/agent/identity', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function payload<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe('POST /api/agent/identity', () => {
  it('stages an anonymous machine identity and the credentials work at the password grant', async () => {
    const response = await handleAgentIdentityRoute(jsonRequest({ type: 'anonymous' }), env as unknown as Env);
    expect(response.status).toBe(200);

    const body = await payload<{
      registration_id: string;
      registration_type: string;
      credentials: { username: string; password: string };
      pre_claim_scopes: string[];
      token_endpoint: string;
      claim_url: string;
      revocation_uri: string;
      auth_md: string;
    }>(response);

    expect(body.registration_id).toMatch(/^reg_/);
    expect(body.registration_type).toBe('anonymous');
    // Placeholder inbox on the domain the operator owns — never receives mail.
    expect(body.credentials.username).toMatch(/^agent-[0-9a-f]{8}@agents\.dawer\.tn$/);
    expect(body.credentials.password).toMatch(/^Anon_/);
    expect(body.pre_claim_scopes).toEqual(['api']);
    expect(body.token_endpoint).toBe('https://dawer.tn/api/oauth/token');
    expect(body.claim_url).toBe('https://dawer.tn/auth/login');
    expect(body.revocation_uri).toBe('https://dawer.tn/api/auth/logout');
    expect(body.auth_md).toBe('https://dawer.tn/auth.md');

    // Persisted as a real (unowned) user row, e-mail unverified.
    const row = env.DB.query<{ id: string; email_verified: number }>(
      'SELECT id, email_verified FROM users WHERE email = ?',
      body.credentials.username,
    ).at(0);
    expect(row?.id).toBe(body.registration_id.slice('reg_'.length));
    expect(row?.email_verified).toBe(0);

    // End-to-end: returned credentials mint a Bearer token at the password grant.
    const granted = await handleOauthTokenRoute(
      new Request('https://dawer.tn/api/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password',
          username: body.credentials.username,
          password: body.credentials.password,
        }).toString(),
      }),
      env as unknown as Env,
    );
    expect(granted.status).toBe(200);
    const token = await payload<{ access_token: string; token_type: string; scope: string }>(granted);
    expect(token.token_type).toBe('Bearer');
    expect(token.access_token).toBeTruthy();
    expect(token.scope).toBe('api');
  });

  it('rejects unsupported registration types with a pointer to auth.md', async () => {
    const response = await handleAgentIdentityRoute(
      jsonRequest({ type: 'service_auth' }),
      env as unknown as Env,
    );
    expect(response.status).toBe(400);
    const body = await payload<{ message: string }>(response);
    expect(body.message).toContain('anonymous');
    expect(body.message).toContain('/auth.md');
  });

  it('rejects malformed JSON bodies', async () => {
    const response = await handleAgentIdentityRoute(
      new Request('https://dawer.tn/api/agent/identity', { method: 'POST', body: 'not json' }),
      env as unknown as Env,
    );
    expect(response.status).toBe(400);
  });

  it('404s every path and method besides POST /api/agent/identity', async () => {
    const other = await handleAgentIdentityRoute(
      new Request('https://dawer.tn/api/agent/identity', { method: 'GET' }),
      env as unknown as Env,
    );
    expect(other.status).toBe(404);

    const unknown = await handleAgentIdentityRoute(
      new Request('https://dawer.tn/api/agent', { method: 'GET' }),
      env as unknown as Env,
    );
    expect(unknown.status).toBe(404);
  });
});
