import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../types';
import { handleBusinessRoute } from '../routes/business';
import { createTestEnv, type TestDatabase } from './helpers/d1';
import { bearer, jsonRequest, seedMerchant } from './helpers/fixtures';

let db: TestDatabase;
let env: Env;

beforeEach(() => {
  const testEnv = createTestEnv();
  db = testEnv.DB;
  env = testEnv as unknown as Env;
});

afterEach(() => {
  db.close();
});

describe('POST /api/business', () => {
  it('creates a business owned by the caller', async () => {
    const { userId, token } = await seedMerchant(db, { withBusiness: false });

    const response = await handleBusinessRoute(
      jsonRequest('/api/business', 'POST', { name: 'Coffee Corner' }, token),
      env,
    );

    expect(response.status).toBe(201);
    const payload = (await response.json()) as { success: boolean; business: { slug: string } };
    expect(payload.success).toBe(true);
    expect(payload.business.slug).toBe('coffee-corner');

    expect(db.query(`SELECT id FROM businesses`)).toHaveLength(1);
    expect(
      db.query<{ role: string }>(`SELECT role FROM business_members WHERE user_id = ?`, userId),
    ).toEqual([{ role: 'OWNER' }]);

    const campaigns = await handleBusinessRoute(
      jsonRequest('/api/business/campaigns', 'GET', undefined, token),
      env,
    );
    expect(campaigns.status).toBe(200);
  });

  it('seeds the channel switches from the platform-wide controls', async () => {
    const { token } = await seedMerchant(db, { withBusiness: false });
    db.prepare(
      `INSERT INTO platform_settings (key, value, updated_at) VALUES ('whatsapp_enabled', '0', ?)`,
    )
      .bind(new Date().toISOString())
      .run();

    const response = await handleBusinessRoute(
      jsonRequest('/api/business', 'POST', { name: 'Coffee Corner' }, token),
      env,
    );
    expect(response.status).toBe(201);

    const business = db.query<{ whatsapp_enabled: number; email_enabled: number; wheel_design_enabled: number }>(
      'SELECT whatsapp_enabled, email_enabled, wheel_design_enabled FROM businesses',
    )[0];
    // A missing platform row now defaults to off, so email stays disabled too.
    // Wheel design defaults to on (it has its own plan gate).
    expect(business).toMatchObject({ whatsapp_enabled: 0, email_enabled: 0, wheel_design_enabled: 1 });
  });

  it('seeds wheel design off when the platform switch is off', async () => {
    const { token } = await seedMerchant(db, { withBusiness: false });
    db.prepare(
      `INSERT INTO platform_settings (key, value, updated_at) VALUES ('wheel_design_enabled', '0', ?)`,
    )
      .bind(new Date().toISOString())
      .run();

    const response = await handleBusinessRoute(
      jsonRequest('/api/business', 'POST', { name: 'Coffee Corner' }, token),
      env,
    );
    expect(response.status).toBe(201);

    const business = db.query<{ wheel_design_enabled: number }>(
      'SELECT wheel_design_enabled FROM businesses',
    )[0];
    expect(business).toMatchObject({ wheel_design_enabled: 0 });
  });

  it('rejects an unauthenticated request', async () => {
    const response = await handleBusinessRoute(
      jsonRequest('/api/business', 'POST', { name: 'Coffee Corner' }),
      env,
    );

    expect(response.status).toBe(401);
    expect(db.query(`SELECT id FROM businesses`)).toHaveLength(0);
  });

  it('rejects a name that is too short', async () => {
    const { token } = await seedMerchant(db, { withBusiness: false });

    const response = await handleBusinessRoute(
      jsonRequest('/api/business', 'POST', { name: 'a' }, token),
      env,
    );

    expect(response.status).toBe(400);
    expect(db.query(`SELECT id FROM businesses`)).toHaveLength(0);
  });

  it('suffixes the slug when the friendly name already exists', async () => {
    const first = await seedMerchant(db, { withBusiness: false });
    const second = await seedMerchant(db, { withBusiness: false, email: 'other@example.test' });

    const created = await handleBusinessRoute(
      jsonRequest('/api/business', 'POST', { name: 'Coffee Corner' }, first.token),
      env,
    );
    expect(created.status).toBe(201);

    const response = await handleBusinessRoute(
      jsonRequest('/api/business', 'POST', { name: 'Coffee Corner' }, second.token),
      env,
    );

    expect(response.status).toBe(201);
    const payload = (await response.json()) as { business: { slug: string } };
    expect(payload.business.slug).not.toBe('coffee-corner');
    expect(payload.business.slug.startsWith('coffee-corner-')).toBe(true);
    expect(db.query(`SELECT id FROM businesses`)).toHaveLength(2);
  });
});

