import { errorResponse, jsonResponse } from '../../lib/http';
import { renderRouteError, requireOperator } from '../lib/guard';
import type { Env } from '../../types';

const STATS_PATH = '/api/admin/stats';

/** Plan billing intervals → months, used to normalize revenue to a monthly figure. */
const INTERVAL_MONTHS: Record<string, number> = {
  month: 1,
  '3_months': 3,
  year: 12,
  '2_years': 24,
  '3_years': 36,
};

function intervalMonths(interval: string): number {
  return INTERVAL_MONTHS[interval] ?? 1;
}

function monthsParam(url: URL, fallback: number): number {
  const raw = Number(url.searchParams.get('months'));
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(24, Math.max(1, Math.trunc(raw)));
}

function daysParam(url: URL, fallback: number): number {
  const raw = Number(url.searchParams.get('days'));
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(365, Math.max(1, Math.trunc(raw)));
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/** Zero-filled `YYYY-MM` buckets going back `months` (inclusive of the current month). */
function monthBuckets(months: number): string[] {
  const buckets: string[] = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i -= 1) {
    buckets.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
  }
  return buckets;
}

/** Zero-filled `YYYY-MM-DD` buckets going back `days` (inclusive of today). */
function dayBuckets(days: number): string[] {
  const buckets: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    buckets.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  }
  return buckets;
}

/** Zero-fills missing buckets so the chart renders a continuous axis. */
function fillSeries<T extends { bucket: string }>(buckets: string[], rows: T[], empty: Omit<T, 'bucket'>): T[] {
  const byBucket = new Map(rows.map((row) => [row.bucket, row]));
  return buckets.map((bucket) => ({ ...empty, ...(byBucket.get(bucket) ?? { bucket }) }) as T);
}

async function scalar(env: Env, sql: string, ...binds: string[]): Promise<number> {
  const row = await env.DB.prepare(sql).bind(...binds).first<{ total: number | null }>();
  return Number(row?.total ?? 0);
}

/**
 * Headline KPIs: revenue (collected from approved subscription requests —
 * payments settle offline over WhatsApp), pipeline, accounts, activity.
 */
