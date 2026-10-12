import { errorResponse, jsonResponse } from '../lib/http';
import { findCampaignForUser, getAuthenticatedUser, getBusinessIds, getPrimaryBusinessId } from '../lib/tenant';
import { getBusinessAccess } from '../lib/subscription-access';
import type { Env } from '../types';

/** D1 stores ISO-8601 strings, so a plain substring is a UTC calendar date. */
const DAY_BUCKETS = new Set([7, 30, 90]);

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseDayParam(raw: string | null): number {
  const parsed = Number(raw ?? '30');
  return DAY_BUCKETS.has(parsed) ? parsed : 30;
}

/**
 * Read-only dashboard queries run on a D1 session: read replication is
 * enabled on the database (mode auto, set via the D1 REST API), so these
 * reads can be served by replicas; before replicas are active the session
 * is a harmless pass-through to the primary. Writes never use sessions and
 * always go to the primary.
 */
function analyticsDb(env: Env): D1DatabaseSession {
  return env.DB.withSession('first-unconstrained');
}

async function handleTimeSeries(request: Request, env: Env, businessIds: string[]): Promise<Response> {
  const url = new URL(request.url);
  const days = parseDayParam(url.searchParams.get('days'));
  const since = isoDay(new Date(Date.now() - (days - 1) * 86_400_000));

  const byDay = new Map<string, Record<string, number>>();

  if (businessIds.length > 0) {
    const placeholders = businessIds.map(() => '?').join(', ');
    const rows = await analyticsDb(env).prepare(
      `SELECT substr(created_at, 1, 10) AS day, event_type, COUNT(*) AS count
       FROM analytics_events
       WHERE business_id IN (${placeholders}) AND created_at >= ?
       GROUP BY day, event_type
       ORDER BY day ASC`,
    )
      .bind(...businessIds, since)
      .all<{ day: string; event_type: string; count: number }>();

    for (const row of rows.results ?? []) {
      const bucket = byDay.get(row.day) ?? {};
      bucket[row.event_type] = (bucket[row.event_type] ?? 0) + Number(row.count);
      byDay.set(row.day, bucket);
    }

    // Wins are counted from the coupons table (one row per issued reward) —
    // the participate chain no longer writes a redundant REWARD_CLAIMED event
    // per win, which saved a D1 row-write on every winning spin.
    const couponRows = await analyticsDb(env).prepare(
      `SELECT substr(issued_at, 1, 10) AS day, COUNT(*) AS count
       FROM coupons
       WHERE business_id IN (${placeholders}) AND issued_at >= ?
       GROUP BY day`,
    )
      .bind(...businessIds, since)
      .all<{ day: string; count: number }>();

    for (const row of couponRows.results ?? []) {
      const bucket = byDay.get(row.day) ?? {};
      bucket.COUPON_ISSUED = (bucket.COUPON_ISSUED ?? 0) + Number(row.count);
      byDay.set(row.day, bucket);
    }
  }

  const series: Array<Record<string, unknown>> = [];
  const cursor = new Date(`${since}T00:00:00.000Z`);

  for (let index = 0; index < days; index += 1) {
    const key = isoDay(cursor);
    const counts = byDay.get(key) ?? {};
    series.push({
      day: key,
      participations: counts.PARTICIPATION ?? 0,
      // New wins come from coupons; historical REWARD_CLAIMED rows still
      // count until they age out of retention, so old windows stay stable.
      rewardsClaimed: (counts.COUPON_ISSUED ?? 0) + (counts.REWARD_CLAIMED ?? 0),
      couponsRedeemed: counts.COUPON_REDEEMED ?? 0,
      // `total` stays the participation count: wins are a subset of
      // participations (every win also writes one), so adding the coupon
      // bucket here would render a single winning spin as 2.
      total: counts.PARTICIPATION ?? 0,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return jsonResponse({ success: true, days, series });
}

async function handleFunnel(request: Request, env: Env, businessIds: string[]): Promise<Response> {
  const url = new URL(request.url);
  const days = parseDayParam(url.searchParams.get('days'));
  const since = new Date(Date.now() - (days - 1) * 86_400_000).toISOString();

  if (businessIds.length === 0) {
    return jsonResponse({
      success: true,
      days,
      stages: [
        { key: 'participations', label: 'Played', value: 0, rateFromPrevious: 100 },
        { key: 'rewardsClaimed', label: 'Reward earned', value: 0, rateFromPrevious: 0 },
        { key: 'couponsRedeemed', label: 'Coupon redeemed', value: 0, rateFromPrevious: 0 },
      ],
      conversion: {
        participations: 0,
        rewardsClaimed: 0,
        couponsRedeemed: 0,
        uniqueCustomers: 0,
        rewardRate: 0,
        redemptionRate: 0,
        overallRate: 0,
      },
    });
  }

  const placeholders = businessIds.map(() => '?').join(', ');
  const events = await analyticsDb(env).prepare(
    `SELECT event_type, COUNT(*) AS count
     FROM analytics_events
     WHERE business_id IN (${placeholders}) AND created_at >= ?
     GROUP BY event_type`,
  )
    .bind(...businessIds, since)
    .all<{ event_type: string; count: number }>();

  const counts: Record<string, number> = {};
  for (const row of events.results ?? []) {
    counts[row.event_type] = Number(row.count);
  }

  const uniqueCustomers = await analyticsDb(env).prepare(
    `SELECT COUNT(DISTINCT p.customer_id) AS total
     FROM participations p
     INNER JOIN campaigns c ON c.id = p.campaign_id
     WHERE c.business_id IN (${placeholders}) AND p.created_at >= ?`,
  )
    .bind(...businessIds, since)
    .first<{ total: number }>();

  // One coupon row per issued reward — the durable source of truth for wins
  // (participations include the no-win slice, so they cannot stand in).
  const issued = await analyticsDb(env).prepare(
    `SELECT COUNT(*) AS total FROM coupons
     WHERE business_id IN (${placeholders}) AND issued_at >= ?`,
  )
    .bind(...businessIds, since)
    .first<{ total: number }>();

  const participations = counts.PARTICIPATION ?? 0;
  const rewardsClaimed = Number(issued?.total ?? 0);
  const couponsRedeemed = counts.COUPON_REDEEMED ?? 0;

  const rate = (value: number, base: number): number =>
    base > 0 ? Math.round((value / base) * 1000) / 10 : 0;

  const stages = [
    { key: 'participations', label: 'Played', value: participations, rateFromPrevious: 100 },
    { key: 'rewardsClaimed', label: 'Reward earned', value: rewardsClaimed, rateFromPrevious: rate(rewardsClaimed, participations) },
    { key: 'couponsRedeemed', label: 'Coupon redeemed', value: couponsRedeemed, rateFromPrevious: rate(couponsRedeemed, rewardsClaimed) },
  ];

  return jsonResponse({
    success: true,
    days,
    stages,
    conversion: {
      participations,
      rewardsClaimed,
      couponsRedeemed,
      uniqueCustomers: Number(uniqueCustomers?.total ?? 0),
      rewardRate: rate(rewardsClaimed, participations),
      redemptionRate: rate(couponsRedeemed, rewardsClaimed),
      overallRate: rate(couponsRedeemed, participations),
    },
  });
}

async function handleRankings(request: Request, env: Env, businessIds: string[]): Promise<Response> {
  const url = new URL(request.url);
  const days = parseDayParam(url.searchParams.get('days'));
  const since = new Date(Date.now() - (days - 1) * 86_400_000).toISOString();

  if (businessIds.length === 0) {
    return jsonResponse({ success: true, days, campaigns: [], rewards: [] });
  }

  const placeholders = businessIds.map(() => '?').join(', ');

  const topCampaigns = await analyticsDb(env).prepare(
    `SELECT c.id, c.name, c.status,
            COUNT(p.id) AS participations,
            COUNT(DISTINCT p.customer_id) AS customers
     FROM campaigns c
     LEFT JOIN participations p ON p.campaign_id = c.id AND p.created_at >= ?
     WHERE c.business_id IN (${placeholders})
     GROUP BY c.id
     ORDER BY participations DESC, c.created_at DESC
     LIMIT 10`,
  )
    .bind(since, ...businessIds)
    .all<{ id: string; name: string; status: string; participations: number; customers: number }>();

  const topRewards = await analyticsDb(env).prepare(
    `SELECT r.id, r.name, r.type, r.value, COUNT(p.id) AS claims,
            (SELECT COUNT(*) FROM rewards rw WHERE rw.campaign_id = r.campaign_id) AS reward_count
     FROM rewards r
     LEFT JOIN participations p ON p.reward_id = r.id AND p.created_at >= ?
     WHERE r.business_id IN (${placeholders})
     GROUP BY r.id
     ORDER BY claims DESC, r.created_at DESC
     LIMIT 10`,
  )
    .bind(since, ...businessIds)
    .all<{ id: string; name: string; type: string; value: number; claims: number; reward_count: number }>();

  return jsonResponse({
    success: true,
    days,
    campaigns: (topCampaigns.results ?? []).map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      participations: Number(campaign.participations),
      customers: Number(campaign.customers),
    })),
    rewards: (topRewards.results ?? []).map((reward) => ({
      id: reward.id,
      name: reward.name,
      type: reward.type,
      value: Number(reward.value),
      claims: Number(reward.claims),
      campaignRewardCount: Number(reward.reward_count),
    })),
  });
}

