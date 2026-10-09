import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../types';
import { handleSubscriptionRoute } from '../routes/subscriptions';
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

async function seedRequest(
  overrides: { status?: string; planId?: string; merchant?: SeededMerchant } = {},
): Promise<string> {
  const target = overrides.merchant ?? merchant;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO subscription_requests (id, business_id, user_id, plan_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, target.businessId, target.userId, overrides.planId ?? 'plan_growth', overrides.status ?? 'PENDING', now, now)
    .run();

  return id;
}

async function listStatus(requestId: string): Promise<string | null> {
  const row = db.prepare('SELECT status FROM subscription_requests WHERE id = ?').bind(requestId).first<{ status: string }>();
  return (await row)?.status ?? null;
}

async function countAudit(action: string): Promise<number> {
  const row = db.prepare('SELECT COUNT(*) AS n FROM audit_logs WHERE action = ?').bind(action).first<{ n: number }>();
  return (await row)?.n ?? 0;
}

beforeEach(async () => {
  const testEnv = createTestEnv();
  db = testEnv.DB;
  env = testEnv as unknown as Env;

  operator = await seedOperator(db);
  merchant = await seedMerchant(db, { email: 'merchant@example.test', businessName: 'Merchant Shop' });
});

afterEach(() => {
  db.close();
});

describe('operator authorization', () => {
  it('401s without a session cookie', async () => {
    const response = await handleSubscriptionRoute(jsonRequest('/api/admin/subscriptions', 'GET'), env);
    expect(response.status).toBe(401);
  });

  it('401s for a merchant bearer token', async () => {
    const response = await handleSubscriptionRoute(
      jsonRequest('/api/admin/subscriptions', 'GET', undefined, merchant.token),
      env,
    );
    expect(response.status).toBe(401);
    expect((await body(response)).error).toContain('Authentication required');
  });

  it('404s for unknown paths under the subscriptions mount', async () => {
    const response = await handleSubscriptionRoute(
      operatorRequest('/api/admin/subscriptions/nope', 'GET', undefined, operator.token),
      env,
    );
    expect(response.status).toBe(404);
  });
});

describe('GET /api/admin/subscriptions', () => {
  it('lists requests with merchant, business and plan details', async () => {
    await seedRequest();

    const payload = await body(
      await handleSubscriptionRoute(
        operatorRequest('/api/admin/subscriptions', 'GET', undefined, operator.token),
        env,
      ),
    );

    expect(payload.success).toBe(true);
    expect(payload.pagination.total).toBe(1);
    expect(payload.requests[0]).toMatchObject({
      status: 'PENDING',
      email: 'merchant@example.test',
      businessName: 'Merchant Shop',
      plan: { name: 'Pro', slug: 'growth' },
      priceCents: 34900,
    });
  });

  it('sorts pending requests first', async () => {
    const approved = await seedRequest({ status: 'APPROVED' });
    await seedRequest();

    const payload = await body(
      await handleSubscriptionRoute(
        operatorRequest('/api/admin/subscriptions', 'GET', undefined, operator.token),
        env,
      ),
    );

    expect(payload.requests.map((row: { id: string }) => row.id).indexOf(approved)).toBeGreaterThan(0);
  });

  it('filters by status', async () => {
    await seedRequest({ status: 'APPROVED' });
    await seedRequest();

    const payload = await body(
      await handleSubscriptionRoute(
        operatorRequest('/api/admin/subscriptions?status=APPROVED', 'GET', undefined, operator.token),
        env,
      ),
    );

    expect(payload.pagination.total).toBe(1);
    expect(payload.requests[0].status).toBe('APPROVED');
  });

  it('searches by email and business name', async () => {
    await seedRequest();

    const byEmail = await body(
      await handleSubscriptionRoute(
        operatorRequest('/api/admin/subscriptions?search=merchant%40example.test', 'GET', undefined, operator.token),
        env,
      ),
    );
    expect(byEmail.pagination.total).toBe(1);

    const byBusiness = await body(
      await handleSubscriptionRoute(
        operatorRequest('/api/admin/subscriptions?search=Merchant%20Shop', 'GET', undefined, operator.token),
        env,
      ),
    );
    expect(byBusiness.pagination.total).toBe(1);
  });
});

