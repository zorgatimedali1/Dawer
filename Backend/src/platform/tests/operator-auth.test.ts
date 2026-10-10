import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../types';
import { handleOperatorAuthRoute } from '../routes/auth';
import { handleAdminRoute } from '../routes/admin';
import { hashPassword } from '../../lib/crypto';
import { createTestEnv, type TestDatabase } from '../../tests/helpers/d1';
import {
  jsonRequest,
  operatorRequest,
  seedMerchant,
  seedOperator,
  OPERATOR_COOKIE_NAME,
  type SeededMerchant,
  type SeededOperator,
} from '../../tests/helpers/fixtures';

const EMAIL = 'ops@example.test';
const PASSWORD = 'correct-horse1';

let db: TestDatabase;
let env: Env;
let operator: SeededOperator;
let merchant: SeededMerchant;

type Payload = {
  success?: boolean;
  error?: string;
  operator?: { id: string; email: string; firstName?: string | null; lastName?: string | null };
};

async function body(response: Response): Promise<Payload> {
  return (await response.json()) as Payload;
}

function setCookie(response: Response): string {
  return response.headers.get('set-cookie') ?? '';
}

function sessionCookieFrom(response: Response): string {
  return setCookie(response).match(new RegExp(`${OPERATOR_COOKIE_NAME}=([^;]+)`))?.[1] ?? '';
}

