import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../types';
import { handlePlanAdminRoute } from '../routes/plans';
import { createTestEnv, type TestDatabase } from '../../tests/helpers/d1';
import {
  jsonRequest,
  operatorRequest,
  seedMerchant,
  seedOperator,
  type SeededOperator,
} from '../../tests/helpers/fixtures';

let db: TestDatabase;
let env: Env;
let operator: SeededOperator;

type PlanPayload = {
  success?: boolean;
  error?: string;
  message?: string;
  plan?: {
    id: string;
    name: string;
    slug: string;
    priceCents: number;
    interval: string;
    active: boolean;
    features: { limits: Record<string, number>; features: string[] };
  };
  plans?: NonNullable<PlanPayload['plan']>[];
};

async function body(response: Response): Promise<PlanPayload> {
  return (await response.json()) as PlanPayload;
}

const CRITERIA = {
  limits: {
    campaigns: -1,
    customers: 500,
    whatsappMonthly: 50,
    whatsappBatch: 10,
    emailMonthly: 100,
    emailBatch: 25,
    wheelDesign: 1,
    wheelCenterLogo: 0,
  },
  features: ['Priority support', 'Custom branding'],
};

function createRequest(overrides: Record<string, unknown> = {}) {
  return operatorRequest(
    '/api/admin/plans',
    'POST',
    {
      name: 'Enterprise',
      slug: 'enterprise',
      priceCents: 49900,
      interval: 'year',
      features: CRITERIA,
      ...overrides,
    },
    operator.token,
  );
}

beforeEach(async () => {
  const testEnv = createTestEnv();
  db = testEnv.DB;
  env = testEnv as unknown as Env;
  operator = await seedOperator(db);
});

afterEach(() => {
  db.close();
});

describe('plan admin authorization', () => {
  it('401s the list without a session cookie', async () => {
    const response = await handlePlanAdminRoute(jsonRequest('/api/admin/plans', 'GET'), env);
    expect(response.status).toBe(401);
  });

  it('401s a create without a session cookie', async () => {
    const response = await handlePlanAdminRoute(
      operatorRequest(
        '/api/admin/plans',
        'POST',
        { name: 'Enterprise', slug: 'enterprise', priceCents: 49900, interval: 'year', features: CRITERIA },
        undefined,
      ),
      env,
    );
    expect(response.status).toBe(401);
    expect((await body(response)).error).toContain('Authentication required');
  });
});

describe('GET /api/admin/plans', () => {
  it('lists the seeded plans oldest price first with parsed criteria', async () => {
    const response = await handlePlanAdminRoute(
      operatorRequest('/api/admin/plans', 'GET', undefined, operator.token),
      env,
    );
    expect(response.status).toBe(200);

    const payload = await body(response);
    const plans = payload.plans ?? [];
    expect(plans.length).toBeGreaterThanOrEqual(4);
    expect(plans[0]?.slug).toBe('starter');
    expect(plans[0]?.active).toBe(true);

    // Legacy plans store no broadcast quota keys: they resolve from the slug
    // maps so the operator sees the effective criteria.
    const growth = plans.find((plan) => plan.slug === 'growth');
    expect(growth?.features.limits.customers).toBe(1000);
    expect(growth?.features.limits.whatsappMonthly).toBe(200);
    expect(growth?.features.limits.whatsappBatch).toBe(100);
    expect(growth?.features.limits.emailMonthly).toBe(1000);
    // Wheel criteria resolve from their own legacy maps too: design is
    // Business+, the hub logo Pro+.
    expect(growth?.features.limits.wheelDesign).toBe(0);
    expect(growth?.features.limits.wheelCenterLogo).toBe(1);
    expect(growth?.features.limits.wheelStepsColor).toBe(1);
    expect(plans.find((plan) => plan.slug === 'scale')?.features.limits.wheelDesign).toBe(1);

    const starter = plans.find((plan) => plan.slug === 'starter');
    expect(starter?.features.limits.whatsappMonthly).toBe(0);
    expect(starter?.features.limits.wheelCenterLogo).toBe(0);
    expect(starter?.features.limits.wheelStepsColor).toBe(0);
  });

  it('includes inactive plans so the operator can re-enable them', async () => {
    await handlePlanAdminRoute(
      operatorRequest(
        '/api/admin/plans/plan_premium',
        'PUT',
        { active: false },
        operator.token,
      ),
      env,
    );

    const response = await handlePlanAdminRoute(
      operatorRequest('/api/admin/plans', 'GET', undefined, operator.token),
      env,
    );
    const payload = await body(response);
    expect(payload.plans?.find((plan) => plan.slug === 'premium')?.active).toBe(false);
  });
});

