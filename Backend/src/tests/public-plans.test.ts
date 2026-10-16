import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../types';
import { handlePublicPlansRoute } from '../routes/public-plans';
import { createTestEnv, type TestDatabase } from './helpers/d1';
import { jsonRequest } from './helpers/fixtures';

let db: TestDatabase;
let env: Env;

async function body(response: Response): Promise<{
  success?: boolean;
  plans?: { name: string; slug: string; priceCents: number; interval: string; features: string[] }[];
}> {
  return (await response.json()) as {
    success?: boolean;
    plans?: { name: string; slug: string; priceCents: number; interval: string; features: string[] }[];
  };
}

async function seedPlan(overrides: {
  id?: string;
  name: string;
  slug: string;
  priceCents: number;
  interval?: string;
  features?: unknown;
  active?: number;
}) {
  await db
    .prepare(
      `INSERT INTO plans (id, name, slug, price_cents, interval, features, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      overrides.id ?? crypto.randomUUID(),
      overrides.name,
      overrides.slug,
      overrides.priceCents,
      overrides.interval ?? '3_months',
      overrides.features === undefined ? null : JSON.stringify(overrides.features),
      overrides.active ?? 1,
      new Date().toISOString(),
    )
    .run();
}

beforeEach(async () => {
  const testEnv = createTestEnv();
  db = testEnv.DB;
  env = testEnv as unknown as Env;
  // The schema seeds the four catalog plans; start empty so each test controls
  // the full list.
  await db.prepare('DELETE FROM plans').run();
});

afterEach(() => {
  db.close();
});

describe('GET /api/public/plans', () => {
  it('lists active plans cheapest first with their feature bullets', async () => {
    await seedPlan({
      name: 'Pro',
      slug: 'growth',
      priceCents: 34900,
      interval: 'year',
      features: { limits: { campaigns: -1 }, features: ['Analytics', 'Priority support'] },
    });
    await seedPlan({
      name: 'Starter',
      slug: 'starter',
      priceCents: 14900,
      features: { limits: { campaigns: 3 }, features: ['Full wheel access'] },
    });

    const response = await handlePublicPlansRoute(jsonRequest('/api/public/plans', 'GET'), env);
    expect(response.status).toBe(200);
    const payload = await body(response);

    expect(payload.success).toBe(true);
    expect(payload.plans).toEqual([
      {
        name: 'Starter',
        slug: 'starter',
        priceCents: 14900,
        interval: '3_months',
        features: ['Full wheel access'],
      },
      {
        name: 'Pro',
        slug: 'growth',
        priceCents: 34900,
        interval: 'year',
        features: ['Analytics', 'Priority support'],
      },
    ]);
  });

  it('hides inactive plans so an operator can unpublish one', async () => {
    await seedPlan({ name: 'Starter', slug: 'starter', priceCents: 14900 });
    await seedPlan({ name: 'Retired', slug: 'retired', priceCents: 9900, active: 0 });

    const response = await handlePublicPlansRoute(jsonRequest('/api/public/plans', 'GET'), env);
    const payload = await body(response);

    expect(payload.plans?.map((plan) => plan.slug)).toEqual(['starter']);
  });

  it('never leaks the internal limits/entitlements blob', async () => {
    await seedPlan({
      name: 'Pro',
      slug: 'growth',
      priceCents: 34900,
      features: {
        limits: { campaigns: 50, customers: 1000, whatsappMonthly: 200 },
        features: ['Analytics'],
      },
    });

    const response = await handlePublicPlansRoute(jsonRequest('/api/public/plans', 'GET'), env);
    const raw = await response.text();

    expect(raw).not.toContain('limits');
    expect(raw).not.toContain('whatsappMonthly');
    expect(raw).toContain('Analytics');
  });

  it('keeps the plan visible with an empty bullet list when the features blob is malformed', async () => {
    await seedPlan({ name: 'Starter', slug: 'starter', priceCents: 14900 });
    await db
      .prepare(`UPDATE plans SET features = 'not-json' WHERE slug = 'starter'`)
      .run();

    const response = await handlePublicPlansRoute(jsonRequest('/api/public/plans', 'GET'), env);
    const payload = await body(response);

    expect(payload.plans).toEqual([
      { name: 'Starter', slug: 'starter', priceCents: 14900, interval: '3_months', features: [] },
    ]);
  });

  it('405s non-GET methods and 404s unknown paths', async () => {
    const post = await handlePublicPlansRoute(jsonRequest('/api/public/plans', 'POST'), env);
    expect(post.status).toBe(405);

    const missing = await handlePublicPlansRoute(jsonRequest('/api/public/plans/other', 'GET'), env);
    expect(missing.status).toBe(404);
  });
});
