import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../types';
import { handleAdminRoute } from '../routes/admin';
import { handlePlatformFeaturesRoute } from '../routes/settings';
import { handleStatsRoute } from '../routes/stats';
import { handleWhatsAppRoute } from '../../routes/whatsapp';
import { handleEmailRoute } from '../../routes/email';
import { createTestEnv, type TestDatabase } from '../../tests/helpers/d1';
import {
  jsonRequest,
  operatorRequest,
  seedMerchant,
  seedOperator,
  type SeededMerchant,
  type SeededOperator,
} from '../../tests/helpers/fixtures';

let db: TestDatabase;
let env: Env;
let operator: SeededOperator;
let merchant: SeededMerchant;

async function body(response: Response) {
  return (await response.json()) as Record<string, any>;
}

beforeEach(async () => {
  const testEnv = createTestEnv();
  db = testEnv.DB;
  env = testEnv as unknown as Env;

  operator = await seedOperator(db);
  merchant = await seedMerchant(db, {
    email: 'merchant@example.test',
    businessName: 'Merchant Shop',
    withActiveSubscription: true,
    planId: 'plan_growth',
  });
});

afterEach(() => {
  db.close();
});

describe('POST /api/admin/accounts/:id/features', () => {
  it('401s without an operator session', async () => {
    const response = await handleAdminRoute(
      jsonRequest(`/api/admin/accounts/${merchant.userId}/features`, 'POST', { whatsappEnabled: false, reason: 'abuse' }),
      env,
    );
    expect(response.status).toBe(401);
  });

  it('requires at least one flag; a missing reason is accepted', async () => {
    const noReason = await handleAdminRoute(
      operatorRequest(`/api/admin/accounts/${merchant.userId}/features`, 'POST', { whatsappEnabled: false }, operator.token),
      env,
    );
    expect(noReason.status).toBe(200);

    const row = db.query<{ whatsapp_enabled: number }>(
      'SELECT whatsapp_enabled FROM businesses WHERE id = ?',
      merchant.businessId,
    )[0];
    expect(row.whatsapp_enabled).toBe(0);

    const noFlags = await handleAdminRoute(
      operatorRequest(`/api/admin/accounts/${merchant.userId}/features`, 'POST', { reason: 'abuse report' }, operator.token),
      env,
    );
    expect(noFlags.status).toBe(400);
  });

  it('switches WhatsApp off for every business of the account and audits it', async () => {
    const payload = await body(
      await handleAdminRoute(
        operatorRequest(
          `/api/admin/accounts/${merchant.userId}/features`,
          'POST',
          { whatsappEnabled: false, reason: 'spam reports' },
          operator.token,
        ),
        env,
      ),
    );

    expect(payload).toMatchObject({ success: true, updatedBusinesses: 1 });
    expect(payload.featureAccess).toMatchObject({ whatsappEnabled: false });

    const row = db.query<{ whatsapp_enabled: number }>(
      'SELECT whatsapp_enabled FROM businesses WHERE id = ?',
      merchant.businessId,
    )[0];
    expect(row.whatsapp_enabled).toBe(0);

    const entry = db.query<{ action: string; platform_operator_id: string | null; metadata: string }>(
      `SELECT action, platform_operator_id, metadata FROM audit_logs ORDER BY created_at DESC`,
    )[0];
    expect(entry.action).toBe('ADMIN_FEATURE_ACCESS_UPDATED');
    expect(entry.platform_operator_id).toBe(operator.operatorId);
    expect(JSON.parse(entry.metadata)).toMatchObject({ reason: 'spam reports' });
  });

  it('leaves the other channel untouched on a partial update', async () => {
    await handleAdminRoute(
      operatorRequest(
        `/api/admin/accounts/${merchant.userId}/features`,
        'POST',
        { emailEnabled: false, reason: 'deliverability issues' },
        operator.token,
      ),
      env,
    );

    const row = db.query<{ whatsapp_enabled: number; email_enabled: number }>(
      'SELECT whatsapp_enabled, email_enabled FROM businesses WHERE id = ?',
      merchant.businessId,
    )[0];
    expect(row).toMatchObject({ whatsapp_enabled: 1, email_enabled: 0 });
  });

  it('returns the flags on the account detail so the switches render correctly', async () => {
    await handleAdminRoute(
      operatorRequest(
        `/api/admin/accounts/${merchant.userId}/features`,
        'POST',
        { whatsappEnabled: false, reason: 'abuse probe' },
        operator.token,
      ),
      env,
    );

    const detail = await body(
      await handleAdminRoute(
        operatorRequest(`/api/admin/accounts/${merchant.userId}`, 'GET', undefined, operator.token),
        env,
      ),
    );

    expect(detail.featureAccess).toMatchObject({ whatsappEnabled: false, emailEnabled: true });
    expect(detail.businesses[0]).toMatchObject({ whatsappEnabled: false, emailEnabled: true });
  });

  it('404s for an unknown account', async () => {
    const response = await handleAdminRoute(
      operatorRequest('/api/admin/accounts/nope/features', 'POST', { whatsappEnabled: false, reason: 'nope' }, operator.token),
      env,
    );
    expect(response.status).toBe(404);
  });
});

