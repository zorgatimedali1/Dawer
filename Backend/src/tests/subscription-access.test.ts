import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../types';
import { getBusinessAccess } from '../lib/subscription-access';
import { createTestEnv, type TestDatabase } from './helpers/d1';
import { seedMerchant } from './helpers/fixtures';

let db: TestDatabase;
let env: Env;
let businessId: string;

beforeEach(async () => {
  const testEnv = createTestEnv();
  db = testEnv.DB;
  env = testEnv as unknown as Env;
  businessId = (await seedMerchant(db)).businessId;
});

afterEach(() => db.close());

async function seedSubscription(input: {
  planId?: string;
  status: string;
  endAt: string | null;
}) {
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO subscriptions (id, business_id, plan_id, status, current_period_end, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), businessId, input.planId ?? 'plan_starter', input.status, input.endAt, now, now)
    .run();
}

describe('effective business plan access', () => {
  it('keeps businesses with no subscription in read-only default Starter access', async () => {
    const access = await getBusinessAccess(env, businessId);

    expect(access).toMatchObject({ state: 'none', canManage: false, plan: { slug: 'starter' } });
  });

  it('keeps an unexpired Starter trial read-only', async () => {
    await seedSubscription({
      status: 'trialing',
      endAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    });

    const access = await getBusinessAccess(env, businessId);

    expect(access).toMatchObject({ state: 'trial', canManage: false, plan: { slug: 'starter' } });
  });

  it('unlocks plan features for an unexpired paid Pro subscription', async () => {
    await seedSubscription({
      planId: 'plan_growth',
      status: 'active',
      endAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });

    const access = await getBusinessAccess(env, businessId);

    expect(access.canManage).toBe(true);
    expect(access.state).toBe('active');
    expect(access.plan.slug).toBe('growth');
    expect(access.plan.features.features).toContain('Vue d’ensemble et analytics de base');
  });

  it('locks an expired trial and an expired paid subscription', async () => {
    await seedSubscription({ status: 'trialing', endAt: new Date(Date.now() - 86_400_000).toISOString() });
    expect(await getBusinessAccess(env, businessId)).toMatchObject({ state: 'expired', canManage: false });

    await db.prepare('DELETE FROM subscriptions WHERE business_id = ?').bind(businessId).run();
    await seedSubscription({
      planId: 'plan_growth',
      status: 'active',
      endAt: new Date(Date.now() - 86_400_000).toISOString(),
    });
    expect(await getBusinessAccess(env, businessId)).toMatchObject({ state: 'expired', canManage: false });
  });
});