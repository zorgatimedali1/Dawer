import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../types';
import { handleBusinessRoute } from '../routes/business';
import { createTestEnv, type TestDatabase } from './helpers/d1';
import { jsonRequest, seedMerchant, type SeededMerchant } from './helpers/fixtures';

let db: TestDatabase;
let env: Env;
let alice: SeededMerchant;
let bob: SeededMerchant;
let aliceCampaign: string;
let bobCampaign: string;

async function body(response: Response) {
  return (await response.json()) as Record<string, any>;
}

function seedCampaign(businessId: string): string {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO campaigns (id, business_id, name, public_code, status, created_at, updated_at)
     VALUES (?, ?, 'Owned campaign', ?, 'ACTIVE', ?, ?)`,
  )
    .bind(id, businessId, crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase(), now, now)
    .run();

  return id;
}

function seedCustomer(businessId: string, email: string): string {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO customers (id, business_id, first_name, last_name, email, phone, created_at, updated_at)
     VALUES (?, ?, 'Ada', 'Lovelace', ?, '+21622111222', ?, ?)`,
  )
    .bind(id, businessId, email, now, now)
    .run();

  return id;
}

function seedReward(businessId: string, campaignId: string): string {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO rewards (id, business_id, campaign_id, name, type, quantity, quantity_initial, weight, active, created_at, updated_at)
     VALUES (?, ?, ?, 'Free coffee', 'free_product', 5, 10, 50, 1, ?, ?)`,
  )
    .bind(id, businessId, campaignId, now, now)
    .run();

  return id;
}

function seedCoupon(businessId: string, campaignId: string, customerId: string, rewardId: string): string {
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO coupons (id, business_id, campaign_id, customer_id, reward_id, code, status, issued_at)
     VALUES (?, ?, ?, ?, ?, ?, 'ISSUED', ?)`,
  )
    .bind(id, businessId, campaignId, customerId, rewardId, `CODE${id.slice(0, 8).toUpperCase()}`, new Date().toISOString())
    .run();

  return id;
}

beforeEach(async () => {
  const testEnv = createTestEnv();
  db = testEnv.DB;
  env = testEnv as unknown as Env;

  alice = await seedMerchant(db, { email: 'alice@example.test', businessName: 'Alice Shop', withActiveSubscription: true, planId: 'plan_growth' });
  bob = await seedMerchant(db, { email: 'bob@example.test', businessName: 'Bob Shop', withActiveSubscription: true, planId: 'plan_growth' });
  aliceCampaign = seedCampaign(alice.businessId);
  bobCampaign = seedCampaign(bob.businessId);
});

afterEach(() => {
  db.close();
});

describe('GET /api/business/campaigns/:id', () => {
  it('returns the campaign with counts and rewards', async () => {
    const rewardId = seedReward(alice.businessId, aliceCampaign);
    const customerId = seedCustomer(alice.businessId, 'x@example.test');
    seedCoupon(alice.businessId, aliceCampaign, customerId, rewardId);

    const response = await handleBusinessRoute(
      jsonRequest(`/api/business/campaigns/${aliceCampaign}`, 'GET', undefined, alice.token),
      env,
    );
    expect(response.status).toBe(200);

    const payload = await body(response);
    expect(payload.campaign).toMatchObject({ id: aliceCampaign, reward_count: 1, redemption_count: 1 });
    expect(payload.campaign.rewards).toHaveLength(1);
    expect(payload.campaign.rewards[0].id).toBe(rewardId);
  });

  it('404s for a campaign owned by another business', async () => {
    const response = await handleBusinessRoute(
      jsonRequest(`/api/business/campaigns/${bobCampaign}`, 'GET', undefined, alice.token),
      env,
    );
    expect(response.status).toBe(404);
  });
});