async function overview(env: Env): Promise<Response> {
  const now = new Date();
  const thisMonth = monthKey(now);
  const lastMonth = monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
  const thirtyDaysAgo = isoDaysAgo(30);

  const [
    totalUsers,
    activeUsers,
    suspendedUsers,
    newUsers30d,
    totalBusinesses,
    totalCampaigns,
    totalCustomers,
    participations,
    activeSubscriptions,
    collectedAllTime,
    collectedThisMonth,
    collectedLastMonth,
    pendingPipeline,
    activePlanRows,
    topPlansRows,
  ] = await Promise.all([
    scalar(env, 'SELECT COUNT(*) AS total FROM users'),
    scalar(env, 'SELECT COUNT(DISTINCT user_id) AS total FROM sessions WHERE expires_at > ?', new Date().toISOString()),
    scalar(env, `SELECT COUNT(*) AS total FROM users WHERE status = 'SUSPENDED'`),
    scalar(env, 'SELECT COUNT(*) AS total FROM users WHERE created_at >= ?', thirtyDaysAgo),
    scalar(env, 'SELECT COUNT(*) AS total FROM businesses'),
    scalar(env, 'SELECT COUNT(*) AS total FROM campaigns'),
    scalar(env, 'SELECT COUNT(*) AS total FROM customers'),
    scalar(env, 'SELECT COUNT(*) AS total FROM participations'),
    scalar(env, `SELECT COUNT(*) AS total FROM subscriptions WHERE status = 'active' AND (current_period_end IS NULL OR current_period_end > ?)`, new Date().toISOString()),
    scalar(env, `SELECT COALESCE(SUM(p.price_cents), 0) AS total FROM subscription_requests r JOIN plans p ON p.id = r.plan_id WHERE r.status = 'APPROVED'`),
    scalar(env, `SELECT COALESCE(SUM(p.price_cents), 0) AS total FROM subscription_requests r JOIN plans p ON p.id = r.plan_id WHERE r.status = 'APPROVED' AND substr(r.resolved_at, 1, 7) = ?`, thisMonth),
    scalar(env, `SELECT COALESCE(SUM(p.price_cents), 0) AS total FROM subscription_requests r JOIN plans p ON p.id = r.plan_id WHERE r.status = 'APPROVED' AND substr(r.resolved_at, 1, 7) = ?`, lastMonth),
    scalar(env, `SELECT COALESCE(SUM(p.price_cents), 0) AS total FROM subscription_requests r JOIN plans p ON p.id = r.plan_id WHERE r.status = 'PENDING'`),
    env.DB.prepare(
      `SELECT p.id AS plan_id, p.name, p.slug, p.price_cents, p.interval, COUNT(*) AS subs
       FROM subscriptions s JOIN plans p ON p.id = s.plan_id
       WHERE s.status = 'active' AND (s.current_period_end IS NULL OR s.current_period_end > ?)
       GROUP BY p.id`,
    ).bind(new Date().toISOString()).all<{ plan_id: string; name: string; slug: string; price_cents: number; interval: string; subs: number }>(),
    env.DB.prepare(
      `SELECT p.name, p.slug, COUNT(*) AS subs
       FROM subscription_requests r JOIN plans p ON p.id = r.plan_id
       WHERE r.status = 'APPROVED' AND substr(r.resolved_at, 1, 7) = ?
       GROUP BY p.id ORDER BY subs DESC LIMIT 5`,
    ).bind(thisMonth).all<{ name: string; slug: string; subs: number }>(),
  ]);

  // Normalized monthly recurring value: each active plan contributes its price
  // spread across its own interval (3-year plan → /36).
  const monthlyRecurring = (activePlanRows.results ?? []).reduce(
    (sum, row) => sum + (Number(row.price_cents) / intervalMonths(row.interval)) * Number(row.subs),
    0,
  );

  const growthPct = collectedLastMonth > 0
    ? Math.round(((collectedThisMonth - collectedLastMonth) / collectedLastMonth) * 100)
    : collectedThisMonth > 0 ? 100 : 0;

  return jsonResponse({
    success: true,
    overview: {
      revenue: {
        collectedAllTimeCents: collectedAllTime,
        collectedThisMonthCents: collectedThisMonth,
        collectedLastMonthCents: collectedLastMonth,
        growthPercent: growthPct,
        monthlyRecurringCents: Math.round(monthlyRecurring),
        pipelineCents: pendingPipeline,
        currency: 'TND',
      },
      accounts: {
        totalUsers,
        activeUsers,
        suspendedUsers,
        newUsers30d,
        totalBusinesses,
      },
      activity: {
        totalCampaigns,
        totalCustomers,
        participations,
      },
      subscriptions: {
        active: activeSubscriptions,
        topPlans: topPlansRows.results ?? [],
      },
    },
  });
}

/** Monthly collected revenue + approvals, zero-filled for the chart. */
async function revenue(env: Env, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const months = monthsParam(url, 12);

  const rows = await env.DB.prepare(
    `SELECT substr(r.resolved_at, 1, 7) AS bucket,
            COALESCE(SUM(p.price_cents), 0) AS cents,
            COUNT(*) AS approvals
     FROM subscription_requests r
     JOIN plans p ON p.id = r.plan_id
     WHERE r.status = 'APPROVED' AND r.resolved_at >= ?
     GROUP BY substr(r.resolved_at, 1, 7)`,
  )
    .bind(`${monthBuckets(months)[0]}-01`)
    .all<{ bucket: string; cents: number; approvals: number }>();

  const series = fillSeries(monthBuckets(months), rows.results ?? [], { cents: 0, approvals: 0 }).map((row) => ({
    month: row.bucket,
    collectedCents: Number(row.cents ?? 0),
    approvals: Number(row.approvals ?? 0),
  }));

  return jsonResponse({ success: true, months, series, currency: 'TND' });
}