function withSessionCookie(path: string, method: string, payload: unknown, cookie: string): Request {
  return new Request(`https://example.test${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie: `${OPERATOR_COOKIE_NAME}=${cookie}` },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
}

async function loginAsOperator(): Promise<string> {
  const response = await handleOperatorAuthRoute(
    jsonRequest('/api/auth/login', 'POST', { email: EMAIL, password: PASSWORD }),
    env,
  );
  expect(response.status).toBe(200);
  return sessionCookieFrom(response);
}

async function createOperatorWithPassword() {
  const { salt, hash } = await hashPassword(PASSWORD);
  const operatorId = crypto.randomUUID();

  db.prepare(
    `INSERT INTO platform_operators (id, email, password_hash, salt, first_name, last_name, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'Ops', 'Admin', 'ACTIVE', ?, ?)`,
  )
    .bind(operatorId, EMAIL, hash, salt, new Date().toISOString(), new Date().toISOString())
    .run();

  return operatorId;
}

beforeEach(async () => {
  const testEnv = createTestEnv();
  db = testEnv.DB;
  env = testEnv as unknown as Env;

  operator = await seedOperator(db);
  merchant = await seedMerchant(db, { email: 'merchant@example.test' });
});

afterEach(() => {
  db.close();
});

describe('POST /api/auth/login', () => {
  it('issues an HttpOnly operator session cookie', async () => {
    const operatorId = await createOperatorWithPassword();

    const response = await handleOperatorAuthRoute(
      jsonRequest('/api/auth/login', 'POST', { email: EMAIL, password: PASSWORD }),
      env,
    );

    expect(response.status).toBe(200);
    expect((await body(response)).operator).toMatchObject({ id: operatorId, email: EMAIL });

    const cookie = setCookie(response);
    expect(cookie).toContain(`${OPERATOR_COOKIE_NAME}=op_`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Max-Age=604800');
  });

  it('rejects a wrong password without leaking which half was wrong', async () => {
    await createOperatorWithPassword();

    const response = await handleOperatorAuthRoute(
      jsonRequest('/api/auth/login', 'POST', { email: EMAIL, password: 'not-the-password' }),
      env,
    );

    expect(response.status).toBe(401);
    expect((await body(response)).error).toBe('Invalid email or password.');
  });

  it('rejects an unknown email with the same message', async () => {
    const response = await handleOperatorAuthRoute(
      jsonRequest('/api/auth/login', 'POST', { email: 'nobody@example.test', password: PASSWORD }),
      env,
    );

    expect(response.status).toBe(401);
    expect((await body(response)).error).toBe('Invalid email or password.');
  });

  it('normalizes the email before looking it up', async () => {
    await createOperatorWithPassword();

    const response = await handleOperatorAuthRoute(
      jsonRequest('/api/auth/login', 'POST', { email: `  ${EMAIL.toUpperCase()}  `, password: PASSWORD }),
      env,
    );

    expect(response.status).toBe(200);
  });

  it('blocks a disabled operator', async () => {
    await createOperatorWithPassword();
    db.prepare(`UPDATE platform_operators SET status = 'SUSPENDED' WHERE email = ?`).bind(EMAIL).run();

    const response = await handleOperatorAuthRoute(
      jsonRequest('/api/auth/login', 'POST', { email: EMAIL, password: PASSWORD }),
      env,
    );

    expect(response.status).toBe(403);
    expect((await body(response)).error).toContain('disabled');
  });

  it('validates the payload', async () => {
    const response = await handleOperatorAuthRoute(
      jsonRequest('/api/auth/login', 'POST', { email: EMAIL, password: 'short' }),
      env,
    );

    expect(response.status).toBe(400);
  });

  it('never accepts a merchant account', async () => {
    const response = await handleOperatorAuthRoute(
      jsonRequest('/api/auth/login', 'POST', { email: 'merchant@example.test', password: PASSWORD }),
      env,
    );

    expect(response.status).toBe(401);
  });

  it('rejects a cross-site login POST (login CSRF)', async () => {
    await createOperatorWithPassword();
    const request = new Request('https://example.test/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });

    const response = await handleOperatorAuthRoute(request, env);

    expect(response.status).toBe(403);
    expect((await body(response)).error).toContain('Cross-site');
  });

  it('allows a same-origin login POST', async () => {
    await createOperatorWithPassword();
    const request = new Request('https://example.test/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://example.test' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });

    const response = await handleOperatorAuthRoute(request, env);

    expect(response.status).toBe(200);
  });
});

describe('GET /api/auth/session', () => {
  it('returns the operator behind a valid cookie', async () => {
    const response = await handleOperatorAuthRoute(
      operatorRequest('/api/auth/session', 'GET', undefined, operator.token),
      env,
    );

    expect(response.status).toBe(200);
    expect((await body(response)).operator).toMatchObject({
      id: operator.operatorId,
      email: 'operator@example.test',
    });
  });

  it('401s and clears the cookie without one', async () => {
    const response = await handleOperatorAuthRoute(operatorRequest('/api/auth/session', 'GET'), env);

    expect(response.status).toBe(401);
    expect(setCookie(response)).toContain(`${OPERATOR_COOKIE_NAME}=;`);
  });

  it('401s for a merchant session token presented as the cookie', async () => {
    const response = await handleOperatorAuthRoute(
      operatorRequest('/api/auth/session', 'GET', undefined, merchant.token),
      env,
    );

    expect(response.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('deletes the session and clears the cookie', async () => {
    const response = await handleOperatorAuthRoute(
      operatorRequest('/api/auth/logout', 'POST', undefined, operator.token),
      env,
    );

    expect(response.status).toBe(200);
    expect(setCookie(response)).toContain(`${OPERATOR_COOKIE_NAME}=;`);
    expect(db.query(`SELECT id FROM platform_sessions WHERE operator_id = ?`, operator.operatorId)).toHaveLength(0);

    const replay = await handleOperatorAuthRoute(
      operatorRequest('/api/auth/session', 'GET', undefined, operator.token),
      env,
    );
    expect(replay.status).toBe(401);
  });

  it('succeeds even without a session', async () => {
    const response = await handleOperatorAuthRoute(operatorRequest('/api/auth/logout', 'POST'), env);
    expect(response.status).toBe(200);
  });
});

describe('POST /api/auth/password', () => {
  it('rejects an incorrect current password', async () => {
    await createOperatorWithPassword();
    const cookie = await loginAsOperator();

    const response = await handleOperatorAuthRoute(
      withSessionCookie(
        '/api/auth/password',
        'POST',
        { currentPassword: 'wrong-password1', newPassword: 'brand-new-pass1' },
        cookie,
      ),
      env,
    );

    expect(response.status).toBe(400);
    expect((await body(response)).error).toContain('current password');
  });

  it('requires authentication', async () => {
    const response = await handleOperatorAuthRoute(
      operatorRequest('/api/auth/password', 'POST', { currentPassword: PASSWORD, newPassword: 'brand-new-pass1' }),
      env,
    );

    expect(response.status).toBe(401);
  });

  it('rotates the password, revokes sibling sessions and keeps the current one', async () => {
    const operatorId = await createOperatorWithPassword();
    const cookie = await loginAsOperator();

    const secondLogin = await handleOperatorAuthRoute(
      jsonRequest('/api/auth/login', 'POST', { email: EMAIL, password: PASSWORD }),
      env,
    );
    expect(secondLogin.status).toBe(200);
    expect(db.query(`SELECT id FROM platform_sessions WHERE operator_id = ?`, operatorId)).toHaveLength(2);

    const response = await handleOperatorAuthRoute(
      withSessionCookie(
        '/api/auth/password',
        'POST',
        { currentPassword: PASSWORD, newPassword: 'brand-new-pass1' },
        cookie,
      ),
      env,
    );

    expect(response.status).toBe(200);
    expect(db.query(`SELECT id FROM platform_sessions WHERE operator_id = ?`, operatorId)).toHaveLength(1);

    const oldLogin = await handleOperatorAuthRoute(
      jsonRequest('/api/auth/login', 'POST', { email: EMAIL, password: PASSWORD }),
      env,
    );
    expect(oldLogin.status).toBe(401);

    const newLogin = await handleOperatorAuthRoute(
      jsonRequest('/api/auth/login', 'POST', { email: EMAIL, password: 'brand-new-pass1' }),
      env,
    );
    expect(newLogin.status).toBe(200);
  });
});

describe('cross-worker isolation', () => {
  it('does not let an operator cookie unlock the admin console without a session row', async () => {
    const response = await handleAdminRoute(
      operatorRequest('/api/admin/accounts', 'GET', undefined, 'op_deadbeef.deadbeef'),
      env,
    );

    expect(response.status).toBe(401);
  });
});
