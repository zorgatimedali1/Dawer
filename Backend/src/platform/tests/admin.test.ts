import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../types';
import { handleAdminRoute } from '../routes/admin';
import { createTestEnv, type TestDatabase } from '../../tests/helpers/d1';
import {
  jsonRequest,
  operatorRequest,
  seedMerchant,
  seedOperator,
  type SeededMerchant,
  type SeededOperator,
} from '../../tests/helpers/fixtures';

let db: TestDatabase;
let env: Env;
let operator: SeededOperator;
let merchant: SeededMerchant;

async function body(response: Response) {
  return (await response.json()) as Record<string, any>;
}

async function countRows(sql: string, ...binds: string[]) {
  const row = await db.prepare(sql).bind(...binds).first<{ n: number }>();
  return row?.n ?? 0;
}

beforeEach(async () => {
  const testEnv = createTestEnv();
  db = testEnv.DB;
  env = testEnv as unknown as Env;

  operator = await seedOperator(db);
  merchant = await seedMerchant(db, { email: 'merchant@example.test', businessName: 'Merchant Shop' });
  await seedMerchant(db, { email: 'second@example.test', businessName: 'Second Shop' });
});

afterEach(() => {
  db.close();
});

describe('operator authorization', () => {
  it('401s without a session cookie', async () => {
    const response = await handleAdminRoute(jsonRequest('/api/admin/accounts', 'GET'), env);
    expect(response.status).toBe(401);
  });

  it('401s for a merchant bearer token', async () => {
    const response = await handleAdminRoute(
      jsonRequest('/api/admin/accounts', 'GET', undefined, merchant.token),
      env,
    );
    expect(response.status).toBe(401);
    expect((await body(response)).error).toContain('Authentication required');
  });

  it('401s when the operator account has been disabled', async () => {
    db.prepare(`UPDATE platform_operators SET status = 'SUSPENDED' WHERE id = ?`)
      .bind(operator.operatorId)
      .run();
    const response = await handleAdminRoute(
      operatorRequest('/api/admin/accounts', 'GET', undefined, operator.token),
      env,
    );
    expect(response.status).toBe(401);
  });

  it('401s for an expired operator session', async () => {
    db.prepare(`UPDATE platform_sessions SET expires_at = ? WHERE operator_id = ?`)
      .bind(new Date(Date.now() - 1000).toISOString(), operator.operatorId)
      .run();
    const response = await handleAdminRoute(
      operatorRequest('/api/admin/accounts', 'GET', undefined, operator.token),
      env,
    );
    expect(response.status).toBe(401);
  });

  it('404s for paths outside /api/admin/accounts', async () => {
    const response = await handleAdminRoute(
      operatorRequest('/api/admin/other', 'GET', undefined, operator.token),
      env,
    );
    expect(response.status).toBe(404);
  });
});