export async function handleAnalyticsRoute(request: Request, env: Env): Promise<Response> {
  const user = await getAuthenticatedUser(request, env);

  if (!user) {
    return errorResponse('Authentication required.', 401);
  }

  const url = new URL(request.url);
  const businessIds = await getBusinessIds(user.id, env);

  if (businessIds.length > 0) {
    const businessId = await getPrimaryBusinessId(user.id, env);
    const access = businessId ? await getBusinessAccess(env, businessId) : null;
    const includesAnalytics = access?.plan.features.features.some((feature) => /analytics/i.test(feature)) ?? false;
    if (!access?.canManage || !includesAnalytics) {
      return errorResponse('Analytics are not included in the active plan.', 403);
    }
  }

  if (request.method === 'GET' && url.pathname === '/api/analytics/timeseries') {
    return await handleTimeSeries(request, env, businessIds);
  }

  if (request.method === 'GET' && url.pathname === '/api/analytics/funnel') {
    return await handleFunnel(request, env, businessIds);
  }

  if (request.method === 'GET' && url.pathname === '/api/analytics/rankings') {
    return await handleRankings(request, env, businessIds);
  }

  if (request.method === 'GET' && url.pathname === '/api/analytics/overview') {
    if (businessIds.length === 0) {
      return jsonResponse({
        success: true,
        totals: [],
        summary: { participations: 0, coupons: 0, customers: 0 },
      });
    }

    const placeholders = businessIds.map(() => '?').join(', ');
    const counts = await analyticsDb(env).prepare(
      `SELECT event_type, COUNT(*) AS count
       FROM analytics_events
       WHERE business_id IN (${placeholders})
       GROUP BY event_type
       ORDER BY event_type ASC`,
    )
      .bind(...businessIds)
      .all();

    const summary = await analyticsDb(env).prepare(
      `SELECT
         (SELECT COUNT(*) FROM participations p INNER JOIN campaigns c ON c.id = p.campaign_id
           WHERE c.business_id IN (${placeholders})) AS participations,
         (SELECT COUNT(*) FROM coupons cp WHERE cp.business_id IN (${placeholders})) AS coupons,
         (SELECT COUNT(*) FROM customers cu WHERE cu.business_id IN (${placeholders})) AS customers`,
    )
      .bind(...businessIds, ...businessIds, ...businessIds)
      .first();

    // Wins are no longer written as a REWARD_CLAIMED event (the coupon row
    // below is the source of truth), so derive that count from coupons to
    // keep the "Rewards won" card live instead of frozen at its pre-change
    // total. Every redeemed coupon was also issued, so `coupons` is an exact
    // stand-in for issued count.
    const rewardsIssued = Number(summary?.coupons ?? 0);
    const totals = (counts.results ?? []).filter((row) => row.event_type !== 'REWARD_CLAIMED');
    if (rewardsIssued > 0) {
      totals.push({ event_type: 'REWARD_CLAIMED', count: rewardsIssued });
    }
    totals.sort((a, b) => String(a.event_type).localeCompare(String(b.event_type)));

    return jsonResponse({
      success: true,
      totals,
      summary: summary ?? { participations: 0, coupons: 0, customers: 0 },
    });
  }

  if (request.method === 'GET' && url.pathname.startsWith('/api/analytics/campaigns/')) {
    const campaignId = url.pathname.slice('/api/analytics/campaigns/'.length);

    if (!campaignId || campaignId.includes('/')) {
      return errorResponse('Campaign id is required.', 400);
    }

    const campaign = await findCampaignForUser(campaignId, businessIds, env);

    if (!campaign) {
      return errorResponse('Campaign not found.', 404);
    }

    const placeholders = businessIds.map(() => '?').join(', ');
    const events = await analyticsDb(env).prepare(
      `SELECT id, event_type, event_data, created_at
       FROM analytics_events
       WHERE business_id IN (${placeholders}) AND campaign_id = ?
       ORDER BY created_at DESC
       LIMIT 50`,
    )
      .bind(...businessIds, campaign.id)
      .all();

    return jsonResponse({
      success: true,
      events: events.results ?? [],
    });
  }

  return errorResponse('Route not found.', 404);
}