describe('GET /api/business/customers', () => {
  it('only lists the callers own customers and supports search', async () => {
    seedCustomer(alice.businessId, 'alice-customer@example.test');
    seedCustomer(bob.businessId, 'bob-customer@example.test');
    const anonymousId = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO customers (id, business_id, first_name, phone, created_at, updated_at)
       VALUES (?, ?, '', '', ?, ?)`,
    )
      .bind(anonymousId, alice.businessId, now, now)
      .run();

    const all = await body(
      await handleBusinessRoute(jsonRequest('/api/business/customers', 'GET', undefined, alice.token), env),
    );
    expect(all.total).toBe(1);
    expect(all.customers[0].email).toBe('alice-customer@example.test');
    expect(all.customers[0]).toHaveProperty('participation_count');

    const search = await body(
      await handleBusinessRoute(
        jsonRequest('/api/business/customers?search=bob-customer', 'GET', undefined, alice.token),
        env,
      ),
    );
    expect(search.total).toBe(0);
  });

  it('includes campaign and reward names in a customer prize history', async () => {
    const customerId = seedCustomer(alice.businessId, 'prize-owner@example.test');
    const rewardId = seedReward(alice.businessId, aliceCampaign);
    seedCoupon(alice.businessId, aliceCampaign, customerId, rewardId);

    const response = await handleBusinessRoute(
      jsonRequest(`/api/business/customers/${customerId}`, 'GET', undefined, alice.token),
      env,
    );
    const payload = await body(response);

    expect(response.status).toBe(200);
    expect(payload.coupons[0]).toMatchObject({
      reward_name: 'Free coffee',
      campaign_name: 'Owned campaign',
    });
  });

  it('404s on a customer detail owned by someone else', async () => {
    const foreignId = seedCustomer(bob.businessId, 'bob-only@example.test');

    const response = await handleBusinessRoute(
      jsonRequest(`/api/business/customers/${foreignId}`, 'GET', undefined, alice.token),
      env,
    );
    expect(response.status).toBe(404);
  });
});

describe('GET /api/business/coupons and redeem', () => {
  it('lists coupons with campaign, reward and customer context', async () => {
    const rewardId = seedReward(alice.businessId, aliceCampaign);
    const customerId = seedCustomer(alice.businessId, 'c@example.test');
    seedCoupon(alice.businessId, aliceCampaign, customerId, rewardId);
    seedCoupon(bob.businessId, bobCampaign, seedCustomer(bob.businessId, 'other@example.test'), rewardId);

    const payload = await body(
      await handleBusinessRoute(jsonRequest('/api/business/coupons', 'GET', undefined, alice.token), env),
    );

    expect(payload.total).toBe(1);
    expect(payload.coupons[0]).toMatchObject({ status: 'ISSUED', campaign_name: 'Owned campaign' });
    expect(payload.coupons[0].reward_name).toBe('Free coffee');
  });

  it('redeems once and refuses the second attempt', async () => {
    const rewardId = seedReward(alice.businessId, aliceCampaign);
    const customerId = seedCustomer(alice.businessId, 'c@example.test');
    const couponId = seedCoupon(alice.businessId, aliceCampaign, customerId, rewardId);

    const first = await handleBusinessRoute(
      jsonRequest(`/api/business/coupons/${couponId}/redeem`, 'POST', {}, alice.token),
      env,
    );
    expect(first.status).toBe(200);
    expect((await body(first)).coupon).toMatchObject({ status: 'REDEEMED' });

    const second = await handleBusinessRoute(
      jsonRequest(`/api/business/coupons/${couponId}/redeem`, 'POST', {}, alice.token),
      env,
    );
    expect(second.status).toBe(409);
  });

  it('records exactly one redemption when two clicks race', async () => {
    const rewardId = seedReward(alice.businessId, aliceCampaign);
    const customerId = seedCustomer(alice.businessId, 'c@example.test');
    const couponId = seedCoupon(alice.businessId, aliceCampaign, customerId, rewardId);

    const redeem = () =>
      handleBusinessRoute(
        jsonRequest(`/api/business/coupons/${couponId}/redeem`, 'POST', {}, alice.token),
        env,
      );

    const statuses = (await Promise.all([redeem(), redeem()])).map((response) => response.status).sort();

    expect(statuses).toEqual([200, 409]);
    expect(db.query(`SELECT status FROM coupons WHERE id = ?`, couponId)).toEqual([{ status: 'REDEEMED' }]);
    expect(
      db.query(`SELECT id FROM analytics_events WHERE event_type = 'COUPON_REDEEMED'`),
    ).toHaveLength(1);
  });

  it('404s when redeeming a coupon belonging to another business', async () => {
    const foreignCoupon = seedCoupon(
      bob.businessId,
      bobCampaign,
      seedCustomer(bob.businessId, 'b@example.test'),
      seedReward(bob.businessId, bobCampaign),
    );

    const response = await handleBusinessRoute(
      jsonRequest(`/api/business/coupons/${foreignCoupon}/redeem`, 'POST', {}, alice.token),
      env,
    );
    expect(response.status).toBe(404);
  });

  it('lets a merchant update whether a prize is given and extend its deadline', async () => {
    const rewardId = seedReward(alice.businessId, aliceCampaign);
    const customerId = seedCustomer(alice.businessId, 'manage@example.test');
    const couponId = seedCoupon(alice.businessId, aliceCampaign, customerId, rewardId);
    const expiresAt = new Date(Date.now() + 30 * 86400_000).toISOString();

    const extended = await handleBusinessRoute(
      jsonRequest(`/api/business/coupons/${couponId}`, 'PATCH', { expiresAt }, alice.token),
      env,
    );
    expect(extended.status).toBe(200);
    expect((await body(extended)).coupon.expires_at).toBe(expiresAt);

    const given = await handleBusinessRoute(
      jsonRequest(`/api/business/coupons/${couponId}`, 'PATCH', { status: 'REDEEMED' }, alice.token),
      env,
    );
    expect((await body(given)).coupon.status).toBe('REDEEMED');

    const stillOwed = await handleBusinessRoute(
      jsonRequest(`/api/business/coupons/${couponId}`, 'PATCH', { status: 'ISSUED' }, alice.token),
      env,
    );
    expect((await body(stillOwed)).coupon).toMatchObject({ status: 'ISSUED', redeemed_at: null });
  });

  it('rejects a deadline in the past and prevents updates to another business coupon', async () => {
    const foreignCoupon = seedCoupon(
      bob.businessId,
      bobCampaign,
      seedCustomer(bob.businessId, 'b@example.test'),
      seedReward(bob.businessId, bobCampaign),
    );

    const foreignUpdate = await handleBusinessRoute(
      jsonRequest(`/api/business/coupons/${foreignCoupon}`, 'PATCH', { status: 'REDEEMED' }, alice.token),
      env,
    );
    expect(foreignUpdate.status).toBe(404);

    const ownCoupon = seedCoupon(
      alice.businessId,
      aliceCampaign,
      seedCustomer(alice.businessId, 'a@example.test'),
      seedReward(alice.businessId, aliceCampaign),
    );
    const pastDeadline = await handleBusinessRoute(
      jsonRequest(`/api/business/coupons/${ownCoupon}`, 'PATCH', { expiresAt: '2020-01-01T00:00:00.000Z' }, alice.token),
      env,
    );
    expect(pastDeadline.status).toBe(400);
  });

  it('deletes a given prize from customer and coupon listings while retaining its row', async () => {
    const rewardId = seedReward(alice.businessId, aliceCampaign);
    const customerId = seedCustomer(alice.businessId, 'given-prize@example.test');
    const couponId = seedCoupon(alice.businessId, aliceCampaign, customerId, rewardId);

    await handleBusinessRoute(
      jsonRequest(`/api/business/coupons/${couponId}`, 'PATCH', { status: 'REDEEMED' }, alice.token),
      env,
    );
    const deleted = await handleBusinessRoute(
      jsonRequest(`/api/business/coupons/${couponId}`, 'DELETE', undefined, alice.token),
      env,
    );

    expect(deleted.status).toBe(200);
    expect(db.query(`SELECT status FROM coupons WHERE id = ?`, couponId)).toEqual([{ status: 'DELETED' }]);

    const customer = await body(
      await handleBusinessRoute(
        jsonRequest(`/api/business/customers/${customerId}`, 'GET', undefined, alice.token),
        env,
      ),
    );
    const coupons = await body(
      await handleBusinessRoute(jsonRequest('/api/business/coupons', 'GET', undefined, alice.token), env),
    );
    expect(customer.coupons).toHaveLength(0);
    expect(coupons.total).toBe(0);
  });

  it('refuses to delete an owed prize and hides coupons owned by another business', async () => {
    const rewardId = seedReward(alice.businessId, aliceCampaign);
    const issuedId = seedCoupon(alice.businessId, aliceCampaign, seedCustomer(alice.businessId, 'owed@example.test'), rewardId);
    const owed = await handleBusinessRoute(
      jsonRequest(`/api/business/coupons/${issuedId}`, 'DELETE', undefined, alice.token),
      env,
    );
    expect(owed.status).toBe(409);

    const foreignId = seedCoupon(
      bob.businessId,
      bobCampaign,
      seedCustomer(bob.businessId, 'foreign-prize@example.test'),
      seedReward(bob.businessId, bobCampaign),
    );
    const foreign = await handleBusinessRoute(
      jsonRequest(`/api/business/coupons/${foreignId}`, 'DELETE', undefined, alice.token),
      env,
    );
    expect(foreign.status).toBe(404);
  });
});

describe('GET /api/business/rewards', () => {
  it('lists rewards across campaigns, scoped to the caller', async () => {
    seedReward(alice.businessId, aliceCampaign);
    seedReward(bob.businessId, bobCampaign);

    const payload = await body(
      await handleBusinessRoute(jsonRequest('/api/business/rewards', 'GET', undefined, alice.token), env),
    );

    expect(payload.rewards).toHaveLength(1);
    expect(payload.rewards[0]).toMatchObject({ name: 'Free coffee', campaign_name: 'Owned campaign', issued_count: 0 });
  });

  it('patches reward stock and rejects a foreign reward', async () => {
    const rewardId = seedReward(alice.businessId, aliceCampaign);

    const updated = await handleBusinessRoute(
      jsonRequest(`/api/business/rewards/${rewardId}`, 'PATCH', { quantity: 3, active: false }, alice.token),
      env,
    );
    expect(updated.status).toBe(200);
    expect((await body(updated)).reward).toMatchObject({ quantity: 3, active: 0 });

    const foreign = seedReward(bob.businessId, bobCampaign);
    const response = await handleBusinessRoute(
      jsonRequest(`/api/business/rewards/${foreign}`, 'PATCH', { quantity: 1 }, alice.token),
      env,
    );
    expect(response.status).toBe(404);
  });

  it('400s on an empty patch body', async () => {
    const rewardId = seedReward(alice.businessId, aliceCampaign);
    const response = await handleBusinessRoute(
      jsonRequest(`/api/business/rewards/${rewardId}`, 'PATCH', {}, alice.token),
      env,
    );
    expect(response.status).toBe(400);
  });

  it('deletes a reward immediately and 404s foreign or unknown ids', async () => {
    const rewardId = seedReward(alice.businessId, aliceCampaign);

    const deleted = await handleBusinessRoute(
      jsonRequest(`/api/business/rewards/${rewardId}`, 'DELETE', undefined, alice.token),
      env,
    );
    expect(deleted.status).toBe(200);
    expect((await body(deleted)).id).toBe(rewardId);

    expect(db.query<{ id: string }>(`SELECT id FROM rewards WHERE id = ?`, rewardId)).toHaveLength(0);

    const list = await body(
      await handleBusinessRoute(jsonRequest('/api/business/rewards', 'GET', undefined, alice.token), env),
    );
    expect(list.rewards).toHaveLength(0);

    expect(
      db.query<{ id: string }>(`SELECT id FROM audit_logs WHERE action = 'reward.deleted' AND entity_id = ?`, rewardId),
    ).toHaveLength(1);

    const foreign = seedReward(bob.businessId, bobCampaign);
    const denied = await handleBusinessRoute(
      jsonRequest(`/api/business/rewards/${foreign}`, 'DELETE', undefined, alice.token),
      env,
    );
    expect(denied.status).toBe(404);
    expect(db.query<{ id: string }>(`SELECT id FROM rewards WHERE id = ?`, foreign)).toHaveLength(1);

    const missing = await handleBusinessRoute(
      jsonRequest('/api/business/rewards/does-not-exist', 'DELETE', undefined, alice.token),
      env,
    );
    expect(missing.status).toBe(404);
  });
});

describe('QR codes', () => {
  it('creates and lists QR codes for an owned campaign', async () => {
    const created = await handleBusinessRoute(
      jsonRequest('/api/business/qr-codes', 'POST', { campaignId: aliceCampaign, name: 'Counter', location: 'Till' }, alice.token),
      env,
    );
    expect(created.status).toBe(201);
    const qrCode = (await body(created)).qrCode;
    expect(qrCode.public_code).toMatch(/^[0-9A-F]{16}$/);

    const list = await body(
      await handleBusinessRoute(jsonRequest('/api/business/qr-codes', 'GET', undefined, alice.token), env),
    );
    expect(list.qrCodes).toHaveLength(1);
    expect(list.qrCodes[0]).toMatchObject({ name: 'Counter', active: 1, campaign_name: 'Owned campaign' });
  });

  it('refuses to create a QR code on a foreign campaign', async () => {
    const response = await handleBusinessRoute(
      jsonRequest('/api/business/qr-codes', 'POST', { campaignId: bobCampaign, name: 'Nope' }, alice.token),
      env,
    );
    expect(response.status).toBe(404);
  });

  it('deactivates a QR code and 404s on a foreign one', async () => {
    const created = await handleBusinessRoute(
      jsonRequest('/api/business/qr-codes', 'POST', { campaignId: aliceCampaign, name: 'Window' }, alice.token),
      env,
    );
    const qrId = (await body(created)).qrCode.id;

    const patched = await handleBusinessRoute(
      jsonRequest(`/api/business/qr-codes/${qrId}`, 'PATCH', { active: false }, alice.token),
      env,
    );
    expect(patched.status).toBe(200);
    expect((await body(patched)).qrCode).toMatchObject({ active: 0 });
  });
});

describe('Posters', () => {
  it('creates and lists posters for an owned campaign', async () => {
    const created = await handleBusinessRoute(
      jsonRequest(
        '/api/business/posters',
        'POST',
        { campaignId: aliceCampaign, template: 'gradient', title: 'Win big', subtitle: 'Scan me', theme: '#4f46e5' },
        alice.token,
      ),
      env,
    );
    expect(created.status).toBe(201);
    const poster = (await body(created)).poster;
    expect(poster).toMatchObject({ title: 'Win big', campaign_name: 'Owned campaign' });

    const list = await body(
      await handleBusinessRoute(jsonRequest('/api/business/posters', 'GET', undefined, alice.token), env),
    );
    expect(list.posters).toHaveLength(1);
    expect(list.posters[0].template).toBe('gradient');
  });

  it('refuses to create a poster on a foreign campaign', async () => {
    const response = await handleBusinessRoute(
      jsonRequest('/api/business/posters', 'POST', { campaignId: bobCampaign, title: 'Nope' }, alice.token),
      env,
    );
    expect(response.status).toBe(404);
  });

  it('updates a poster and 404s on a foreign one', async () => {
    const created = await handleBusinessRoute(
      jsonRequest('/api/business/posters', 'POST', { campaignId: aliceCampaign, title: 'Before' }, alice.token),
      env,
    );
    const posterId = (await body(created)).poster.id;

    const patched = await handleBusinessRoute(
      jsonRequest(`/api/business/posters/${posterId}`, 'PATCH', { title: 'After', theme: '#10b981' }, alice.token),
      env,
    );
    expect(patched.status).toBe(200);
    expect((await body(patched)).poster).toMatchObject({ title: 'After', theme: '#10b981' });

    const foreign = await handleBusinessRoute(
      jsonRequest('/api/business/posters', 'POST', { campaignId: bobCampaign, title: 'Bob' }, bob.token),
      env,
    );
    const foreignId = (await body(foreign)).poster.id;

    const denied = await handleBusinessRoute(
      jsonRequest(`/api/business/posters/${foreignId}`, 'PATCH', { title: 'Hacked' }, alice.token),
      env,
    );
    expect(denied.status).toBe(404);
  });

  it('400s on an empty patch body', async () => {
    const created = await handleBusinessRoute(
      jsonRequest('/api/business/posters', 'POST', { campaignId: aliceCampaign }, alice.token),
      env,
    );
    const posterId = (await body(created)).poster.id;

    const response = await handleBusinessRoute(
      jsonRequest(`/api/business/posters/${posterId}`, 'PATCH', {}, alice.token),
      env,
    );
    expect(response.status).toBe(400);
  });
});

describe('route safety', () => {
  it('401s without a token', async () => {
    const response = await handleBusinessRoute(jsonRequest('/api/business/customers', 'GET'), env);
    expect(response.status).toBe(401);
  });

  it('404s unknown record paths', async () => {
    const response = await handleBusinessRoute(
      jsonRequest('/api/business/unknown', 'GET', undefined, alice.token),
      env,
    );
    expect(response.status).toBe(404);
  });
});