/** Plan distribution across active subscriptions + all-time revenue per plan. */
async function plans(env: Env): Promise<Response> {
  const [active, revenueRows] = await Promise.all([
    env.DB.prepare(
      `SELECT p.id, p.name, p.slug, p.price_cents, p.interval, COUNT(s.id) AS subscriptions
       FROM plans p
       LEFT JOIN subscriptions s ON s.plan_id = p.id
         AND s.status = 'active' AND (s.current_period_end IS NULL OR s.current_period_end > ?)
       GROUP BY p.id ORDER BY p.price_cents ASC`,
    ).bind(new Date().toISOString()).all<{ id: string; name: string; slug: string; price_cents: number; interval: string; subscriptions: number }>(),
    env.DB.prepare(
      `SELECT p.id, COALESCE(SUM(p.price_cents), 0) AS cents, COUNT(r.id) AS approvals
       FROM plans p
       LEFT JOIN subscription_requests r ON r.plan_id = p.id AND r.status = 'APPROVED'
       GROUP BY p.id`,
    ).all<{ id: string; cents: number; approvals: number }>(),
  ]);

  const revenueByPlan = new Map((revenueRows.results ?? []).map((row) => [row.id, row]));

  return jsonResponse({
    success: true,
    currency: 'TND',
    plans: (active.results ?? []).map((plan) => ({
      id: plan.id,
      name: plan.name,
      slug: plan.slug,
      priceCents: Number(plan.price_cents),
      interval: plan.interval,
      activeSubscriptions: Number(plan.subscriptions ?? 0),
      collectedCents: Number(revenueByPlan.get(plan.id)?.cents ?? 0),
      approvals: Number(revenueByPlan.get(plan.id)?.approvals ?? 0),
    })),
  });
}

/** Daily signups / new businesses / new campaigns over a window. */
async function growth(env: Env, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const days = daysParam(url, 90);
  const since = isoDaysAgo(days);

  const [users, businesses, campaigns] = await Promise.all([
    env.DB.prepare(
      `SELECT substr(created_at, 1, 10) AS bucket, COUNT(*) AS total FROM users
       WHERE created_at >= ? GROUP BY substr(created_at, 1, 10)`,
    ).bind(since).all<{ bucket: string; total: number }>(),
    env.DB.prepare(
      `SELECT substr(created_at, 1, 10) AS bucket, COUNT(*) AS total FROM businesses
       WHERE created_at >= ? GROUP BY substr(created_at, 1, 10)`,
    ).bind(since).all<{ bucket: string; total: number }>(),
    env.DB.prepare(
      `SELECT substr(created_at, 1, 10) AS bucket, COUNT(*) AS total FROM campaigns
       WHERE created_at >= ? GROUP BY substr(created_at, 1, 10)`,
    ).bind(since).all<{ bucket: string; total: number }>(),
  ]);

  const buckets = dayBuckets(days);
  const zero = (rows: Array<{ bucket: string; total: number }>) =>
    fillSeries(buckets, rows, { total: 0 }).map((row) => ({ day: row.bucket, total: Number(row.total ?? 0) }));

  return jsonResponse({
    success: true,
    days,
    series: {
      signups: zero(users.results ?? []),
      businesses: zero(businesses.results ?? []),
      campaigns: zero(campaigns.results ?? []),
    },
  });
}

/** Platform-wide user & tenant counts plus a top-businesses leaderboard. */
async function users(env: Env, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const limit = Math.min(25, Math.max(1, Number(url.searchParams.get('limit')) || 10));

  const [totals, topRows, planRows, recentRows] = await Promise.all([
    Promise.all([
      scalar(env, 'SELECT COUNT(*) AS total FROM users'),
      scalar(env, `SELECT COUNT(*) AS total FROM users WHERE status = 'ACTIVE'`),
      scalar(env, `SELECT COUNT(*) AS total FROM users WHERE status = 'SUSPENDED'`),
      scalar(env, 'SELECT COUNT(*) AS total FROM users WHERE created_at >= ?', isoDaysAgo(7)),
      scalar(env, 'SELECT COUNT(*) AS total FROM users WHERE created_at >= ?', isoDaysAgo(30)),
      scalar(env, 'SELECT COUNT(*) AS total FROM businesses'),
      scalar(env, 'SELECT COUNT(DISTINCT business_id) AS total FROM business_members'),
    ]),
    env.DB.prepare(
      `SELECT b.id, b.name, b.slug,
              (SELECT COUNT(*) FROM campaigns c WHERE c.business_id = b.id) AS campaigns,
              (SELECT COUNT(*) FROM customers cu WHERE cu.business_id = b.id) AS customers,
              (SELECT COUNT(*) FROM participations p JOIN campaigns c2 ON c2.id = p.campaign_id WHERE c2.business_id = b.id) AS participations
       FROM businesses b
       ORDER BY participations DESC
       LIMIT ?`,
    ).bind(limit).all<{ id: string; name: string; slug: string; campaigns: number; customers: number; participations: number }>(),
    env.DB.prepare(
      `SELECT p.name, p.slug, COUNT(s.id) AS subscriptions
       FROM plans p LEFT JOIN subscriptions s ON s.plan_id = p.id AND s.status = 'active'
       GROUP BY p.id ORDER BY subscriptions DESC`,
    ).all<{ name: string; slug: string; subscriptions: number }>(),
    env.DB.prepare(
      `SELECT id, email, first_name, last_name, status, created_at
       FROM users ORDER BY created_at DESC LIMIT 10`,
    ).all<{ id: string; email: string; first_name: string; last_name: string; status: string; created_at: string }>(),
  ]);

  const [totalUsers, activeUsers, suspendedUsers, newUsers7d, newUsers30d, totalBusinesses, tenantCount] = totals;

  return jsonResponse({
    success: true,
    totals: {
      totalUsers,
      activeUsers,
      suspendedUsers,
      newUsers7d,
      newUsers30d,
      totalBusinesses,
      tenantsWithMembers: tenantCount,
    },
    planDistribution: (planRows.results ?? []).map((row) => ({
      name: row.name,
      slug: row.slug,
      activeSubscriptions: Number(row.subscriptions ?? 0),
    })),
    recentUsers: (recentRows.results ?? []).map((row) => ({
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      status: row.status,
      createdAt: row.created_at,
    })),
    topBusinesses: (topRows.results ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      campaigns: Number(row.campaigns ?? 0),
      customers: Number(row.customers ?? 0),
      participations: Number(row.participations ?? 0),
    })),
  });
}