describe('GET /api/admin/accounts', () => {
  it('lists accounts with business and session counts', async () => {
    const payload = await body(
      await handleAdminRoute(
        operatorRequest('/api/admin/accounts', 'GET', undefined, operator.token),
        env,
      ),
    );

    expect(payload.success).toBe(true);
    expect(payload.pagination.total).toBe(2);

    const merchantRow = payload.accounts.find((row: { email: string }) => row.email === 'merchant@example.test');
    expect(merchantRow).toMatchObject({ status: 'ACTIVE', businessCount: 1 });
    expect(merchantRow).not.toHaveProperty('isAdmin');
    expect(merchantRow.sessionCount).toBeGreaterThanOrEqual(1);
  });

  it('never lists operators as accounts', async () => {
    const payload = await body(
      await handleAdminRoute(
        operatorRequest('/api/admin/accounts', 'GET', undefined, operator.token),
        env,
      ),
    );

    const emails = payload.accounts.map((row: { email: string }) => row.email);
    expect(emails).not.toContain('operator@example.test');
  });

  it('only lists accounts that have logged in at least once', async () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO users (id, email, password_hash, salt, first_name, last_name, email_verified, created_at, updated_at)
       VALUES (?, 'never-signed-in@example.test', 'x', 'y', 'Never', 'Signed', 1, ?, ?)`,
    )
      .bind(crypto.randomUUID(), now, now)
      .run();

    const payload = await body(
      await handleAdminRoute(
        operatorRequest('/api/admin/accounts', 'GET', undefined, operator.token),
        env,
      ),
    );

    const emails = payload.accounts.map((row: { email: string }) => row.email);
    expect(emails).not.toContain('never-signed-in@example.test');
    expect(payload.pagination.total).toBe(2);
  });

  it('searches by email and filters by status', async () => {
    const search = await body(
      await handleAdminRoute(
        operatorRequest('/api/admin/accounts?search=merchant%40example.test', 'GET', undefined, operator.token),
        env,
      ),
    );
    expect(search.accounts).toHaveLength(1);
    expect(search.accounts[0].email).toBe('merchant@example.test');

    const suspended = await body(
      await handleAdminRoute(
        operatorRequest('/api/admin/accounts?status=SUSPENDED', 'GET', undefined, operator.token),
        env,
      ),
    );
    expect(suspended.pagination.total).toBe(0);
  });

  it('paginates', async () => {
    const pageOne = await body(
      await handleAdminRoute(
        operatorRequest('/api/admin/accounts?page=1&limit=1', 'GET', undefined, operator.token),
        env,
      ),
    );
    expect(pageOne.accounts).toHaveLength(1);
    expect(pageOne.pagination).toMatchObject({ page: 1, limit: 1, total: 2, totalPages: 2 });

    const pageTwo = await body(
      await handleAdminRoute(
        operatorRequest('/api/admin/accounts?page=2&limit=1', 'GET', undefined, operator.token),
        env,
      ),
    );
    expect(pageTwo.accounts).toHaveLength(1);
    expect(pageTwo.accounts[0].id).not.toBe(pageOne.accounts[0].id);
  });
});

describe('GET /api/admin/accounts/:id', () => {
  it('returns the account, its businesses, sessions and identities', async () => {
    const payload = await body(
      await handleAdminRoute(
        operatorRequest(`/api/admin/accounts/${merchant.userId}`, 'GET', undefined, operator.token),
        env,
      ),
    );

    expect(payload.account).toMatchObject({ email: 'merchant@example.test', status: 'ACTIVE', businessCount: 1 });
    expect(payload.businesses).toHaveLength(1);
    expect(payload.businesses[0]).toMatchObject({ name: 'Merchant Shop', role: 'OWNER' });
    expect(payload.sessions.length).toBeGreaterThanOrEqual(1);
    expect(payload.auditTrail).toEqual([]);
  });

  it('includes operator actions recorded against the account, not just by it', async () => {
    await handleAdminRoute(
      operatorRequest(`/api/admin/accounts/${merchant.userId}/suspend`, 'POST', { reason: 'probe' }, operator.token),
      env,
    );
    await handleAdminRoute(
      operatorRequest(`/api/admin/accounts/${merchant.userId}/activate`, 'POST', {}, operator.token),
      env,
    );

    const payload = await body(
      await handleAdminRoute(
        operatorRequest(`/api/admin/accounts/${merchant.userId}`, 'GET', undefined, operator.token),
        env,
      ),
    );

    const actions = payload.auditTrail.map((entry: { action: string }) => entry.action);
    expect(actions).toContain('ADMIN_ACCOUNT_SUSPENDED');
    expect(actions).toContain('ADMIN_ACCOUNT_ACTIVATED');
  });

  it("does not leak another account's operator actions", async () => {
    await handleAdminRoute(
      operatorRequest(`/api/admin/accounts/${merchant.userId}/suspend`, 'POST', { reason: 'probe' }, operator.token),
      env,
    );

    const other = await seedMerchant(db, { email: 'untouched@example.test' });
    const payload = await body(
      await handleAdminRoute(
        operatorRequest(`/api/admin/accounts/${other.userId}`, 'GET', undefined, operator.token),
        env,
      ),
    );

    expect(payload.auditTrail).toEqual([]);
  });

  it('404s for an unknown account', async () => {
    const response = await handleAdminRoute(
      operatorRequest('/api/admin/accounts/nope', 'GET', undefined, operator.token),
      env,
    );
    expect(response.status).toBe(404);
  });
});

describe('suspending an account', () => {
  it('requires a reason', async () => {
    const response = await handleAdminRoute(
      operatorRequest(`/api/admin/accounts/${merchant.userId}/suspend`, 'POST', {}, operator.token),
      env,
    );
    expect(response.status).toBe(400);
    expect((await body(response)).error).toBe('Validation failed.');
  });

  it('blocks the account immediately and kills its sessions', async () => {
    const payload = await body(
      await handleAdminRoute(
        operatorRequest(`/api/admin/accounts/${merchant.userId}/suspend`, 'POST', { reason: 'payment overdue' }, operator.token),
        env,
      ),
    );

    expect(payload).toMatchObject({ success: true, status: 'SUSPENDED', revokedSessions: 1 });
    expect(db.query<{ status: string }>('SELECT status FROM users WHERE id = ?', merchant.userId)[0].status).toBe('SUSPENDED');
    expect(db.query(`SELECT id FROM sessions WHERE user_id = ?`, merchant.userId)).toHaveLength(0);

    const merchantResponse = await handleAdminRoute(
      jsonRequest('/api/admin/accounts', 'GET', undefined, merchant.token),
      env,
    );
    expect(merchantResponse.status).toBe(401);
  });

  it('writes an audit entry with the reason and the operator as actor', async () => {
    await handleAdminRoute(
      operatorRequest(`/api/admin/accounts/${merchant.userId}/suspend`, 'POST', { reason: 'terms violation' }, operator.token),
      env,
    );

    const entry = db.query<{ action: string; metadata: string; user_id: string | null; platform_operator_id: string | null }>(
      'SELECT action, metadata, user_id, platform_operator_id FROM audit_logs ORDER BY created_at DESC',
    )[0];
    expect(entry.action).toBe('ADMIN_ACCOUNT_SUSPENDED');
    expect(entry.metadata).toContain('terms violation');
    expect(entry.platform_operator_id).toBe(operator.operatorId);
    expect(entry.user_id).toBeNull();
  });

  it('404s for an unknown account', async () => {
    const response = await handleAdminRoute(
      operatorRequest('/api/admin/accounts/nope/suspend', 'POST', { reason: 'nope' }, operator.token),
      env,
    );
    expect(response.status).toBe(404);
  });
});

describe('activating an account', () => {
  it('restores access and audits it', async () => {
    db.prepare(`UPDATE users SET status = 'SUSPENDED' WHERE id = ?`).bind(merchant.userId).run();

    const payload = await body(
      await handleAdminRoute(
        operatorRequest(`/api/admin/accounts/${merchant.userId}/activate`, 'POST', {}, operator.token),
        env,
      ),
    );

    expect(payload).toMatchObject({ success: true, status: 'ACTIVE', revokedSessions: 0 });
    expect(db.query<{ status: string }>('SELECT status FROM users WHERE id = ?', merchant.userId)[0].status).toBe('ACTIVE');

    const entry = db.query<{ action: string }>('SELECT action FROM audit_logs ORDER BY created_at DESC')[0];
    expect(entry.action).toBe('ADMIN_ACCOUNT_ACTIVATED');
  });

  it('does not resurrect sessions that were already deleted', async () => {
    await handleAdminRoute(
      operatorRequest(`/api/admin/accounts/${merchant.userId}/suspend`, 'POST', { reason: 'suspend first' }, operator.token),
      env,
    );
    expect(db.query(`SELECT id FROM sessions WHERE user_id = ?`, merchant.userId)).toHaveLength(0);

    await handleAdminRoute(
      operatorRequest(`/api/admin/accounts/${merchant.userId}/activate`, 'POST', {}, operator.token),
      env,
    );

    expect(db.query(`SELECT id FROM sessions WHERE user_id = ?`, merchant.userId)).toHaveLength(0);

    // Sign-in works again once reactivated.
    db.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, 'new-hash', ?, ?)`,
    ).bind(crypto.randomUUID(), merchant.userId, new Date().toISOString(), new Date(Date.now() + 1000).toISOString()).run();
    expect(db.query(`SELECT id FROM sessions WHERE user_id = ?`, merchant.userId)).toHaveLength(1);
  });
});

