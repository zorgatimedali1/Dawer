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

function seedEvent(businessId: string, campaignId: string, eventType: string, ageMs = 0) {
  db.prepare(
    `INSERT INTO analytics_events (id, business_id, campaign_id, event_type, event_data, created_at)
     VALUES (?, ?, ?, ?, '{}', ?)`,
  )
    .bind(crypto.randomUUID(), businessId, campaignId, eventType, new Date(Date.now() - ageMs).toISOString())
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

  alice = await seedMerchant(db, { email: 'alice@example.test', businessName: 'Alice Shop', withActiveSubscription: true, planId: 'plan_growth' });
  bob = await seedMerchant(db, { email: 'bob@example.test', businessName: 'Bob Shop', withActiveSubscription: true, planId: 'plan_growth' });
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

  // Distinct ages so `ORDER BY created_at DESC` has a defined order.
  seedEvent(alice.businessId, aliceCampaign, 'PARTICIPATION', 1_000);
  seedEvent(alice.businessId, aliceCampaign, 'REWARD_CLAIMED', 2_000);
  seedEvent(bob.businessId, bobCampaign, 'PARTICIPATION', 3_000);
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

describe('GET /api/analytics/timeseries', () => {
    it('blocks analytics for a paid Starter plan without an analytics entitlement', async () => {
      const starter = await seedMerchant(db, {
        email: 'starter-analytics@example.test',
        businessName: 'Starter Shop',
        withActiveSubscription: true,
        planId: 'plan_starter',
      });

      const response = await handleAnalyticsRoute(
        jsonRequest('/api/analytics/timeseries?range=7', 'GET', undefined, starter.token),
        env,
      );

      expect(response.status).toBe(403);
      expect((await body(response)).message).toContain('not included');

      const overview = await handleAnalyticsRoute(
        jsonRequest('/api/analytics/overview', 'GET', undefined, starter.token),
        env,
      );
      expect(overview.status).toBe(403);
    });

  it('fills every day bucket for the requested window', async () => {
    const payload = await body(
      await handleAnalyticsRoute(
        jsonRequest('/api/analytics/timeseries?days=7', 'GET', undefined, alice.token),
        env,
      ),
    );

    expect(payload.success).toBe(true);
    expect(payload.days).toBe(7);
    expect(payload.series).toHaveLength(7);

    const today = payload.series[payload.series.length - 1];
    expect(today.participations).toBe(1);
    expect(today.rewardsClaimed).toBe(1);
    expect(today.couponsRedeemed).toBe(0);
    expect(payload.series.slice(0, 6).every((day: { total: number }) => day.total === 0)).toBe(true);
  });

  it('defaults to 30 days for an unknown window', async () => {
    const payload = await body(
      await handleAnalyticsRoute(
        jsonRequest('/api/analytics/timeseries?days=999', 'GET', undefined, alice.token),
        env,
      ),
    );
    expect(payload.days).toBe(30);
    expect(payload.series).toHaveLength(30);
  });

  it('excludes other tenants', async () => {
    const payload = await body(
      await handleAnalyticsRoute(
        jsonRequest('/api/analytics/timeseries?days=7', 'GET', undefined, alice.token),
        env,
      ),
    );
    const totals = payload.series.reduce(
      (sum: number, day: { total: number }) => sum + day.total,
      0,
    );
    expect(totals).toBe(2);
  });

  it('returns zero-filled buckets for a user with no business', async () => {
    const stranger = await seedMerchant(db, { email: 'no-biz@example.test', withBusiness: false });
    const payload = await body(
      await handleAnalyticsRoute(
        jsonRequest('/api/analytics/timeseries?days=7', 'GET', undefined, stranger.token),
        env,
      ),
    );
    expect(payload.series).toHaveLength(7);
    expect(payload.series.every((day: { total: number }) => day.total === 0)).toBe(true);
  });
});

describe('GET /api/analytics/funnel', () => {
  it('reports stage counts and conversion rates', async () => {
    db.prepare(
      `INSERT INTO analytics_events (id, business_id, campaign_id, event_type, event_data, created_at)
       VALUES (?, ?, ?, 'COUPON_REDEEMED', '{}', ?)`,
    ).bind(crypto.randomUUID(), alice.businessId, aliceCampaign, new Date().toISOString()).run();

    const payload = await body(
      await handleAnalyticsRoute(
        jsonRequest('/api/analytics/funnel?days=7', 'GET', undefined, alice.token),
        env,
      ),
    );

    expect(payload.stages).toHaveLength(3);
    expect(payload.stages[0]).toMatchObject({ key: 'participations', value: 1, rateFromPrevious: 100 });
    expect(payload.stages[1]).toMatchObject({ key: 'rewardsClaimed', value: 1, rateFromPrevious: 100 });
    expect(payload.stages[2]).toMatchObject({ key: 'couponsRedeemed', value: 1 });
    expect(payload.conversion).toMatchObject({
      participations: 1,
      rewardsClaimed: 1,
      couponsRedeemed: 1,
      uniqueCustomers: 1,
      rewardRate: 100,
      redemptionRate: 100,
      overallRate: 100,
    });
  });

  it('reports zero rates instead of dividing by zero', async () => {
    const stranger = await seedMerchant(db, { email: 'empty@example.test', withBusiness: false });
    const payload = await body(
      await handleAnalyticsRoute(
        jsonRequest('/api/analytics/funnel', 'GET', undefined, stranger.token),
        env,
      ),
    );
    expect(payload.conversion).toMatchObject({ rewardRate: 0, redemptionRate: 0, overallRate: 0 });
  });
});

describe('GET /api/analytics/rankings', () => {
  it('ranks campaigns and rewards by activity', async () => {
    const rewardId = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO rewards (id, business_id, campaign_id, name, type, value, created_at, updated_at)
       VALUES (?, ?, ?, 'Free coffee', 'discount', '100', ?, ?)`,
    )
      .bind(rewardId, alice.businessId, aliceCampaign, now, now)
      .run();

    db.prepare(
      `UPDATE participations SET reward_id = ? WHERE campaign_id = ?`,
    ).bind(rewardId, aliceCampaign).run();

    const payload = await body(
      await handleAnalyticsRoute(
        jsonRequest('/api/analytics/rankings?days=30', 'GET', undefined, alice.token),
        env,
      ),
    );

    expect(payload.campaigns[0]).toMatchObject({ id: aliceCampaign, participations: 1, customers: 1 });
    expect(payload.rewards[0]).toMatchObject({ id: rewardId, claims: 1, value: 100 });
  });

  it('excludes another tenant campaign', async () => {
    const payload = await body(
      await handleAnalyticsRoute(
        jsonRequest('/api/analytics/rankings?days=30', 'GET', undefined, alice.token),
        env,
      ),
    );
    expect(payload.campaigns.map((row: { id: string }) => row.id)).not.toContain(bobCampaign);
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
