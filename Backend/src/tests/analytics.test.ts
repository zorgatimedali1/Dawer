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
    // A coupon row is the live source of truth for a win (no REWARD_CLAIMED
    // event is written anymore), so seed one to drive the derived rewards count.
    db.prepare(
      `INSERT INTO coupons (id, business_id, campaign_id, code, status, issued_at)
       VALUES (?, ?, ?, 'COUPON-OVERVIEW-ALICE', 'ISSUED', ?)`,
    )
      .bind(crypto.randomUUID(), alice.businessId, aliceCampaign, new Date().toISOString())
      .run();

    const payload = await body(
      await handleAnalyticsRoute(jsonRequest('/api/analytics/overview', 'GET', undefined, alice.token), env),
    );

    expect(payload.success).toBe(true);
    // REWARD_CLAIMED is derived from the coupons table (1 issued coupon), not
    // from a stored event — it no longer appears in analytics_events.
    expect(payload.totals).toEqual([
      { event_type: 'PARTICIPATION', count: 1 },
      { event_type: 'REWARD_CLAIMED', count: 1 },
    ]);
    expect(payload.summary).toMatchObject({ participations: 1, coupons: 1, customers: 1 });
  });

  it('returns an empty result for a user with no business', async () => {
    const stranger = await seedMerchant(db, { email: 'stranger@example.test', withBusiness: false });
    const payload = await body(
      await handleAnalyticsRoute(jsonRequest('/api/analytics/overview', 'GET', undefined, stranger.token), env),
    );

    expect(payload.totals).toEqual([]);
    expect(payload.summary).toEqual({ participations: 0, coupons: 0, redeemed: 0, customers: 0 });
  });

  it('reports issued and redeemed coupons as distinct numbers', async () => {
    const now = new Date().toISOString();
    const seedCoupon = (code: string, status: string) =>
      db
        .prepare(
          `INSERT INTO coupons (id, business_id, campaign_id, code, status, issued_at, redeemed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), alice.businessId, aliceCampaign, code, status, now, status === 'REDEEMED' ? now : null)
        .run();

    seedCoupon('CF-ISSUED000000001', 'ISSUED');
    seedCoupon('CF-REDEEM000000001', 'REDEEMED');
    // A voided prize must not read as delivered or redeemed.
    seedCoupon('CF-DELETED000000001', 'DELETED');

    const payload = await body(
      await handleAnalyticsRoute(jsonRequest('/api/analytics/overview', 'GET', undefined, alice.token), env),
    );

    expect(payload.summary).toMatchObject({ participations: 1, coupons: 2, redeemed: 1, customers: 1 });
    expect(payload.totals).toEqual([
      { event_type: 'PARTICIPATION', count: 1 },
      { event_type: 'REWARD_CLAIMED', count: 2 },
    ]);
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
    // Seed a coupon so the today bucket has a reward to report — wins are
    // counted from the coupons table now, not from a REWARD_CLAIMED event.
    db.prepare(
      `INSERT INTO coupons (id, business_id, campaign_id, code, status, issued_at)
       VALUES (?, ?, ?, 'COUPON-TIMESERIES-ALICE', 'ISSUED', ?)`,
    )
      .bind(crypto.randomUUID(), alice.businessId, aliceCampaign, new Date().toISOString())
      .run();

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

  it('counts a win once even when a legacy REWARD_CLAIMED event survives', async () => {
    // Events are kept for 400 days, so rows written before the participate
    // chain stopped emitting REWARD_CLAIMED are still around — they must not
    // stack on top of the coupons count.
    seedEvent(alice.businessId, aliceCampaign, 'REWARD_CLAIMED', 0);
    seedEvent(alice.businessId, aliceCampaign, 'QR_SCANNED', 0);
    db.prepare(
      `INSERT INTO coupons (id, business_id, campaign_id, code, status, issued_at)
       VALUES (?, ?, ?, 'COUPON-LEGACY0000001', 'ISSUED', ?)`,
    )
      .bind(crypto.randomUUID(), alice.businessId, aliceCampaign, new Date().toISOString())
      .run();

    const payload = await body(
      await handleAnalyticsRoute(
        jsonRequest('/api/analytics/timeseries?days=7', 'GET', undefined, alice.token),
        env,
      ),
    );

    const today = payload.series[payload.series.length - 1];
    expect(today.rewardsClaimed).toBe(1);
    expect(today.scans).toBe(1);
  });

  it('opens the same window as the funnel', async () => {
    // Exactly at the first bucket's midnight: the timeseries includes it, and
    // the funnel must agree rather than opening `now - (days-1)24h` instead.
    const since = new Date(Date.now() - 6 * 86_400_000);
    since.setUTCHours(0, 0, 0, 0);
    db.prepare(
      `INSERT INTO analytics_events (id, business_id, campaign_id, event_type, event_data, created_at)
       VALUES (?, ?, ?, 'PARTICIPATION', '{}', ?)`,
    )
      .bind(crypto.randomUUID(), alice.businessId, aliceCampaign, since.toISOString())
      .run();

    const series = await body(
      await handleAnalyticsRoute(jsonRequest('/api/analytics/timeseries?days=7', 'GET', undefined, alice.token), env),
    );
    const funnel = await body(
      await handleAnalyticsRoute(jsonRequest('/api/analytics/funnel?days=7', 'GET', undefined, alice.token), env),
    );

    const seriesTotal = (series.series as Array<{ participations: number }>).reduce(
      (sum, day) => sum + day.participations,
      0,
    );
    expect(seriesTotal).toBe(2);
    expect(funnel.conversion.participations).toBe(seriesTotal);
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

  it('honors arbitrary windows so the dashboard can double-fetch for deltas', async () => {
    for (const days of [14, 60, 180]) {
      const payload = await body(
        await handleAnalyticsRoute(
          jsonRequest(`/api/analytics/timeseries?days=${days}`, 'GET', undefined, alice.token),
          env,
        ),
      );
      expect(payload.days).toBe(days);
      expect(payload.series).toHaveLength(days);
    }
  });

  it('clamps out-of-range and non-numeric windows to the 30-day default', async () => {
    for (const raw of ['0', '-7', '366', 'abc']) {
      const payload = await body(
        await handleAnalyticsRoute(
          jsonRequest(`/api/analytics/timeseries?days=${raw}`, 'GET', undefined, alice.token),
          env,
        ),
      );
      expect(payload.days).toBe(30);
    }
  });

  it('excludes other tenants', async () => {
    const payload = await body(
      await handleAnalyticsRoute(
        jsonRequest('/api/analytics/timeseries?days=7', 'GET', undefined, alice.token),
        env,
      ),
    );
    // Only Alice's own participations count; Bob's are scoped out. `total` is
    // the participation count, so a winning spin counts once (not once per
    // participation and reward).
    const totals = payload.series.reduce(
      (sum: number, day: { total: number }) => sum + day.total,
      0,
    );
    expect(totals).toBe(1);
    expect(
      payload.series.reduce((sum: number, day: { participations: number }) => sum + day.participations, 0),
    ).toBe(1);
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
    // Two redemption events, one redeemed coupon: stage 3 reads the coupons
    // table, so only the one real redemption counts.
    for (let index = 0; index < 2; index += 1) {
      db.prepare(
        `INSERT INTO analytics_events (id, business_id, campaign_id, event_type, event_data, created_at)
         VALUES (?, ?, ?, 'COUPON_REDEEMED', '{}', ?)`,
      ).bind(crypto.randomUUID(), alice.businessId, aliceCampaign, new Date().toISOString()).run();
    }

    // Wins are counted from the coupons table — one issued row per reward —
    // not from a per-win analytics event.
    db.prepare(
      `INSERT INTO coupons (id, business_id, campaign_id, participation_id, reward_id, code, status, issued_at, redeemed_at)
       VALUES (?, ?, ?, NULL, NULL, 'CF-FUNNEL000000001', 'REDEEMED', ?, ?)`,
    )
      .bind(crypto.randomUUID(), alice.businessId, aliceCampaign, new Date().toISOString(), new Date().toISOString())
      .run();

    const payload = await body(
      await handleAnalyticsRoute(
        jsonRequest('/api/analytics/funnel?days=7', 'GET', undefined, alice.token),
        env,
      ),
    );

    expect(payload.stages).toHaveLength(3);
    expect(payload.stages[0]).toMatchObject({ key: 'participations', value: 1, rateFromPrevious: 100 });
    expect(payload.stages[1]).toMatchObject({ key: 'rewardsClaimed', value: 1, rateFromPrevious: 100 });
    expect(payload.stages[2]).toMatchObject({ key: 'couponsRedeemed', value: 1, rateFromPrevious: 100 });
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

  it('never lets redemptions of out-of-window coupons push a rate past 100%', async () => {
    const longAgo = new Date(Date.now() - 40 * 86_400_000).toISOString();
    // Redeemed outside the window (its event lands inside it), issued long ago.
    db.prepare(
      `INSERT INTO coupons (id, business_id, campaign_id, code, status, issued_at, redeemed_at)
       VALUES (?, ?, ?, 'CF-OLDREDEEM00001', 'REDEEMED', ?, ?)`,
    )
      .bind(crypto.randomUUID(), alice.businessId, aliceCampaign, longAgo, new Date().toISOString())
      .run();
    db.prepare(
      `INSERT INTO analytics_events (id, business_id, campaign_id, event_type, event_data, created_at)
       VALUES (?, ?, ?, 'COUPON_REDEEMED', '{}', ?)`,
    ).bind(crypto.randomUUID(), alice.businessId, aliceCampaign, new Date().toISOString()).run();

    // One reward issued inside the window, not redeemed yet.
    db.prepare(
      `INSERT INTO coupons (id, business_id, campaign_id, code, status, issued_at)
       VALUES (?, ?, ?, 'CF-NEWISSUED00001', 'ISSUED', ?)`,
    )
      .bind(crypto.randomUUID(), alice.businessId, aliceCampaign, new Date().toISOString())
      .run();

    const payload = await body(
      await handleAnalyticsRoute(
        jsonRequest('/api/analytics/funnel?days=7', 'GET', undefined, alice.token),
        env,
      ),
    );

    expect(payload.stages[1]).toMatchObject({ value: 1 });
    expect(payload.stages[2]).toMatchObject({ value: 0 });
    expect(payload.conversion).toMatchObject({ redemptionRate: 0, rewardRate: 100, overallRate: 0 });

    const values = (payload.stages as Array<{ value: number }>).map((stage) => stage.value);
    expect(values).toEqual([...values].sort((a, b) => b - a));
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

    // A spin writes a PARTICIPATION event with isWin/couponCode in event_data;
    // a win no longer adds a separate REWARD_CLAIMED row (the coupon row is
    // the source of truth for wins).
    expect(payload.events).toHaveLength(1);
    expect(payload.events.map((event: { event_type: string }) => event.event_type)).toEqual([
      'PARTICIPATION',
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

describe('analytics KV response cache', () => {
  // The route only stamps X-Cache on cacheable GETs; the drill-down and the
  // empty-tenant shortcuts deliberately stay uncached.
  function cacheHeader(response: Response): string | null {
    return response.headers.get('X-Cache');
  }

  function cacheKeys(): string[] {
    return (env.TOKENS as unknown as { keys(): string[] }).keys().filter((key) => key.startsWith('analytics:v1:'));
  }

  function cacheTtlOf(key: string): number | undefined {
    return (env.TOKENS as unknown as { ttlOf(key: string): number | undefined }).ttlOf(key);
  }

  it('serves the second identical request from cache without re-querying D1', async () => {
    const url = '/api/analytics/timeseries?days=30';

    const first = await handleAnalyticsRoute(jsonRequest(url, 'GET', undefined, alice.token), env);
    expect(cacheHeader(first)).toBe('MISS');
    const firstPayload = await body(first);
    expect(firstPayload.series).toHaveLength(30);

    // A write lands between the two reads: a cache HIT must still return the
    // first snapshot, which proves the second request never touched D1.
    seedEvent(alice.businessId, aliceCampaign, 'PARTICIPATION');

    const second = await handleAnalyticsRoute(jsonRequest(url, 'GET', undefined, alice.token), env);
    expect(cacheHeader(second)).toBe('HIT');
    const secondPayload = await body(second);
    expect(secondPayload).toEqual(firstPayload);
  });

  it('recomputes and re-arms the window on ?fresh=1', async () => {
    const url = '/api/analytics/timeseries?days=30';

    const first = await handleAnalyticsRoute(jsonRequest(url, 'GET', undefined, alice.token), env);
    expect(cacheHeader(first)).toBe('MISS');
    const firstPayload = await body(first);

    seedEvent(alice.businessId, aliceCampaign, 'PARTICIPATION');

    const fresh = await handleAnalyticsRoute(
      jsonRequest(`${url}&fresh=1`, 'GET', undefined, alice.token),
      env,
    );
    expect(cacheHeader(fresh)).toBe('MISS');
    // The recomputed snapshot picks up the event written after the first read.
    const freshPayload = await body(fresh);
    expect(freshPayload).not.toEqual(firstPayload);

    // fresh=1 re-armed the entry: the next plain request is a HIT on the new data.
    const third = await handleAnalyticsRoute(jsonRequest(url, 'GET', undefined, alice.token), env);
    expect(cacheHeader(third)).toBe('HIT');
    expect(await body(third)).toEqual(freshPayload);
  });

  it('keys each days window separately', async () => {
    const seven = await handleAnalyticsRoute(
      jsonRequest('/api/analytics/timeseries?days=7', 'GET', undefined, alice.token),
      env,
    );
    expect(cacheHeader(seven)).toBe('MISS');

    const thirty = await handleAnalyticsRoute(
      jsonRequest('/api/analytics/timeseries?days=30', 'GET', undefined, alice.token),
      env,
    );
    expect(cacheHeader(thirty)).toBe('MISS');

    const sevenAgain = await handleAnalyticsRoute(
      jsonRequest('/api/analytics/timeseries?days=7', 'GET', undefined, alice.token),
      env,
    );
    expect(cacheHeader(sevenAgain)).toBe('HIT');
    expect((await body(sevenAgain)).series).toHaveLength(7);
  });

  it('applies the tiered TTL: 1h for short windows, 3h for longer ones', async () => {
    await handleAnalyticsRoute(
      jsonRequest('/api/analytics/timeseries?days=7', 'GET', undefined, alice.token),
      env,
    );
    await handleAnalyticsRoute(
      jsonRequest('/api/analytics/timeseries?days=30', 'GET', undefined, alice.token),
      env,
    );

    const keys = cacheKeys();
    const shortKey = keys.find((key) => key.endsWith(':timeseries:7'));
    const longKey = keys.find((key) => key.endsWith(':timeseries:30'));
    expect(shortKey).toBeDefined();
    expect(longKey).toBeDefined();
    expect(cacheTtlOf(shortKey!)).toBe(3_600);
    expect(cacheTtlOf(longKey!)).toBe(10_800);
  });

  it('caches every aggregation endpoint under its own key', async () => {
    for (const path of ['/api/analytics/funnel', '/api/analytics/rankings', '/api/analytics/overview']) {
      const first = await handleAnalyticsRoute(jsonRequest(path, 'GET', undefined, alice.token), env);
      expect(cacheHeader(first), path).toBe('MISS');
      const second = await handleAnalyticsRoute(jsonRequest(path, 'GET', undefined, alice.token), env);
      expect(cacheHeader(second), path).toBe('HIT');
    }
  });

  it('never serves one tenant the cache entry of another', async () => {
    // Give Alice a second event so the two tenants' payloads cannot coincide;
    // if Bob were served Alice's entry the counts would match exactly.
    seedEvent(alice.businessId, aliceCampaign, 'PARTICIPATION');

    const url = '/api/analytics/timeseries?days=30';
    const aliceResponse = await handleAnalyticsRoute(jsonRequest(url, 'GET', undefined, alice.token), env);
    const alicePayload = await body(aliceResponse);
    const aliceParticipations = alicePayload.series.reduce(
      (sum: number, point: { participations: number }) => sum + point.participations,
      0,
    );
    expect(aliceParticipations).toBe(2);

    const bobResponse = await handleAnalyticsRoute(jsonRequest(url, 'GET', undefined, bob.token), env);
    // Bob's miss computes his own data instead of reading Alice's entry.
    expect(cacheHeader(bobResponse)).toBe('MISS');
    const bobPayload = await body(bobResponse);
    const bobParticipations = bobPayload.series.reduce(
      (sum: number, point: { participations: number }) => sum + point.participations,
      0,
    );
    expect(bobParticipations).toBe(1);
  });

  it('leaves the campaign drill-down uncached so investigations stay live', async () => {
    const url = `/api/analytics/campaigns/${aliceCampaign}`;
    const first = await handleAnalyticsRoute(jsonRequest(url, 'GET', undefined, alice.token), env);
    expect(cacheHeader(first)).toBeNull();
    const second = await handleAnalyticsRoute(jsonRequest(url, 'GET', undefined, alice.token), env);
    expect(cacheHeader(second)).toBeNull();
    expect(cacheKeys()).toHaveLength(0);
  });

  it('skips the cache for users with no business', async () => {
    const stranger = await seedMerchant(db, { email: 'stranger-cache@example.test', withBusiness: false });
    const response = await handleAnalyticsRoute(
      jsonRequest('/api/analytics/timeseries?days=30', 'GET', undefined, stranger.token),
      env,
    );
    expect(cacheHeader(response)).toBeNull();
    expect(cacheKeys()).toHaveLength(0);
  });
});