/** Daily engagement: participations, rewards, coupons, new customers. */
async function activity(env: Env, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const days = daysParam(url, 90);
  const since = isoDaysAgo(days);

  const [participations, rewards, coupons, customers, totals] = await Promise.all([
    env.DB.prepare(
      `SELECT substr(created_at, 1, 10) AS bucket, COUNT(*) AS total FROM participations
       WHERE created_at >= ? GROUP BY substr(created_at, 1, 10)`,
    ).bind(since).all<{ bucket: string; total: number }>(),
    env.DB.prepare(
      `SELECT substr(created_at, 1, 10) AS bucket, COUNT(*) AS total FROM participations
       WHERE reward_id IS NOT NULL AND created_at >= ? GROUP BY substr(created_at, 1, 10)`,
    ).bind(since).all<{ bucket: string; total: number }>(),
    env.DB.prepare(
      `SELECT substr(issued_at, 1, 10) AS bucket, COUNT(*) AS total FROM coupons
       WHERE issued_at >= ? GROUP BY substr(issued_at, 1, 10)`,
    ).bind(since).all<{ bucket: string; total: number }>(),
    env.DB.prepare(
      `SELECT substr(created_at, 1, 10) AS bucket, COUNT(*) AS total FROM customers
       WHERE created_at >= ? GROUP BY substr(created_at, 1, 10)`,
    ).bind(since).all<{ bucket: string; total: number }>(),
    Promise.all([
      scalar(env, 'SELECT COUNT(*) AS total FROM participations'),
      scalar(env, 'SELECT COUNT(*) AS total FROM participations WHERE reward_id IS NOT NULL'),
      scalar(env, `SELECT COUNT(*) AS total FROM coupons WHERE status = 'ISSUED'`),
      scalar(env, `SELECT COUNT(*) AS total FROM coupons WHERE status = 'REDEEMED'`),
      scalar(env, 'SELECT COUNT(*) AS total FROM customers'),
    ]),
  ]);

  const buckets = dayBuckets(days);
  const zero = (rows: Array<{ bucket: string; total: number }>) =>
    fillSeries(buckets, rows, { total: 0 }).map((row) => ({ day: row.bucket, total: Number(row.total ?? 0) }));

  const [participationTotal, rewardsTotal, issuedTotal, redeemedTotal, customerTotal] = totals;

  return jsonResponse({
    success: true,
    days,
    totals: {
      participations: participationTotal,
      rewardsClaimed: rewardsTotal,
      couponsIssued: issuedTotal,
      couponsRedeemed: redeemedTotal,
      customers: customerTotal,
      redemptionRate: issuedTotal > 0 ? Math.round((redeemedTotal / issuedTotal) * 100) : 0,
    },
    series: {
      participations: zero(participations.results ?? []),
      rewardsClaimed: zero(rewards.results ?? []),
      couponsIssued: zero(coupons.results ?? []),
      newCustomers: zero(customers.results ?? []),
    },
  });
}