describe('platform-wide feature switches', () => {
  it('401s without an operator session', async () => {
    expect((await handlePlatformFeaturesRoute(jsonRequest('/api/admin/platform-features', 'GET'), env)).status).toBe(401);
    expect(
      (await handlePlatformFeaturesRoute(jsonRequest('/api/admin/platform-features', 'POST', { whatsappEnabled: false }), env))
        .status,
    ).toBe(401);
  });

  it('defaults marketing off but wheel design on, because wheel design has its own plan gate', async () => {
    const payload = await body(
      await handlePlatformFeaturesRoute(
        operatorRequest('/api/admin/platform-features', 'GET', undefined, operator.token),
        env,
      ),
    );
    expect(payload.features).toMatchObject({
      whatsappEnabled: false,
      emailEnabled: false,
      // No platform_settings row means the switch is on, so Pro+ keeps
      // the design access its plan already paid for.
      wheelDesignEnabled: true,
    });
  });

  it('turns wheel design off and back on, propagating to businesses and auditing', async () => {
    const off = await body(
      await handlePlatformFeaturesRoute(
        operatorRequest('/api/admin/platform-features', 'POST', { wheelDesignEnabled: false }, operator.token),
        env,
      ),
    );
    expect(off.features).toMatchObject({ wheelDesignEnabled: false, whatsappEnabled: false });

    expect(
      db.query<{ wheel_design_enabled: number }>(
        'SELECT wheel_design_enabled FROM businesses WHERE id = ?',
        merchant.businessId,
      )[0]!.wheel_design_enabled,
    ).toBe(0);

    const on = await body(
      await handlePlatformFeaturesRoute(
        operatorRequest('/api/admin/platform-features', 'POST', { wheelDesignEnabled: true }, operator.token),
        env,
      ),
    );
    expect(on.features.wheelDesignEnabled).toBe(true);
    expect(
      db.query<{ wheel_design_enabled: number }>(
        'SELECT wheel_design_enabled FROM businesses WHERE id = ?',
        merchant.businessId,
      )[0]!.wheel_design_enabled,
    ).toBe(1);
  });

  it('stores partial updates and audits them', async () => {
    const payload = await body(
      await handlePlatformFeaturesRoute(
        operatorRequest('/api/admin/platform-features', 'POST', { whatsappEnabled: false }, operator.token),
        env,
      ),
    );
    expect(payload.features).toMatchObject({ whatsappEnabled: false, emailEnabled: false });

    const propagated = db.query<{ whatsapp_enabled: number; email_enabled: number }>(
      'SELECT whatsapp_enabled, email_enabled FROM businesses WHERE id = ?',
      merchant.businessId,
    )[0];
    expect(propagated).toMatchObject({ whatsapp_enabled: 0, email_enabled: 1 });

    const reread = await body(
      await handlePlatformFeaturesRoute(
        operatorRequest('/api/admin/platform-features', 'GET', undefined, operator.token),
        env,
      ),
    );
    expect(reread.features.whatsappEnabled).toBe(false);

    const entry = db.query<{ action: string; platform_operator_id: string | null }>(
      `SELECT action, platform_operator_id FROM audit_logs WHERE action = 'ADMIN_PLATFORM_FEATURES_UPDATED'`,
    )[0];
    expect(entry.platform_operator_id).toBe(operator.operatorId);
  });

  it('rejects an empty update', async () => {
    const response = await handlePlatformFeaturesRoute(
      operatorRequest('/api/admin/platform-features', 'POST', {}, operator.token),
      env,
    );
    expect(response.status).toBe(400);
  });
});