describe('POST /api/admin/subscriptions/requests/:id/approve', () => {
  it('activates the subscription for the chosen duration', async () => {
    const requestId = await seedRequest();

    const payload = await body(
      await handleSubscriptionRoute(
        operatorRequest(`/api/admin/subscriptions/requests/${requestId}/approve`, 'POST', { durationDays: 90 }, operator.token),
        env,
      ),
    );

    expect(payload.success).toBe(true);
    expect(payload.request.status).toBe('APPROVED');
    expect(payload.request.durationDays).toBe(90);

    const started = Date.now();
    const end = new Date(payload.currentPeriodEnd).getTime();
    expect(end - started).toBeGreaterThan(89 * 86_400_000);
    expect(end - started).toBeLessThan(91 * 86_400_000);

    const rows = (
      await db
        .prepare('SELECT status, plan_id, current_period_end FROM subscriptions WHERE business_id = ?')
        .bind(merchant.businessId)
        .all<{ status: string; plan_id: string }>()
    ).results ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('active');
    expect(rows[0].plan_id).toBe('plan_growth');
    expect(await listStatus(requestId)).toBe('APPROVED');
    expect(await countAudit('SUBSCRIPTION_ACTIVATED')).toBe(1);
  });

  it('extends an existing subscription instead of stacking rows', async () => {
    const requestId = await seedRequest();
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO subscriptions (id, business_id, plan_id, status, current_period_end, created_at, updated_at)
       VALUES (?, ?, 'plan_starter', 'active', ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), merchant.businessId, now, now, now)
      .run();

    await handleSubscriptionRoute(
      operatorRequest(`/api/admin/subscriptions/requests/${requestId}/approve`, 'POST', { durationDays: 365 }, operator.token),
      env,
    );

    const rows = (
      await db.prepare('SELECT plan_id FROM subscriptions WHERE business_id = ?').bind(merchant.businessId).all<{ plan_id: string }>()
    ).results ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0].plan_id).toBe('plan_growth');
  });

  it('activates a three-year subscription term', async () => {
    const requestId = await seedRequest();

    const response = await handleSubscriptionRoute(
      operatorRequest(`/api/admin/subscriptions/requests/${requestId}/approve`, 'POST', { durationDays: 1095 }, operator.token),
      env,
    );

    expect(response.status).toBe(200);
    expect((await body(response)).request.durationDays).toBe(1095);
  });

  it('rejects a duration outside the presets', async () => {
    const requestId = await seedRequest();

    const response = await handleSubscriptionRoute(
      operatorRequest(`/api/admin/subscriptions/requests/${requestId}/approve`, 'POST', { durationDays: 45 }, operator.token),
      env,
    );

    expect(response.status).toBe(400);
    expect(await listStatus(requestId)).toBe('PENDING');
  });

  it('404s for an unknown request', async () => {
    const response = await handleSubscriptionRoute(
      operatorRequest('/api/admin/subscriptions/requests/does-not-exist/approve', 'POST', { durationDays: 30 }, operator.token),
      env,
    );
    expect(response.status).toBe(404);
  });

  it('cannot approve a request twice', async () => {
    const requestId = await seedRequest();

    await handleSubscriptionRoute(
      operatorRequest(`/api/admin/subscriptions/requests/${requestId}/approve`, 'POST', { durationDays: 30 }, operator.token),
      env,
    );
    const second = await handleSubscriptionRoute(
      operatorRequest(`/api/admin/subscriptions/requests/${requestId}/approve`, 'POST', { durationDays: 90 }, operator.token),
      env,
    );

    expect(second.status).toBe(409);
    expect(await countAudit('SUBSCRIPTION_ACTIVATED')).toBe(1);
  });
});

describe('POST /api/admin/subscriptions/requests/:id/reject', () => {
  it('records the reason and the audit entry', async () => {
    const requestId = await seedRequest();

    const payload = await body(
      await handleSubscriptionRoute(
        operatorRequest(`/api/admin/subscriptions/requests/${requestId}/reject`, 'POST', { reason: 'Payment never received' }, operator.token),
        env,
      ),
    );

    expect(payload.success).toBe(true);
    expect(payload.request.status).toBe('REJECTED');
    expect(payload.request.rejectReason).toBe('Payment never received');
    expect(await listStatus(requestId)).toBe('REJECTED');
    expect(await countAudit('SUBSCRIPTION_REQUEST_REJECTED')).toBe(1);
  });

  it('requires a reason of at least 3 characters', async () => {
    const requestId = await seedRequest();

    const response = await handleSubscriptionRoute(
      operatorRequest(`/api/admin/subscriptions/requests/${requestId}/reject`, 'POST', { reason: 'no' }, operator.token),
      env,
    );

    expect(response.status).toBe(400);
    expect(await listStatus(requestId)).toBe('PENDING');
  });

  it('cannot reject a resolved request', async () => {
    const requestId = await seedRequest({ status: 'APPROVED' });

    const response = await handleSubscriptionRoute(
      operatorRequest(`/api/admin/subscriptions/requests/${requestId}/reject`, 'POST', { reason: 'Payment never received' }, operator.token),
      env,
    );

    expect(response.status).toBe(409);
  });
});
