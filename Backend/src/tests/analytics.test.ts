import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../types';
import { handleAnalyticsRoute } from '../routes/analytics';
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

function seedEvent(businessId: string, campaignId: string, eventType: string) {
  db.prepare(
    `INSERT INTO analytics_events (id, business_id, campaign_id, event_type, event_data, created_at)
     VALUES (?, ?, ?, ?, '{}', ?)`,
  )
    .bind(crypto.randomUUID(), businessId, campaignId, eventType, new Date().toISOString())
    .run();
}

function seedCampaign(businessId: string): string {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO campaigns (id, business_id, name, public_code, status, created_at, updated_at)
     VALUES (?, ?, 'Owned', ?, 'ACTIVE', ?, ?)`,
  )
    .bind(id, businessId, crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase(), now, now)
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

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO customers (id, business_id, first_name, last_name, email, created_at, updated_at)
     VALUES (?, ?, 'Ada', 'Lovelace', 'ada@example.test', ?, ?)`,
  )
    .bind(crypto.randomUUID(), alice.businessId, now, now)
    .run();

  db.prepare(
    `INSERT INTO participations (id, campaign_id, customer_id, reward_id, result, created_at)
     VALUES (?, ?, ?, NULL, 'WON', ?)`,
  )
    .bind(crypto.randomUUID(), aliceCampaign, db.query<{ id: string }>(`SELECT id FROM customers`)[0]!.id, now)
    .run();

  seedEvent(alice.businessId, aliceCampaign, 'PARTICIPATION');
  seedEvent(alice.businessId, aliceCampaign, 'REWARD_CLAIMED');
  seedEvent(bob.businessId, bobCampaign, 'PARTICIPATION');
});

afterEach(() => {
  db.close();
});

describe('analytics authentication', () => {
  it('401s without a token', async () => {
    const response = await handleAnalyticsRoute(jsonRequest('/api/analytics/overview', 'GET'), env);
    expect(response.status).toBe(401);
  });

  it('401s with an unknown token', async () => {
    const response = await handleAnalyticsRoute(
      jsonRequest('/api/analytics/overview', 'GET', undefined, 'cf_deadbeef.deadbeef'),
      env,
    );
    expect(response.status).toBe(401);
  });
});

describe('GET /api/analytics/overview', () => {
  it('only counts events belonging to the caller businesses', async () => {
    const payload = await body(
      await handleAnalyticsRoute(jsonRequest('/api/analytics/overview', 'GET', undefined, alice.token), env),
    );

    expect(payload.success).toBe(true);
    expect(payload.totals).toEqual([
      { event_type: 'PARTICIPATION', count: 1 },
      { event_type: 'REWARD_CLAIMED', count: 1 },
    ]);
    expect(payload.summary).toMatchObject({ participations: 1, coupons: 0, customers: 1 });
  });

  it('returns an empty result for a user with no business', async () => {
    const stranger = await seedMerchant(db, { email: 'stranger@example.test', withBusiness: false });
    const payload = await body(
      await handleAnalyticsRoute(jsonRequest('/api/analytics/overview', 'GET', undefined, stranger.token), env),
    );

    expect(payload.totals).toEqual([]);
    expect(payload.summary).toEqual({ participations: 0, coupons: 0, customers: 0 });
  });
});

describe('GET /api/analytics/campaigns/:id', () => {
  it('returns events for a campaign the caller owns', async () => {
    const payload = await body(
      await handleAnalyticsRoute(
        jsonRequest(`/api/analytics/campaigns/${aliceCampaign}`, 'GET', undefined, alice.token),
        env,
      ),
    );

    expect(payload.events).toHaveLength(2);
    expect(payload.events.map((event: { event_type: string }) => event.event_type)).toEqual([
      'PARTICIPATION',
      'REWARD_CLAIMED',
    ]);
  });

  it('404s for a campaign owned by another business', async () => {
    const response = await handleAnalyticsRoute(
      jsonRequest(`/api/analytics/campaigns/${bobCampaign}`, 'GET', undefined, alice.token),
      env,
    );

    expect(response.status).toBe(404);
    expect(db.query(`SELECT id FROM analytics_events WHERE campaign_id = ?`, bobCampaign)).toHaveLength(1);
  });

  it('404s for an unknown campaign id', async () => {
    const response = await handleAnalyticsRoute(
      jsonRequest('/api/analytics/campaigns/does-not-exist', 'GET', undefined, alice.token),
      env,
    );
    expect(response.status).toBe(404);
  });

  it('400s when the campaign id segment is empty or nested', async () => {
    const response = await handleAnalyticsRoute(
      jsonRequest('/api/analytics/campaigns/', 'GET', undefined, alice.token),
      env,
    );
    expect(response.status).toBe(400);
  });
});