describe('merchant-facing enforcement', () => {
  async function whatsappStatus(): Promise<Record<string, any>> {
    const response = await handleWhatsAppRoute(
      jsonRequest('/api/whatsapp/status', 'GET', undefined, merchant.token),
      env,
    );
    return (await body(response)).status;
  }

  it('reports the kill switch in the WhatsApp status payload', async () => {
    expect((await whatsappStatus()).enabled).toBe(true);

    await handleAdminRoute(
      operatorRequest(
        `/api/admin/accounts/${merchant.userId}/features`,
        'POST',
        { whatsappEnabled: false, reason: 'abuse' },
        operator.token,
      ),
      env,
    );

    const status = await whatsappStatus();
    expect(status.enabled).toBe(false);
    expect(status.allowed).toBe(false);
  });

  it('blocks a WhatsApp broadcast when the account switch is off', async () => {
    await handleAdminRoute(
      operatorRequest(
        `/api/admin/accounts/${merchant.userId}/features`,
        'POST',
        { whatsappEnabled: false, reason: 'abuse' },
        operator.token,
      ),
      env,
    );

    const response = await handleWhatsAppRoute(
      jsonRequest(
        '/api/whatsapp/broadcast',
        'POST',
        { recipients: [{ phone: '22345678' }], templateName: 'hello', language: 'fr', variables: [], pace: 'standard' },
        merchant.token,
      ),
      env,
    );
    expect(response.status).toBe(403);
    expect((await body(response)).message).toContain('disabled by the platform administrator');
  });

  it('propagates a platform-wide off switch, and an account re-enabled afterwards wins', async () => {
    await handlePlatformFeaturesRoute(
      operatorRequest('/api/admin/platform-features', 'POST', { whatsappEnabled: false }, operator.token),
      env,
    );

    const status = await whatsappStatus();
    expect(status.enabled).toBe(false);

    const blocked = await handleWhatsAppRoute(
      jsonRequest('/api/whatsapp/templates', 'GET', undefined, merchant.token),
      env,
    );
    expect(blocked.status).toBe(403);

    // The per-account switch overrides the platform control in either direction.
    await handleAdminRoute(
      operatorRequest(`/api/admin/accounts/${merchant.userId}/features`, 'POST', { whatsappEnabled: true }, operator.token),
      env,
    );

    const reEnabled = await whatsappStatus();
    expect(reEnabled.enabled).toBe(true);

    const allowed = await handleWhatsAppRoute(
      jsonRequest('/api/whatsapp/templates', 'GET', undefined, merchant.token),
      env,
    );
    expect(allowed.status).not.toBe(403);
  });

  it('keeps the email status readable and blocks sends when disabled', async () => {
    await handlePlatformFeaturesRoute(
      operatorRequest('/api/admin/platform-features', 'POST', { emailEnabled: false }, operator.token),
      env,
    );

    const statusResponse = await handleEmailRoute(
      jsonRequest('/api/email/status', 'GET', undefined, merchant.token),
      env,
    );
    const status = (await body(statusResponse)).status;
    expect(status.enabled).toBe(false);
    expect(status.allowed).toBe(false);

    const sendResponse = await handleEmailRoute(
      jsonRequest(
        '/api/email/broadcast',
        'POST',
        { senderName: 'Shop', subject: 'Hi', content: 'Hello', recipients: [{ email: 'a@b.test' }] },
        merchant.token,
      ),
      env,
    );
    expect(sendResponse.status).toBe(403);
    expect((await body(sendResponse)).message).toContain('disabled by the platform administrator');
  });

  it('leaves an untouched account fully enabled', async () => {
    const status = await whatsappStatus();
    expect(status.enabled).toBe(true);
  });
});