describe('POST /api/admin/plans', () => {
  it('creates a plan and stores its criteria blob', async () => {
    const response = await handlePlanAdminRoute(createRequest(), env);
    expect(response.status).toBe(201);

    const payload = await body(response);
    expect(payload.plan?.name).toBe('Enterprise');
    expect(payload.plan?.slug).toBe('enterprise');
    expect(payload.plan?.priceCents).toBe(49900);
    expect(payload.plan?.active).toBe(true);
    expect(payload.plan?.features.limits).toMatchObject(CRITERIA.limits);

    const row = await db
      .prepare('SELECT features FROM plans WHERE id = ?')
      .bind(payload.plan?.id)
      .first<{ features: string }>();
    const stored = JSON.parse(row?.features ?? '{}') as { limits?: Record<string, number> };
    expect(stored.limits?.whatsappMonthly).toBe(50);
  });

  it('400s a malformed slug', async () => {
    const response = await handlePlanAdminRoute(createRequest({ slug: 'ENTERPRISE!' }), env);
    expect(response.status).toBe(400);
    expect((await body(response)).message).toContain('Validation failed');
  });

  it('400s an interval outside the supported presets', async () => {
    const response = await handlePlanAdminRoute(createRequest({ interval: 'month' }), env);
    expect(response.status).toBe(400);
  });

  it('409s a duplicate slug', async () => {
    const response = await handlePlanAdminRoute(createRequest({ slug: 'growth' }), env);
    expect(response.status).toBe(409);
    expect((await body(response)).error).toContain('slug already exists');
  });
});

describe('PUT /api/admin/plans/:id', () => {
  it('updates name, price and criteria', async () => {
    const response = await handlePlanAdminRoute(
      operatorRequest(
        '/api/admin/plans/plan_growth',
        'PUT',
        { name: 'Pro Max', priceCents: 39900, features: CRITERIA },
        operator.token,
      ),
      env,
    );
    expect(response.status).toBe(200);

    const payload = await body(response);
    expect(payload.plan?.name).toBe('Pro Max');
    expect(payload.plan?.priceCents).toBe(39900);
    expect(payload.plan?.features.limits.emailMonthly).toBe(100);

    const row = await db.prepare('SELECT name FROM plans WHERE id = ?').bind('plan_growth').first();
    expect(row).toBeTruthy();
  });

  it('404s an unknown plan', async () => {
    const response = await handlePlanAdminRoute(
      operatorRequest('/api/admin/plans/does-not-exist', 'PUT', { name: 'x' }, operator.token),
      env,
    );
    expect(response.status).toBe(404);
  });

  it('409s a slug owned by another plan', async () => {
    const response = await handlePlanAdminRoute(
      operatorRequest('/api/admin/plans/plan_starter', 'PUT', { slug: 'growth' }, operator.token),
      env,
    );
    expect(response.status).toBe(409);
  });

  it('400s an invalid criteria payload', async () => {
    const response = await handlePlanAdminRoute(
      operatorRequest(
        '/api/admin/plans/plan_starter',
        'PUT',
        { features: { limits: { campaigns: -5 }, features: [] } },
        operator.token,
      ),
      env,
    );
    expect(response.status).toBe(400);
  });
});

describe('DELETE /api/admin/plans/:id', () => {
  it('removes an unreferenced plan', async () => {
    const created = await body(await handlePlanAdminRoute(createRequest(), env));

    const response = await handlePlanAdminRoute(
      operatorRequest(`/api/admin/plans/${created.plan?.id}`, 'DELETE', undefined, operator.token),
      env,
    );
    expect(response.status).toBe(200);

    const row = await db.prepare('SELECT id FROM plans WHERE id = ?').bind(created.plan?.id).first();
    expect(row).toBeNull();
  });

  it('409s a plan a subscription still references', async () => {
    await seedMerchant(db, { withActiveSubscription: true, planId: 'plan_growth' });

    const response = await handlePlanAdminRoute(
      operatorRequest('/api/admin/plans/plan_growth', 'DELETE', undefined, operator.token),
      env,
    );
    expect(response.status).toBe(409);
    expect((await body(response)).error).toContain('deactivate');

    const row = await db.prepare('SELECT id FROM plans WHERE id = ?').bind('plan_growth').first();
    expect(row).toBeTruthy();
  });

  it('404s an unknown plan', async () => {
    const response = await handlePlanAdminRoute(
      operatorRequest('/api/admin/plans/does-not-exist', 'DELETE', undefined, operator.token),
      env,
    );
    expect(response.status).toBe(404);
  });
});

describe('method handling', () => {
  it('405s unsupported methods on the collection', async () => {
    const response = await handlePlanAdminRoute(
      operatorRequest('/api/admin/plans', 'PUT', { name: 'x' }, operator.token),
      env,
    );
    expect(response.status).toBe(405);
  });

  it('404s unknown paths', async () => {
    const response = await handlePlanAdminRoute(
      operatorRequest('/api/admin/plans/abc/edit', 'GET', undefined, operator.token),
      env,
    );
    expect(response.status).toBe(404);
  });
});
