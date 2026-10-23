import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../types';
import { handlePlatformBootstrapRoute } from '../routes/bootstrap';
import { handleOperatorAuthRoute } from '../routes/auth';
import { createTestEnv, type TestDatabase } from '../../tests/helpers/d1';
import { jsonRequest, seedOperator } from '../../tests/helpers/fixtures';

const TOKEN = 'bootstrap-secret-token';
const EMAIL = 'first@example.test';
const PASSWORD = 'first-boot-pass1';

let db: TestDatabase;
let env: Env & { PLATFORM_BOOTSTRAP_TOKEN?: string };

function bootstrapRequest(payload: unknown, token: string | null = TOKEN): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers['x-bootstrap-token'] = token;
  return new Request('https://example.test/api/bootstrap', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
}

async function operatorCount(): Promise<number> {
  const rows = db.query<{ id: string }>('SELECT id FROM platform_operators');
  return rows.length;
}

beforeEach(async () => {
  const testEnv = createTestEnv();
  db = testEnv.DB;
  env = testEnv as unknown as Env & { PLATFORM_BOOTSTRAP_TOKEN?: string };
  env.PLATFORM_BOOTSTRAP_TOKEN = TOKEN;
});

afterEach(() => {
  db.close();
});

describe('POST /api/bootstrap', () => {
  it('creates the first operator on an empty table', async () => {
    const response = await handlePlatformBootstrapRoute(
      bootstrapRequest({ email: EMAIL, password: PASSWORD, firstName: 'First', lastName: 'Boot' }),
      env,
    );

    expect(response.status).toBe(201);
    expect(await operatorCount()).toBe(1);

    const stored = db.query<{ email: string; status: string }>(
      'SELECT email, status FROM platform_operators',
    )[0];
    expect(stored.email).toBe('first@example.test');
    expect(stored.status).toBe('ACTIVE');
  });

  it('lets the provisioned operator log in immediately', async () => {
    await handlePlatformBootstrapRoute(
      bootstrapRequest({ email: EMAIL, password: PASSWORD }),
      env,
    );

    const login = await handleOperatorAuthRoute(
      jsonRequest('/api/auth/login', 'POST', { email: EMAIL.toUpperCase(), password: PASSWORD }),
      env,
    );

    expect(login.status).toBe(200);
  });

  it('404s without the route secret configured (fail closed)', async () => {
    delete env.PLATFORM_BOOTSTRAP_TOKEN;

    const response = await handlePlatformBootstrapRoute(
      bootstrapRequest({ email: EMAIL, password: PASSWORD }),
      env,
    );

    expect(response.status).toBe(404);
    expect(await operatorCount()).toBe(0);
  });

  it('404s with a wrong token', async () => {
    const response = await handlePlatformBootstrapRoute(
      bootstrapRequest({ email: EMAIL, password: PASSWORD }, 'wrong-token'),
      env,
    );

    expect(response.status).toBe(404);
    expect(await operatorCount()).toBe(0);
  });

  it('404s with a missing token header', async () => {
    const response = await handlePlatformBootstrapRoute(
      bootstrapRequest({ email: EMAIL, password: PASSWORD }, null),
      env,
    );

    expect(response.status).toBe(404);
    expect(await operatorCount()).toBe(0);
  });

  it('409s once any operator exists', async () => {
    await seedOperator(db);

    const response = await handlePlatformBootstrapRoute(
      bootstrapRequest({ email: EMAIL, password: PASSWORD }),
      env,
    );

    expect(response.status).toBe(409);
    expect(await operatorCount()).toBe(1);
  });

  it('400s on an invalid payload without creating anything', async () => {
    const response = await handlePlatformBootstrapRoute(
      bootstrapRequest({ email: 'not-an-email', password: 'short' }),
      env,
    );

    expect(response.status).toBe(400);
    expect(await operatorCount()).toBe(0);
  });

  it('405s on GET', async () => {
    const response = await handlePlatformBootstrapRoute(
      new Request('https://example.test/api/bootstrap'),
      env,
    );

    expect(response.status).toBe(405);
    expect(await operatorCount()).toBe(0);
  });
});