describe('GET /api/admin/stats', () => {
  it('401s without an operator session', async () => {
    for (const path of ['overview', 'revenue', 'plans', 'growth', 'users', 'activity', 'marketing']) {
      const response = await handleStatsRoute(jsonRequest(`/api/admin/stats/${path}`, 'GET'), env);
      expect(response.status).toBe(401);
    }
  });

  it('405s non-GET methods', async () => {
    const response = await handleStatsRoute(
      operatorRequest('/api/admin/stats/overview', 'POST', {}, operator.token),
      env,
    );
    expect(response.status).toBe(405);
  });

  it('404s unknown stat paths', async () => {
    const response = await handleStatsRoute(
      operatorRequest('/api/admin/stats/nope', 'GET', undefined, operator.token),
      env,
    );
    expect(response.status).toBe(404);
  });

  it('returns an empty-but-well-formed overview on a fresh platform', async () => {
    const payload = await body(
      await handleStatsRoute(operatorRequest('/api/admin/stats/overview', 'GET', undefined, operator.token), env),
    );

    expect(payload.success).toBe(true);
    expect(payload.overview.revenue).toMatchObject({
      collectedAllTimeCents: 0,
      collectedThisMonthCents: 0,
      pipelineCents: 0,
      currency: 'TND',
    });
    expect(payload.overview.accounts.totalUsers).toBe(1);
    expect(payload.overview.accounts.activeUsers).toBe(1);
    expect(payload.overview.subscriptions.active).toBe(1);
  });

  it('derives collected revenue from approved subscription requests', async () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO subscription_requests (id, business_id, user_id, plan_id, status, duration_days, resolved_at, resolved_by, created_at, updated_at)
       VALUES (?, ?, ?, 'plan_growth', 'APPROVED', 365, ?, ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), merchant.businessId, merchant.userId, now, operator.operatorId, now, now)
      .run();

    const payload = await body(
      await handleStatsRoute(operatorRequest('/api/admin/stats/overview', 'GET', undefined, operator.token), env),
    );
    // Pro = 34900 cents.
    expect(payload.overview.revenue.collectedAllTimeCents).toBe(34900);
    expect(payload.overview.revenue.collectedThisMonthCents).toBe(34900);
  });

  it('zero-fills the monthly revenue series', async () => {
    const payload = await body(
      await handleStatsRoute(
        operatorRequest('/api/admin/stats/revenue?months=3', 'GET', undefined, operator.token),
        env,
      ),
    );

    expect(payload.series).toHaveLength(3);
    for (const point of payload.series) {
      expect(point).toMatchObject({ collectedCents: 0, approvals: 0 });
      expect(point.month).toMatch(/^\d{4}-\d{2}$/);
    }
  });

  it('lists plans with active subscription counts', async () => {
    const payload = await body(
      await handleStatsRoute(operatorRequest('/api/admin/stats/plans', 'GET', undefined, operator.token), env),
    );

    expect(payload.plans.length).toBeGreaterThanOrEqual(4);
    const starter = payload.plans.find((plan: { slug: string }) => plan.slug === 'starter');
    expect(starter).toBeDefined();
    expect(payload.plans.every((plan: { priceCents: number }) => plan.priceCents > 0)).toBe(true);
  });

  it('zero-fills the growth series across the window', async () => {
    const payload = await body(
      await handleStatsRoute(
        operatorRequest('/api/admin/stats/growth?days=7', 'GET', undefined, operator.token),
        env,
      ),
    );

    expect(payload.series.signups).toHaveLength(7);
    expect(payload.series.businesses).toHaveLength(7);
    expect(payload.series.campaigns).toHaveLength(7);
    // The seeded merchant signed up today, so the last bucket carries it.
    expect(payload.series.signups[6].total).toBeGreaterThanOrEqual(1);
  });

  it('returns account totals and a top-businesses leaderboard', async () => {
    const payload = await body(
      await handleStatsRoute(operatorRequest('/api/admin/stats/users', 'GET', undefined, operator.token), env),
    );

    expect(payload.totals.totalUsers).toBe(1);
    expect(payload.totals.totalBusinesses).toBe(1);
    expect(payload.recentUsers[0]).toMatchObject({ email: 'merchant@example.test' });
    expect(payload.planDistribution.length).toBeGreaterThanOrEqual(1);
  });

  it('zero-fills the activity series and reports redemption totals', async () => {
    const payload = await body(
      await handleStatsRoute(
        operatorRequest('/api/admin/stats/activity?days=7', 'GET', undefined, operator.token),
        env,
      ),
    );

    expect(payload.series.participations).toHaveLength(7);
    expect(payload.totals).toMatchObject({ participations: 0, couponsIssued: 0, redemptionRate: 0 });
  });

  it('reports marketing volume with safe rates on an empty platform', async () => {
    const payload = await body(
      await handleStatsRoute(operatorRequest('/api/admin/stats/marketing', 'GET', undefined, operator.token), env),
    );

    expect(payload.whatsapp).toMatchObject({ totalSent: 0 });
    expect(payload.email).toMatchObject({ sent: 0, suppressed: 0 });
    expect(payload.whatsapp.cloud.deliveryRate).toBe(0);
    expect(payload.email.failureRate).toBe(0);
  });
});