describe('POST /api/business list', () => {
  it('returns the businesses the caller belongs to', async () => {
    const { token } = await seedMerchant(db, { businessName: 'Seed Shop' });

    const response = await handleBusinessRoute(jsonRequest('/api/business', 'GET', undefined, token), env);

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { businesses: { name: string }[] };
    expect(payload.businesses.map((business) => business.name)).toEqual(['Seed Shop']);
  });
});

describe('bearer auth on the new endpoint', () => {
  it('does not accept a malformed token', async () => {
    const response = await handleBusinessRoute(
      jsonRequest('/api/business', 'POST', { name: 'Nope' }, 'cf_dead.beef'),
      env,
    );

    expect(response.status).toBe(401);
  });

  it('accepts a seeded merchant token', async () => {
    const { token } = await seedMerchant(db, { withBusiness: false });
    const response = await handleBusinessRoute(
      jsonRequest('/api/business', 'POST', { name: 'Fresh Shop' }, token),
      env,
    );

    expect(response.status).toBe(201);
    expect(bearer(token).authorization).toMatch(/^Bearer /);
  });
});

describe('rewards plan gate', () => {
  it('blocks Starter from listing rewards', async () => {
    const { token } = await seedMerchant(db, { withActiveSubscription: true, planId: 'plan_starter' });
    const response = await handleBusinessRoute(
      jsonRequest('/api/business/rewards', 'GET', undefined, token),
      env,
    );
    expect(response.status).toBe(403);
    expect(((await response.json()) as { message: string }).message).toContain('not included in your plan');
  });

  it('blocks Starter from patching a reward but still allows delete (shared with the wheel builder)', async () => {
    const { token, businessId } = await seedMerchant(db, { withActiveSubscription: true, planId: 'plan_starter' });
    const now = new Date().toISOString();
    const campaignId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO campaigns (id, business_id, name, public_code, status, created_at, updated_at)
       VALUES (?, ?, 'Wheel', 'CODE1', 'LIVE', ?, ?)`,
    ).bind(campaignId, businessId, now, now).run();
    const rewardId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO rewards (id, business_id, campaign_id, name, type, active, created_at, updated_at)
       VALUES (?, ?, ?, 'Coupon', 'coupon', 1, ?, ?)`,
    ).bind(rewardId, businessId, campaignId, now, now).run();

    const patch = await handleBusinessRoute(
      jsonRequest(`/api/business/rewards/${rewardId}`, 'PATCH', { quantity: 5 }, token),
      env,
    );
    expect(patch.status).toBe(403);

    // The wheel builder deletes persisted rewards, so DELETE stays open.
    const del = await handleBusinessRoute(
      jsonRequest(`/api/business/rewards/${rewardId}`, 'DELETE', undefined, token),
      env,
    );
    expect(del.status).toBe(200);
  });

  it('lets a Pro merchant list and patch rewards', async () => {
    const { token, businessId } = await seedMerchant(db, { withActiveSubscription: true, planId: 'plan_growth' });
    const now = new Date().toISOString();
    const campaignId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO campaigns (id, business_id, name, public_code, status, created_at, updated_at)
       VALUES (?, ?, 'Wheel', 'CODE1', 'LIVE', ?, ?)`,
    ).bind(campaignId, businessId, now, now).run();
    const rewardId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO rewards (id, business_id, campaign_id, name, type, active, created_at, updated_at)
       VALUES (?, ?, ?, 'Coupon', 'coupon', 1, ?, ?)`,
    ).bind(rewardId, businessId, campaignId, now, now).run();

    const list = await handleBusinessRoute(
      jsonRequest('/api/business/rewards', 'GET', undefined, token),
      env,
    );
    expect(list.status).toBe(200);
    const listPayload = (await list.json()) as { rewards: { id: string }[] };
    expect(listPayload.rewards.map((reward) => reward.id)).toContain(rewardId);

    const patch = await handleBusinessRoute(
      jsonRequest(`/api/business/rewards/${rewardId}`, 'PATCH', { quantity: 7 }, token),
      env,
    );
    expect(patch.status).toBe(200);
  });
});