describe('POST /api/admin/accounts/:id/revoke-sessions', () => {
  it('signs every device out and audits it', async () => {
    const payload = await body(
      await handleAdminRoute(
        operatorRequest(`/api/admin/accounts/${merchant.userId}/revoke-sessions`, 'POST', {}, operator.token),
        env,
      ),
    );

    expect(payload.revokedSessions).toBe(1);
    expect(db.query(`SELECT id FROM sessions WHERE user_id = ?`, merchant.userId)).toHaveLength(0);

    const entry = db.query<{ action: string }>('SELECT action FROM audit_logs ORDER BY created_at DESC')[0];
    expect(entry.action).toBe('ADMIN_SESSIONS_REVOKED');
  });
});

describe('POST /api/admin/accounts/:id/play-policy', () => {
  it('401s without an operator session', async () => {
    const response = await handleAdminRoute(
      jsonRequest(`/api/admin/accounts/${merchant.userId}/play-policy`, 'POST', { mode: 'once' }),
      env,
    );
    expect(response.status).toBe(401);
  });

  it('stores a once override on every business of the account and audits it', async () => {
    const payload = await body(
      await handleAdminRoute(
        operatorRequest(
          `/api/admin/accounts/${merchant.userId}/play-policy`,
          'POST',
          { mode: 'once' },
          operator.token,
        ),
        env,
      ),
    );

    expect(payload).toMatchObject({ success: true, playPolicy: { mode: 'once' }, updated: 1 });
    expect(
      db.query<{ play_policy: string | null }>('SELECT play_policy FROM businesses WHERE id = ?', merchant.businessId)[0]
        .play_policy,
    ).toBe('{"mode":"once"}');

    const entry = db.query<{ action: string; platform_operator_id: string | null; user_id: string | null }>(
      'SELECT action, platform_operator_id, user_id FROM audit_logs ORDER BY created_at DESC',
    )[0];
    expect(entry.action).toBe('ADMIN_PLAY_POLICY_UPDATED');
    expect(entry.platform_operator_id).toBe(operator.operatorId);
    expect(entry.user_id).toBeNull();
  });

  it('stores windowed limits and returns them on the account detail', async () => {
    await handleAdminRoute(
      operatorRequest(
        `/api/admin/accounts/${merchant.userId}/play-policy`,
        'POST',
        { mode: 'windowed', perDay: 5, cooldownMinutes: 30 },
        operator.token,
      ),
      env,
    );

    expect(
      db.query<{ play_policy: string }>('SELECT play_policy FROM businesses WHERE id = ?', merchant.businessId)[0]
        .play_policy,
    ).toBe('{"mode":"windowed","perDay":5,"cooldownMinutes":30}');

    const detail = await body(
      await handleAdminRoute(
        operatorRequest(`/api/admin/accounts/${merchant.userId}`, 'GET', undefined, operator.token),
        env,
      ),
    );
    expect(detail.playPolicy).toMatchObject({ mode: 'windowed', perDay: 5, cooldownMinutes: 30 });
    expect(detail.businesses[0].playPolicy).toMatchObject({ mode: 'windowed', perDay: 5, cooldownMinutes: 30 });
  });

  it('clears the override with off', async () => {
    await handleAdminRoute(
      operatorRequest(`/api/admin/accounts/${merchant.userId}/play-policy`, 'POST', { mode: 'once' }, operator.token),
      env,
    );
    const payload = await body(
      await handleAdminRoute(
        operatorRequest(`/api/admin/accounts/${merchant.userId}/play-policy`, 'POST', { mode: 'off' }, operator.token),
        env,
      ),
    );

    expect(payload).toMatchObject({ success: true, playPolicy: { mode: 'off' } });
    expect(
      db.query<{ play_policy: string | null }>('SELECT play_policy FROM businesses WHERE id = ?', merchant.businessId)[0]
        .play_policy,
    ).toBeNull();

    const detail = await body(
      await handleAdminRoute(
        operatorRequest(`/api/admin/accounts/${merchant.userId}`, 'GET', undefined, operator.token),
        env,
      ),
    );
    expect(detail.playPolicy).toMatchObject({ mode: 'off' });
  });

  it('updates every business of the account', async () => {
    const secondBusinessId = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO businesses (id, name, slug, timezone, created_at, updated_at)
       VALUES (?, 'Second Biz', ?, 'UTC', ?, ?)`,
    )
      .bind(secondBusinessId, `second-${secondBusinessId.slice(0, 8)}`, now, now)
      .run();
    db.prepare(
      `INSERT INTO business_members (id, business_id, user_id, role, created_at)
       VALUES (?, ?, ?, 'OWNER', ?)`,
    )
      .bind(crypto.randomUUID(), secondBusinessId, merchant.userId, now)
      .run();

    const payload = await body(
      await handleAdminRoute(
        operatorRequest(`/api/admin/accounts/${merchant.userId}/play-policy`, 'POST', { mode: 'once' }, operator.token),
        env,
      ),
    );

    expect(payload.updated).toBe(2);
    expect(
      db.query<{ n: number }>('SELECT COUNT(*) AS n FROM businesses WHERE play_policy IS NOT NULL')[0].n,
    ).toBe(2);
  });

  it('rejects out-of-range limits', async () => {
    const response = await handleAdminRoute(
      operatorRequest(
        `/api/admin/accounts/${merchant.userId}/play-policy`,
        'POST',
        { mode: 'windowed', perDay: 0, cooldownMinutes: -5 },
        operator.token,
      ),
      env,
    );
    expect(response.status).toBe(400);
    expect((await body(response)).error).toBe('Validation failed.');
  });

  it('404s for an unknown account', async () => {
    const response = await handleAdminRoute(
      operatorRequest('/api/admin/accounts/nope/play-policy', 'POST', { mode: 'once' }, operator.token),
      env,
    );
    expect(response.status).toBe(404);
  });
});

describe('DELETE /api/admin/accounts/:id', () => {
  it('removes the account and its personal data but keeps the businesses', async () => {
    const response = await handleAdminRoute(
      operatorRequest(
        `/api/admin/accounts/${merchant.userId}`,
        'DELETE',
        { reason: 'smoke test account' },
        operator.token,
      ),
      env,
    );

    expect(response.status).toBe(200);
    expect(await body(response)).toMatchObject({
      success: true,
      email: 'merchant@example.test',
      revokedSessions: 1,
      removedMemberships: 1,
    });

    expect(await countRows('SELECT COUNT(*) AS n FROM users WHERE id = ?', merchant.userId)).toBe(0);
    expect(await countRows('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?', merchant.userId)).toBe(0);
    expect(await countRows('SELECT COUNT(*) AS n FROM business_members WHERE user_id = ?', merchant.userId)).toBe(0);
    expect(await countRows('SELECT COUNT(*) AS n FROM businesses WHERE id = ?', merchant.businessId)).toBe(1);

    const entry = db.query<{ action: string; platform_operator_id: string; metadata: string }>(
      `SELECT action, platform_operator_id, metadata FROM audit_logs WHERE action = 'ADMIN_ACCOUNT_DELETED'`,
    )[0];
    expect(entry.action).toBe('ADMIN_ACCOUNT_DELETED');
    expect(entry.platform_operator_id).toBe(operator.operatorId);
    expect(JSON.parse(entry.metadata)).toMatchObject({ target: 'merchant@example.test', reason: 'smoke test account' });
  });

  it('404s for an unknown account', async () => {
    const response = await handleAdminRoute(
      operatorRequest('/api/admin/accounts/does-not-exist', 'DELETE', { reason: 'nope' }, operator.token),
      env,
    );
    expect(response.status).toBe(404);
  });

  it('requires a reason', async () => {
    const response = await handleAdminRoute(
      operatorRequest(`/api/admin/accounts/${merchant.userId}`, 'DELETE', { reason: '' }, operator.token),
      env,
    );
    expect(response.status).toBe(400);
    expect(await countRows('SELECT COUNT(*) AS n FROM users WHERE id = ?', merchant.userId)).toBe(1);
  });
});

describe('POST /api/admin/accounts/:id/wheel-theme', () => {
  const theme = {
    colors: { segments: ['#ff0000', '#00ff00'], rim: '#111111', pointer: '#222222' },
    motion: { preset: 'slow' },
    centerLogo: true,
  };

  async function applyTheme(payload: unknown) {
    return handleAdminRoute(
      operatorRequest(`/api/admin/accounts/${merchant.userId}/wheel-theme`, 'POST', payload, operator.token),
      env,
    );
  }

  it('applies the override to every business of the account and audits it', async () => {
    const now = new Date().toISOString();
    const secondBusinessId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO businesses (id, name, slug, timezone, created_at, updated_at)
       VALUES (?, 'Merchant Second Shop', ?, 'UTC', ?, ?)`,
    )
      .bind(secondBusinessId, `shop-${secondBusinessId.slice(0, 8)}`, now, now)
      .run();
    db.prepare(
      `INSERT INTO business_members (id, business_id, user_id, role, created_at)
       VALUES (?, ?, ?, 'OWNER', ?)`,
    )
      .bind(crypto.randomUUID(), secondBusinessId, merchant.userId, now)
      .run();

    const payload = await body(await applyTheme({ theme }));

    expect(payload).toMatchObject({ success: true, cleared: false, updatedBusinesses: 2 });
    expect(payload.wheelThemeOverride.motion.preset).toBe('slow');

    const rows = db.query<{ wheel_theme_override: string }>(
      'SELECT wheel_theme_override FROM businesses WHERE id IN (?, ?)',
      merchant.businessId,
      secondBusinessId,
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(JSON.parse(row.wheel_theme_override)).toMatchObject({ motion: { preset: 'slow' }, centerLogo: true });
    }

    const entry = db.query<{ action: string; platform_operator_id: string; metadata: string }>(
      `SELECT action, platform_operator_id, metadata FROM audit_logs WHERE action = 'ADMIN_WHEEL_THEME_UPDATED'`,
    )[0];
    expect(entry.platform_operator_id).toBe(operator.operatorId);
    expect(JSON.parse(entry.metadata)).toMatchObject({ target: 'merchant@example.test', clear: false, businesses: 2 });
  });

  it('clears the override so the merchant design applies again', async () => {
    await applyTheme({ theme });

    const payload = await body(await applyTheme({ clear: true }));

    expect(payload).toMatchObject({ success: true, cleared: true, wheelThemeOverride: null });
    expect(
      db.query<{ wheel_theme_override: string | null }>(
        'SELECT wheel_theme_override FROM businesses WHERE id = ?',
        merchant.businessId,
      )[0]!.wheel_theme_override,
    ).toBeNull();
  });

  it('rejects a malformed theme and an empty body', async () => {
    const badColor = await applyTheme({
      theme: {
        colors: { segments: ['red'], rim: '#111111', pointer: '#222222' },
        motion: { preset: 'slow' },
        centerLogo: false,
      },
    });
    expect(badColor.status).toBe(400);

    const empty = await applyTheme({});
    expect(empty.status).toBe(400);

    expect(
      db.query<{ wheel_theme_override: string | null }>(
        'SELECT wheel_theme_override FROM businesses WHERE id = ?',
        merchant.businessId,
      )[0]!.wheel_theme_override,
    ).toBeNull();
  });

  it('404s for an unknown account', async () => {
    const response = await handleAdminRoute(
      operatorRequest('/api/admin/accounts/nope/wheel-theme', 'POST', { clear: true }, operator.token),
      env,
    );
    expect(response.status).toBe(404);
  });

  it('reports the wheel fields on the account detail', async () => {
    const fresh = await seedMerchant(db, { email: 'wheel-detail@example.test', businessName: 'Wheel Detail Shop' });
    db.prepare(
      `INSERT INTO subscriptions (id, business_id, plan_id, status, current_period_end, created_at, updated_at)
       VALUES (?, ?, 'plan_scale', 'active', ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), fresh.businessId, new Date(Date.now() + 86_400_000).toISOString(), new Date().toISOString(), new Date().toISOString())
      .run();
    db.prepare('UPDATE businesses SET wheel_theme = ? WHERE id = ?')
      .bind(
        JSON.stringify({
          colors: { segments: ['#ff0000'], rim: '#111111', pointer: '#222222' },
          motion: { preset: 'fast' },
          centerLogo: false,
        }),
        fresh.businessId,
      )
      .run();

    const withDesign = await body(
      await handleAdminRoute(
        operatorRequest(`/api/admin/accounts/${fresh.userId}`, 'GET', undefined, operator.token),
        env,
      ),
    );
    expect(withDesign).toMatchObject({
      planSlug: 'scale',
      designAllowed: true,
      wheelTheme: { motion: { preset: 'fast' } },
      wheelThemeOverride: null,
    });
    expect(withDesign.businesses[0].planSlug).toBe('scale');

    // Pro keeps its saved theme but loses the design flag (hub logo only).
    db.prepare(
      `UPDATE subscriptions SET plan_id = 'plan_growth', updated_at = ? WHERE business_id = ?`,
    )
      .bind(new Date().toISOString(), fresh.businessId)
      .run();
    const pro = await body(
      await handleAdminRoute(
        operatorRequest(`/api/admin/accounts/${fresh.userId}`, 'GET', undefined, operator.token),
        env,
      ),
    );
    expect(pro).toMatchObject({
      planSlug: 'growth',
      designAllowed: false,
      wheelTheme: { motion: { preset: 'fast' } },
    });

    // No subscription at all: Starter rules, design gated off.
    const fresh2 = await seedMerchant(db, { email: 'wheel-starter@example.test', businessName: 'Starter Detail Shop' });
    const starter = await body(
      await handleAdminRoute(
        operatorRequest(`/api/admin/accounts/${fresh2.userId}`, 'GET', undefined, operator.token),
        env,
      ),
    );
    expect(starter).toMatchObject({ planSlug: 'starter', designAllowed: false, wheelTheme: null });
  });
});

describe('method handling', () => {
  it('405s a POST to the collection', async () => {
    const response = await handleAdminRoute(
      operatorRequest('/api/admin/accounts', 'POST', {}, operator.token),
      env,
    );
    expect(response.status).toBe(405);
  });
});