describe('stats over real data', () => {
  it('counts campaigns, customers and participations in the overview and activity', async () => {
    const now = new Date().toISOString();
    const campaignId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO campaigns (id, business_id, name, public_code, status, created_at, updated_at)
       VALUES (?, ?, 'Wheel', 'CODE1', 'LIVE', ?, ?)`,
    ).bind(campaignId, merchant.businessId, now, now).run();

    const customerId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO customers (id, business_id, first_name, last_name, created_at, updated_at)
       VALUES (?, ?, 'Grace', 'Hopper', ?, ?)`,
    ).bind(customerId, merchant.businessId, now, now).run();

    db.prepare(
      `INSERT INTO participations (id, campaign_id, customer_id, created_at) VALUES (?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), campaignId, customerId, now).run();

    const overview = await body(
      await handleStatsRoute(operatorRequest('/api/admin/stats/overview', 'GET', undefined, operator.token), env),
    );
    expect(overview.overview.activity).toMatchObject({ totalCampaigns: 1, totalCustomers: 1, participations: 1 });

    const activity = await body(
      await handleStatsRoute(
        operatorRequest('/api/admin/stats/activity?days=7', 'GET', undefined, operator.token),
        env,
      ),
    );
    expect(activity.totals.participations).toBe(1);
    expect(activity.series.participations[6].total).toBe(1);
  });

  it('aggregates marketing campaigns sent through both WhatsApp channels and email', async () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO whatsapp_campaigns (id, business_id, user_id, template_name, template_language, recipients,
        total_recipients, sent_count, failed_count, delivered_count, read_count, status, created_at, updated_at)
       VALUES ('wa1', ?, ?, 'hello', 'fr', '[]', 10, 9, 1, 8, 5, 'COMPLETED', ?, ?)`,
    ).bind(merchant.businessId, merchant.userId, now, now).run();

    db.prepare(
      `INSERT INTO whatsapp_web_campaigns (id, business_id, user_id, message, recipients, total_recipients,
        sent_count, failed_count, status, created_at, updated_at)
       VALUES ('waw1', ?, ?, 'hi', '[]', 5, 4, 1, 'COMPLETED', ?, ?)`,
    ).bind(merchant.businessId, merchant.userId, now, now).run();

    db.prepare(
      `INSERT INTO email_campaigns (id, business_id, user_id, subject, total_recipients, sent_count, failed_count, status, created_at, updated_at)
       VALUES ('em1', ?, ?, 'News', 20, 18, 2, 'COMPLETED', ?, ?)`,
    ).bind(merchant.businessId, merchant.userId, now, now).run();

    const payload = await body(
      await handleStatsRoute(operatorRequest('/api/admin/stats/marketing', 'GET', undefined, operator.token), env),
    );

    expect(payload.whatsapp.cloud).toMatchObject({ campaigns: 1, sent: 9, delivered: 8, deliveryRate: 89 });
    expect(payload.whatsapp.web).toMatchObject({ campaigns: 1, sent: 4 });
    expect(payload.whatsapp.totalSent).toBe(13);
    expect(payload.email).toMatchObject({ campaigns: 1, sent: 18, failureRate: 10 });
  });
});

describe('bearer tokens from the merchant side never reach the platform', () => {
  it('rejects a merchant token on stats and platform-features', async () => {
    const stats = await handleStatsRoute(
      jsonRequest('/api/admin/stats/overview', 'GET', undefined, merchant.token),
      env,
    );
    expect(stats.status).toBe(401);

    const features = await handlePlatformFeaturesRoute(
      jsonRequest('/api/admin/platform-features', 'POST', { whatsappEnabled: false }, merchant.token),
      env,
    );
    expect(features.status).toBe(401);
  });
});
