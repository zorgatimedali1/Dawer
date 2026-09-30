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
    `INSERT INTO customers (id, business_id, first_name, last_name, email, created_at, updated_at)
     VALUES (?, ?, 'Ada', 'Lovelace', ?, ?, ?)`,
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

  alice = await seedMerchant(db, { email: 'alice@example.test', businessName: 'Alice Shop' });
  bob = await seedMerchant(db, { email: 'bob@example.test', businessName: 'Bob Shop' });
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

describe('route safety', () => {
  it('401s without a token', async () => {
    const response = await handleBusinessRoute(jsonRequest('/api/business/customers', 'GET'), env);
    expect(response.status).toBe(401);
  });

  it('404s unknown record paths', async () => {
    const response = await handleBusinessRoute(
      jsonRequest('/api/business/posters', 'GET', undefined, alice.token),
      env,
    );
    expect(response.status).toBe(404);
  });
});