/** WhatsApp / email volume and delivery health across the platform. */
async function marketing(env: Env): Promise<Response> {
  const thirtyDaysAgo = isoDaysAgo(30);

  const [whatsapp, whatsappWeb, email, emailRecent, suppression] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) AS campaigns, COALESCE(SUM(total_recipients), 0) AS recipients,
              COALESCE(SUM(sent_count), 0) AS sent, COALESCE(SUM(failed_count), 0) AS failed,
              COALESCE(SUM(delivered_count), 0) AS delivered, COALESCE(SUM(read_count), 0) AS read
       FROM whatsapp_campaigns`,
    ).first<{ campaigns: number; recipients: number; sent: number; failed: number; delivered: number; read: number }>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS campaigns, COALESCE(SUM(total_recipients), 0) AS recipients,
              COALESCE(SUM(sent_count), 0) AS sent, COALESCE(SUM(failed_count), 0) AS failed
       FROM whatsapp_web_campaigns`,
    ).first<{ campaigns: number; recipients: number; sent: number; failed: number }>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS campaigns, COALESCE(SUM(total_recipients), 0) AS recipients,
              COALESCE(SUM(sent_count), 0) AS sent, COALESCE(SUM(failed_count), 0) AS failed
       FROM email_campaigns`,
    ).first<{ campaigns: number; recipients: number; sent: number; failed: number }>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS campaigns, COALESCE(SUM(sent_count), 0) AS sent
       FROM email_campaigns WHERE created_at >= ?`,
    ).bind(thirtyDaysAgo).first<{ campaigns: number; sent: number }>(),
    scalar(env, 'SELECT COUNT(*) AS total FROM email_suppression'),
  ]);

  const rate = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

  const waSent = Number(whatsapp?.sent ?? 0);
  const waWebSent = Number(whatsappWeb?.sent ?? 0);
  const emailSent = Number(email?.sent ?? 0);

  return jsonResponse({
    success: true,
    whatsapp: {
      cloud: {
        campaigns: Number(whatsapp?.campaigns ?? 0),
        recipients: Number(whatsapp?.recipients ?? 0),
        sent: waSent,
        failed: Number(whatsapp?.failed ?? 0),
        delivered: Number(whatsapp?.delivered ?? 0),
        read: Number(whatsapp?.read ?? 0),
        deliveryRate: rate(Number(whatsapp?.delivered ?? 0), waSent),
      },
      web: {
        campaigns: Number(whatsappWeb?.campaigns ?? 0),
        recipients: Number(whatsappWeb?.recipients ?? 0),
        sent: waWebSent,
        failed: Number(whatsappWeb?.failed ?? 0),
        failureRate: rate(Number(whatsappWeb?.failed ?? 0), Number(whatsappWeb?.recipients ?? 0)),
      },
      totalSent: waSent + waWebSent,
    },
    email: {
      campaigns: Number(email?.campaigns ?? 0),
      recipients: Number(email?.recipients ?? 0),
      sent: emailSent,
      failed: Number(email?.failed ?? 0),
      sentLast30Days: Number(emailRecent?.sent ?? 0),
      campaignsLast30Days: Number(emailRecent?.campaigns ?? 0),
      failureRate: rate(Number(email?.failed ?? 0), Number(email?.recipients ?? 0)),
      suppressed: suppression,
    },
  });
}

/**
 * Mounted before the `/api/admin` catch-all in index.ts — the account prefix
 * guard there answers 404 for anything that is not `/api/admin/accounts`.
 */
export async function handleStatsRoute(request: Request, env: Env): Promise<Response> {
  const path = new URL(request.url).pathname;

  if (request.method !== 'GET') return errorResponse('Method not allowed.', 405);

  try {
    await requireOperator(request, env);

    if (path === `${STATS_PATH}/overview`) return await overview(env);
    if (path === `${STATS_PATH}/revenue`) return await revenue(env, request);
    if (path === `${STATS_PATH}/plans`) return await plans(env);
    if (path === `${STATS_PATH}/growth`) return await growth(env, request);
    if (path === `${STATS_PATH}/users`) return await users(env, request);
    if (path === `${STATS_PATH}/activity`) return await activity(env, request);
    if (path === `${STATS_PATH}/marketing`) return await marketing(env);

    return errorResponse('Route not found.', 404);
  } catch (error) {
    return renderRouteError(error, 'Stats route failed.');
  }
}
