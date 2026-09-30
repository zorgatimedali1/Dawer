import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../types';
import { handleAuthRoute } from '../routes/auth';
import { handleBusinessRoute } from '../routes/business';
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

beforeEach(() => {
  const testEnv = createTestEnv();
  db = testEnv.DB;
  env = testEnv as unknown as Env;
});

afterEach(() => {
  db.close();
});

describe('POST /api/auth/register', () => {
  it('creates a user, business and session that immediately authenticates', async () => {
    const payload = await body(await handleAuthRoute(jsonRequest('/api/auth/register', 'POST', registerBody()), env));

    expect(payload.success).toBe(true);
    expect(payload.token).toMatch(/^cf_[0-9a-f]{32}\.[0-9a-f]{32}$/);

    const guarded = await handleBusinessRoute(
      jsonRequest('/api/business/campaign-config', 'GET', undefined, payload.token),
      env,
    );
    expect(guarded.status).toBe(200);

    expect(db.query(`SELECT id FROM users`)).toHaveLength(1);
    expect(db.query(`SELECT id FROM businesses`)).toHaveLength(1);
    expect(db.query(`SELECT role FROM business_members`)).toEqual([{ role: 'OWNER' }]);
    expect(db.query(`SELECT id FROM sessions`)).toHaveLength(1);
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
    expect(second.token).toBeTruthy();
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
});

describe('POST /api/auth/login', () => {
  it('returns a session token for correct credentials', async () => {
    await handleAuthRoute(jsonRequest('/api/auth/register', 'POST', registerBody()), env);

    const payload = await body(
      await handleAuthRoute(
        jsonRequest('/api/auth/login', 'POST', { email, password: 'Sup3rSecret!' }),
        env,
      ),
    );

    expect(payload.success).toBe(true);
    expect(payload.token).toMatch(/^cf_/);
  });

  it('rejects a wrong password', async () => {
    await handleAuthRoute(jsonRequest('/api/auth/register', 'POST', registerBody()), env);

    const response = await handleAuthRoute(
      jsonRequest('/api/auth/login', 'POST', { email, password: 'WrongPassw0rd!' }),
      env,
    );

    expect(response.status).toBe(401);
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
