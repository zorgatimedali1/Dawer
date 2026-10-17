import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../types';
import { handlePublicCampaignRoute } from '../routes/public';
import { secureRandomHex, sha256Hex } from '../lib/crypto';
import { mintSpinVisitorValue } from '../lib/cookie';
import { mintActionTicket } from '../lib/action-ticket';
import { createLockRegistry, createTestEnv, type TestDatabase } from './helpers/d1';
import { jsonRequest, seedMerchant } from './helpers/fixtures';

let db: TestDatabase;
let env: Env;
let businessId: string;

function publicPath(code: string, suffix = ''): string {
  return `/api/public/campaigns/${code}${suffix}`;
}

async function body(response: Response) {
  return (await response.json()) as Record<string, any>;
}

/**
 * Signed visitor cookies handed to participate requests. The pool is refilled
 * per test so every default spin gets a distinct, MAC-verified identity —
 * exactly what the GET route issues to a real browser.
 */
let visitorPool: string[] = [];

function takeVisitorCookie(): string {
  const value = visitorPool.pop();
  if (!value) throw new Error('visitor cookie pool exhausted — refill it in beforeEach');
  return `__Host-cf_spin_visitor=${value}`;
}

/** Attaches a visitor cookie to an otherwise plain request (details endpoint). */
function withCookie(request: Request, cookie: string): Request {
  const headers = new Headers(request.headers);
  headers.set('cookie', cookie);
  return new Request(request, { headers });
}

/**
 * Participate the way the real flow does: the browser loads the campaign
 * first (GET hands out the HttpOnly visitor cookie), then spins with it.
 * By default a fresh signed cookie is taken from the per-test pool so
 * unrelated spins stay distinct visitors; `cookie: null` reproduces a
 * cookie-less request, which the route now refuses (or demotes to the
 * "no win" slice) by policy.
 */
function participateRequest(
  path: string,
  payload: Record<string, unknown>,
  options: { cookie?: string | null; ip?: string } = {},
): Request {
  const cookie =
    options.cookie === null
      ? undefined
      : (options.cookie ?? takeVisitorCookie());
  return new Request(`https://example.test${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(options.ip ? { 'cf-connecting-ip': options.ip } : {}),
    },
    body: JSON.stringify(payload),
  });
}

async function createCampaign(
  overrides: {
    status?: string;
    startAt?: string | null;
    endAt?: string | null;
    requireAction?: string;
    playRules?: Record<string, unknown>;
    rewards?: Array<{ name: string; weight: number; quantity?: number; type?: string }>;
  } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  const publicCode = secureRandomHex(6).toUpperCase();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO campaigns (id, business_id, name, description, public_code, status, start_at, end_at,
                            game_type, require_customer_information, require_action, play_rules,
                            created_at, updated_at)
     VALUES (?, ?, 'Coffee Spin', 'Spin to win', ?, ?, ?, ?, 'WHEEL', 1, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      businessId,
      publicCode,
      overrides.status ?? 'ACTIVE',
      overrides.startAt ?? null,
      overrides.endAt ?? null,
      overrides.requireAction ?? 'NONE',
      overrides.playRules ? JSON.stringify(overrides.playRules) : null,
      now,
      now,
    )
    .run();

  for (const reward of overrides.rewards ?? [{ name: 'Free coffee', weight: 100 }]) {
    db.prepare(
      `INSERT INTO rewards (id, business_id, campaign_id, name, type, value, description,
                            quantity, quantity_initial, weight, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '1', ?, ?, ?, ?, 1, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        businessId,
        id,
        reward.name,
        reward.type ?? 'free_product',
        `${reward.name} description`,
        reward.quantity ?? 5,
        reward.quantity ?? 5,
        reward.weight,
        now,
        now,
      )
      .run();
  }

  return publicCode;
}

beforeEach(async () => {
  const testEnv = createTestEnv();
  db = testEnv.DB;
  env = testEnv as unknown as Env;
  visitorPool = await Promise.all(
    Array.from({ length: 32 }, () => mintSpinVisitorValue(String(testEnv.COOKIE_SIGNING_KEY))),
  );
  const merchant = await seedMerchant(db, { withActiveSubscription: true });
  businessId = merchant.businessId;
});

afterEach(() => {
  db.close();
});

describe('GET /api/public/campaigns/:code', () => {
  it('hides campaigns when their owner has no active paid subscription', async () => {
    const code = await createCampaign();
    await db.prepare('DELETE FROM subscriptions WHERE business_id = ?').bind(businessId).run();

    const response = await handlePublicCampaignRoute(jsonRequest(publicPath(code), 'GET'), env);

    expect(response.status).toBe(404);
  });

  it('404s for an unknown code', async () => {
    const response = await handlePublicCampaignRoute(jsonRequest(publicPath('ZZZZZZZZZZZZ'), 'GET'), env);
    expect(response.status).toBe(404);
  });

  it('404s for a campaign that is not active', async () => {
    const code = await createCampaign({ status: 'DRAFT' });
    const response = await handlePublicCampaignRoute(jsonRequest(publicPath(code), 'GET'), env);
    expect(response.status).toBe(404);
  });

  it('404s outside the schedule window', async () => {
    const yesterday = new Date(Date.now() - 86400_000).toISOString();
    const tomorrow = new Date(Date.now() + 86400_000).toISOString();
    const nextWeek = new Date(Date.now() + 7 * 86400_000).toISOString();

    const ended = await createCampaign({ endAt: yesterday });
    expect((await handlePublicCampaignRoute(jsonRequest(publicPath(ended), 'GET'), env)).status).toBe(404);

    const upcoming = await createCampaign({ startAt: nextWeek });
    expect((await handlePublicCampaignRoute(jsonRequest(publicPath(upcoming), 'GET'), env)).status).toBe(404);

    const running = await createCampaign({ startAt: yesterday, endAt: tomorrow });
    expect((await handlePublicCampaignRoute(jsonRequest(publicPath(running), 'GET'), env)).status).toBe(200);
  });

  it('returns the campaign with its active rewards and business name', async () => {
    const code = await createCampaign({
      requireAction: 'GOOGLE_REVIEW',
      rewards: [
        { name: 'Free coffee', weight: 70 },
        { name: 'Try again', weight: 30, quantity: 0 },
      ],
    });

    const payload = await body(await handlePublicCampaignRoute(jsonRequest(publicPath(code), 'GET'), env));

    expect(payload.success).toBe(true);
    expect(payload.campaign.name).toBe('Coffee Spin');
    expect(payload.campaign.business_name).toBe('Test Shop');
    expect(payload.campaign.business_logo).toBeNull();
    expect(payload.campaign.require_action).toBe('GOOGLE_REVIEW');
    expect(payload.rewards).toHaveLength(2);
    expect(payload.rewards[0]).toMatchObject({ name: 'Free coffee', description: 'Free coffee description' });
    expect(payload.campaign.business_id).toBeUndefined();
  });

  it('exposes the merchant logo for the public screens', async () => {
    const code = await createCampaign();
    db.prepare(`UPDATE businesses SET logo = ? WHERE id = ?`).bind('https://cdn.test/logo.png', businessId).run();

    const payload = await body(await handlePublicCampaignRoute(jsonRequest(publicPath(code), 'GET'), env));
    expect(payload.campaign.business_logo).toBe('https://cdn.test/logo.png');
  });
});

describe('QR scan counting', () => {
  async function loadCampaign(code: string, cookie?: string): Promise<Response> {
    return handlePublicCampaignRoute(
      new Request(`https://example.test${publicPath(code)}`, {
        method: 'GET',
        ...(cookie ? { headers: { cookie } } : {}),
      }),
      env,
    );
  }

  function scanCount(): number {
    return db.query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM analytics_events WHERE event_type = 'QR_SCANNED'`,
    )[0]!.total;
  }

  it('counts a returning visitor once per day', async () => {
    const code = await createCampaign();

    const first = await loadCampaign(code);
    expect(first.status).toBe(200);
    const cookie = String(first.headers.get('set-cookie')).split(';')[0];

    // Refresh, back button, SPA remount — same browser, same day, one scan.
    expect((await loadCampaign(code, cookie)).status).toBe(200);
    expect((await loadCampaign(code, cookie)).status).toBe(200);
    expect(scanCount()).toBe(1);
  });

  it('counts each visitor separately', async () => {
    const code = await createCampaign();

    const visitorA = await loadCampaign(code);
    const cookieA = String(visitorA.headers.get('set-cookie')).split(';')[0];
    const visitorB = await loadCampaign(code);
    const cookieB = String(visitorB.headers.get('set-cookie')).split(';')[0];

    await loadCampaign(code, cookieA);
    await loadCampaign(code, cookieB);

    expect(scanCount()).toBe(2);
  });

  it('keeps scans per campaign', async () => {
    const first = await createCampaign();
    const second = await createCampaign();

    await loadCampaign(first);
    await loadCampaign(second);

    expect(scanCount()).toBe(2);
    expect(
      db.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM analytics_events e
         INNER JOIN campaigns c ON c.id = e.campaign_id
         WHERE e.event_type = 'QR_SCANNED' AND c.public_code = ?`,
        first,
      )[0]!.total,
    ).toBe(1);
  });

  it('does not count a page load that 404s', async () => {
    const code = await createCampaign({ status: 'DRAFT' });

    expect((await loadCampaign(code)).status).toBe(404);
    expect(scanCount()).toBe(0);
  });
});

describe('wheel theme in the public payload', () => {
  const merchantTheme = JSON.stringify({
    colors: { segments: ['#ff0000', '#00ff00'], rim: '#111111', pointer: '#222222' },
    motion: { preset: 'fast' },
    centerLogo: true,
    stepsColor: '#112233',
  });
  const overrideTheme = JSON.stringify({
    colors: { segments: ['#0000ff'], rim: '#333333', pointer: '#444444' },
    motion: { preset: 'slow' },
    centerLogo: false,
  });

  async function upgradeTo(planId: string) {
    db.prepare('DELETE FROM subscriptions WHERE business_id = ?').bind(businessId).run();
    db.prepare(
      `INSERT INTO subscriptions (id, business_id, plan_id, status, current_period_end, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        businessId,
        planId,
        new Date(Date.now() + 86_400_000).toISOString(),
        new Date().toISOString(),
        new Date().toISOString(),
      )
      .run();
  }

  async function loadCampaign() {
    const code = await createCampaign();
    return (await body(await handlePublicCampaignRoute(jsonRequest(publicPath(code), 'GET'), env))).campaign;
  }

  it('ships the default design on Starter even when theme rows exist', async () => {
    db.prepare('UPDATE businesses SET wheel_theme = ?, wheel_theme_override = ? WHERE id = ?')
      .bind(merchantTheme, overrideTheme, businessId)
      .run();

    const campaign = await loadCampaign();

    expect(campaign.wheel_theme).toMatchObject({
      motion: { preset: 'standard' },
      centerLogo: false,
      stepsColor: '#7DAB4B',
    });
    expect(campaign.wheel_logo).toBeNull();
    expect(campaign.business_wheel_theme).toBeUndefined();
    expect(campaign.business_wheel_theme_override).toBeUndefined();
    expect(campaign.business_id).toBeUndefined();
  });

  it('applies the merchant theme on Business and ships the center logo URL', async () => {
    await upgradeTo('plan_scale');
    db.prepare('UPDATE businesses SET wheel_theme = ? WHERE id = ?')
      .bind(merchantTheme, businessId)
      .run();

    const campaign = await loadCampaign();

    expect(campaign.wheel_theme).toMatchObject({
      colors: { rim: '#111111', pointer: '#222222' },
      motion: { preset: 'fast' },
      centerLogo: true,
      stepsColor: '#112233',
    });
    expect(campaign.wheel_logo).toBe(`/api/public/businesses/${businessId}/wheel-logo`);
  });

  it('keeps the default colors on Pro while still showing the hub logo', async () => {
    await upgradeTo('plan_growth');
    db.prepare('UPDATE businesses SET wheel_theme = ? WHERE id = ?')
      .bind(merchantTheme, businessId)
      .run();

    const campaign = await loadCampaign();

    expect(campaign.wheel_theme).toMatchObject({
      motion: { preset: 'standard' },
      centerLogo: true,
      stepsColor: '#112233',
    });
    expect(campaign.wheel_logo).toBe(`/api/public/businesses/${businessId}/wheel-logo`);
    expect(campaign.business_wheel_design_access).toBeUndefined();
  });

  it('lets the operator override win on colors and motion while the merchant keeps the hub logo flag', async () => {
    await upgradeTo('plan_scale');
    db.prepare('UPDATE businesses SET wheel_theme = ?, wheel_theme_override = ? WHERE id = ?')
      .bind(merchantTheme, overrideTheme, businessId)
      .run();

    const campaign = await loadCampaign();

    expect(campaign.wheel_theme).toMatchObject({
      colors: { rim: '#333333', pointer: '#444444' },
      motion: { preset: 'slow' },
      centerLogo: true,
      stepsColor: '#112233',
    });
    expect(campaign.wheel_logo).toBe(`/api/public/businesses/${businessId}/wheel-logo`);
  });
});

describe('POST /api/public/campaigns/:code/participate', () => {
  /**
   * Fills the merchant's customer window with staggered `created_at` values
   * (index 0 oldest) so eviction order is deterministic: customer-0 is always
   * the next to leave. `specialEmail`/`specialIndex` plants a known existing
   * contact at a chosen position for the dedupe tests.
   */
  function seedCustomers(count: number, specialEmail?: string, specialIndex?: number): void {
    const base = Date.now() - count * 1000;
    for (let index = 0; index < count; index += 1) {
      const stamp = new Date(base + index * 1000).toISOString();
      const email = index === specialIndex && specialEmail ? specialEmail : `customer-${index}@example.test`;
      db.prepare(
        `INSERT INTO customers (id, business_id, email, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
        .bind(crypto.randomUUID(), businessId, email, stamp, stamp)
        .run();
    }
  }

  it('stores a new Starter customer at the cap by evicting the oldest one', async () => {
    const code = await createCampaign({ rewards: [{ name: 'Free coffee', weight: 100 }] });
    seedCustomers(200);

    const response = await handlePublicCampaignRoute(
      participateRequest(publicPath(code, '/participate'), { email: 'newest-winner@example.test' }),
      env,
    );

    expect(response.status).toBe(200);
    // Rolling window: the count stays at the plan cap (200), the oldest row
    // is gone, and the new winner took its slot.
    expect(db.query(`SELECT id FROM customers`)).toHaveLength(200);
    expect(db.query(`SELECT id FROM customers WHERE email = ?`, 'customer-0@example.test')).toHaveLength(0);
    expect(db.query(`SELECT id FROM customers WHERE email = ?`, 'newest-winner@example.test')).toHaveLength(1);
    expect(db.query(`SELECT id FROM participations`)).toHaveLength(1);
  });

  it('rolls the window on Pro at 1,000 customers', async () => {
    const code = await createCampaign({ rewards: [{ name: 'Free coffee', weight: 100 }] });
    const now = new Date().toISOString();
    db.prepare(`DELETE FROM subscriptions WHERE business_id = ?`).bind(businessId).run();
    db.prepare(
      `INSERT INTO subscriptions (id, business_id, plan_id, status, current_period_end, created_at, updated_at)
       VALUES (?, ?, 'plan_growth', 'active', ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), businessId, new Date(Date.now() + 86400_000).toISOString(), now, now)
      .run();

    seedCustomers(1000);

    const first = await handlePublicCampaignRoute(
      participateRequest(publicPath(code, '/participate'), { email: 'pro-winner-1@example.test' }),
      env,
    );

    expect(first.status).toBe(200);
    expect(db.query(`SELECT id FROM customers`)).toHaveLength(1000);
    expect(db.query(`SELECT id FROM customers WHERE email = ?`, 'customer-0@example.test')).toHaveLength(0);
    expect(db.query(`SELECT id FROM customers WHERE email = ?`, 'pro-winner-1@example.test')).toHaveLength(1);

    const second = await handlePublicCampaignRoute(
      participateRequest(publicPath(code, '/participate'), { email: 'pro-winner-2@example.test' }),
      env,
    );

    expect(second.status).toBe(200);
    expect(db.query(`SELECT id FROM customers`)).toHaveLength(1000);
    expect(db.query(`SELECT id FROM customers WHERE email = ?`, 'customer-1@example.test')).toHaveLength(0);
    expect(db.query(`SELECT id FROM customers WHERE email = ?`, 'pro-winner-2@example.test')).toHaveLength(1);
  });

  it('rolls the window on Business at 10,000 customers', async () => {
    const code = await createCampaign({ rewards: [{ name: 'Free coffee', weight: 100 }] });
    const now = new Date().toISOString();
    db.prepare(`DELETE FROM subscriptions WHERE business_id = ?`).bind(businessId).run();
    db.prepare(
      `INSERT INTO subscriptions (id, business_id, plan_id, status, current_period_end, created_at, updated_at)
       VALUES (?, ?, 'plan_scale', 'active', ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), businessId, new Date(Date.now() + 86400_000).toISOString(), now, now)
      .run();

    seedCustomers(10000);

    const response = await handlePublicCampaignRoute(
      participateRequest(publicPath(code, '/participate'), { email: 'business-winner@example.test' }),
      env,
    );

    expect(response.status).toBe(200);
    expect(db.query(`SELECT id FROM customers`)).toHaveLength(10000);
    expect(db.query(`SELECT id FROM customers WHERE email = ?`, 'customer-0@example.test')).toHaveLength(0);
    expect(db.query(`SELECT id FROM customers WHERE email = ?`, 'business-winner@example.test')).toHaveLength(1);
  });

  it('keeps an evicted customer\'s participations and coupons, just unlinked', async () => {
    const code = await createCampaign({ rewards: [{ name: 'Free coffee', weight: 100 }] });
    const campaignId = db.query<{ id: string }>(`SELECT id FROM campaigns WHERE public_code = ?`, code)[0]!.id;
    seedCustomers(200);
    const oldestId = db.query<{ id: string }>(`SELECT id FROM customers WHERE email = ?`, 'customer-0@example.test')[0]!.id;
    const historyParticipationId = crypto.randomUUID();

    db.prepare(
      `INSERT INTO participations (id, campaign_id, customer_id, result, created_at)
       VALUES (?, ?, ?, 'WIN', ?)`,
    )
      .bind(historyParticipationId, campaignId, oldestId, new Date().toISOString())
      .run();
    db.prepare(
      `INSERT INTO coupons (id, business_id, campaign_id, customer_id, code, status, issued_at)
       VALUES (?, ?, ?, ?, 'HIST-0001', 'ISSUED', ?)`,
    )
      .bind(crypto.randomUUID(), businessId, campaignId, oldestId, new Date().toISOString())
      .run();

    const response = await handlePublicCampaignRoute(
      participateRequest(publicPath(code, '/participate'), { email: 'newest-winner@example.test' }),
      env,
    );

    expect(response.status).toBe(200);
    expect(db.query(`SELECT id FROM customers`)).toHaveLength(200);
    expect(db.query(`SELECT id FROM customers WHERE id = ?`, oldestId)).toHaveLength(0);
    // History survives the eviction: rows stay, only the customer link is cut.
    expect(
      db.query(`SELECT customer_id FROM participations WHERE id = ?`, historyParticipationId),
    ).toEqual([{ customer_id: null }]);
    expect(db.query(`SELECT customer_id FROM coupons WHERE code = ?`, 'HIST-0001')).toEqual([
      { customer_id: null },
    ]);
  });

  it('never evicts a customer when the winner already exists', async () => {
    const code = await createCampaign({ rewards: [{ name: 'Free coffee', weight: 100 }] });
    seedCustomers(200, 'ada@example.test', 100);

    const response = await handlePublicCampaignRoute(
      participateRequest(publicPath(code, '/participate'), { email: 'ada@example.test' }),
      env,
    );

    expect(response.status).toBe(200);
    // Dedupe wins before the cap check: the stored customer is reused, the
    // window is untouched, and nobody gets evicted.
    expect(db.query(`SELECT id FROM customers`)).toHaveLength(200);
    expect(db.query(`SELECT id FROM customers WHERE email = ?`, 'customer-0@example.test')).toHaveLength(1);
    expect(db.query(`SELECT id FROM customers WHERE email = ?`, 'ada@example.test')).toHaveLength(1);
  });

  it('records the participation but issues no coupon before the details form', async () => {
    const code = await createCampaign({ rewards: [{ name: 'Free coffee', weight: 100 }] });

    const payload = await body(
      await handlePublicCampaignRoute(
        participateRequest(publicPath(code, '/participate'), {
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'ada@example.test',
        }),
        env,
      ),
    );

    expect(payload.success).toBe(true);
    expect(payload.participation.reward.name).toBe('Free coffee');
    // The code is minted when the winner submits their details, not at spin
    // time — otherwise every abandoned form leaves an "Unknown" coupon.
    expect(payload.participation.couponCode).toBe('');

    expect(db.query(`SELECT id FROM participations`)).toHaveLength(1);
    expect(db.query(`SELECT id FROM coupons`)).toHaveLength(0);
    // Wins are no longer double-written as a REWARD_CLAIMED event — the
    // PARTICIPATION row carries the win flag, and analytics counts wins
    // from the coupons table written at details submission.
    const events = db.query<{ event_type: string; event_data: string }>(
      `SELECT event_type, event_data FROM analytics_events ORDER BY event_type`,
    );
    expect(events.map((row) => row.event_type)).toEqual(['PARTICIPATION']);
    const participationEvent = JSON.parse(events[0]!.event_data) as { isWin: boolean; couponCode: string | null };
    expect(participationEvent.isWin).toBe(true);
    expect(participationEvent.couponCode).toBeNull();
    expect(db.query(`SELECT id FROM customers WHERE email = ?`, 'ada@example.test')).toHaveLength(1);
  });

  it('records a no-win slice without issuing a coupon or burning stock', async () => {
    const code = await createCampaign({
      rewards: [{ name: 'Prochaine fois', weight: 100, quantity: 3, type: 'none' }],
    });

    const payload = await body(
      await handlePublicCampaignRoute(
        participateRequest(publicPath(code, '/participate'), {
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'ada@example.test',
        }),
        env,
      ),
    );

    expect(payload.success).toBe(true);
    expect(payload.participation.reward).toMatchObject({ name: 'Prochaine fois', type: 'none' });
    expect(payload.participation.couponCode).toBe('');

    expect(db.query(`SELECT id FROM participations`)).toHaveLength(1);
    expect(db.query(`SELECT id FROM coupons`)).toHaveLength(0);
    expect(db.query<{ quantity: number }>(`SELECT quantity FROM rewards`)).toEqual([{ quantity: 3 }]);
    expect(
      db
        .query<{ event_type: string }>(`SELECT event_type FROM analytics_events ORDER BY event_type`)
        .map((row) => row.event_type),
    ).toEqual(['PARTICIPATION']);
  });

  it('refuses a second spin from the same customer', async () => {
    const code = await createCampaign({ rewards: [{ name: 'Free coffee', weight: 100 }] });
    const spin = { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test' };

    await handlePublicCampaignRoute(participateRequest(publicPath(code, '/participate'), spin), env);
    const second = await handlePublicCampaignRoute(
      participateRequest(publicPath(code, '/participate'), spin),
      env,
    );

    expect(second.status).toBe(409);
    expect((await body(second)).message).toBe('This customer has already participated in this campaign.');
    expect(db.query(`SELECT id FROM participations`)).toHaveLength(1);
    expect(db.query(`SELECT id FROM customers`)).toHaveLength(1);
  });

  it('404s for an unknown campaign', async () => {
    const response = await handlePublicCampaignRoute(
      participateRequest(publicPath('ZZZZZZZZZZZZ', '/participate'), { firstName: 'Ada', lastName: 'Lovelace' }),
      env,
    );
    expect(response.status).toBe(404);
  });

  it('409s when the campaign is paused', async () => {
    const code = await createCampaign({ status: 'PAUSED' });
    const response = await handlePublicCampaignRoute(
      participateRequest(publicPath(code, '/participate'), { firstName: 'Ada', lastName: 'Lovelace' }),
      env,
    );
    expect(response.status).toBe(409);
    expect((await body(response)).message).toBe('Campaign is not accepting spins right now.');
    expect(db.query(`SELECT id FROM participations`)).toHaveLength(0);
  });

  it('400s when the campaign has no active rewards', async () => {
    const code = await createCampaign({ rewards: [{ name: 'Free coffee', weight: 100 }] });
    db.prepare(`UPDATE rewards SET active = 0 WHERE campaign_id = (SELECT id FROM campaigns WHERE public_code = ?)`)
      .bind(code)
      .run();

    const response = await handlePublicCampaignRoute(
      participateRequest(publicPath(code, '/participate'), { firstName: 'Ada', lastName: 'Lovelace' }),
      env,
    );

    expect(response.status).toBe(400);
    expect((await body(response)).message).toBe('No reward available for this campaign.');
  });
});

describe('reward stock loop', () => {
  async function spin(code: string, email: string) {
    return handlePublicCampaignRoute(
      participateRequest(publicPath(code, '/participate'), { firstName: 'Spin', lastName: 'Ner', email }),
      env,
    );
  }

  it('burns one unit of stock per win and reports what is left', async () => {
    const code = await createCampaign({ rewards: [{ name: 'Free coffee', weight: 100, quantity: 2 }] });

    const payload = await body(await spin(code, 'stock-one@example.test'));

    expect(payload.participation.reward.quantity).toBe(1);
    expect(payload.participation.reward.quantityInitial).toBe(2);
    expect(db.query(`SELECT quantity, quantity_initial FROM rewards`)).toEqual([
      { quantity: 1, quantity_initial: 2 },
    ]);
  });

  it('stops offering a reward once its stock runs out', async () => {
    const code = await createCampaign({ rewards: [{ name: 'Rare', weight: 100, quantity: 1 }] });

    await spin(code, 'burn-one@example.test');
    const second = await spin(code, 'burn-two@example.test');

    expect(second.status).toBe(400);
    expect((await body(second)).message).toBe('No reward available for this campaign.');
    expect(db.query(`SELECT quantity FROM rewards`)).toEqual([{ quantity: 0 }]);
    expect(db.query(`SELECT id FROM participations`)).toHaveLength(1);
  });

  it('keeps a sold-out reward on the wheel at 0% and hands its weight to the none slice', async () => {
    const code = await createCampaign({
      rewards: [
        { name: 'Rare', weight: 70, quantity: 1 },
        { name: 'Prochaine fois', weight: 0, quantity: 0, type: 'none' },
      ],
    });
    // The wheel builder ships the "none" slice deactivated at 0%.
    db.prepare(`UPDATE rewards SET active = 0 WHERE campaign_id = (SELECT id FROM campaigns WHERE public_code = ?) AND type = 'none'`)
      .bind(code)
      .run();

    await spin(code, 'burn-one@example.test');

    const payload = await body(await handlePublicCampaignRoute(jsonRequest(publicPath(code), 'GET'), env));
    const rare = payload.rewards.find((reward: { name: string }) => reward.name === 'Rare');
    const noWin = payload.rewards.find((reward: { name: string }) => reward.name === 'Prochaine fois');

    expect(rare).toMatchObject({ weight: 0, quantity: 0 });
    // The freed weight moved to the "none" slice, which had to switch on.
    expect(noWin).toMatchObject({ weight: 70, type: 'none' });
    expect(db.query(`SELECT active FROM rewards WHERE type = 'none'`)).toEqual([{ active: 1 }]);
  });

  it('lands every spin on the none slice once the only prize sells out', async () => {
    const code = await createCampaign({
      rewards: [
        { name: 'Rare', weight: 70, quantity: 1 },
        { name: 'Prochaine fois', weight: 0, quantity: 0, type: 'none' },
      ],
    });

    expect((await spin(code, 'burn-one@example.test')).status).toBe(200);

    const loser = await spin(code, 'after-sellout@example.test');
    const payload = await body(loser);

    expect(loser.status).toBe(200);
    expect(payload.participation.reward).toMatchObject({ name: 'Prochaine fois', type: 'none' });
    expect(db.query(`SELECT quantity FROM rewards WHERE type != 'none'`)).toEqual([{ quantity: 0 }]);
    expect(db.query(`SELECT id FROM coupons`)).toHaveLength(0);
  });

  it('restores the original odds when the merchant tops the stock back up', async () => {
    const code = await createCampaign({
      rewards: [
        { name: 'Rare', weight: 70, quantity: 1 },
        { name: 'Prochaine fois', weight: 0, quantity: 0, type: 'none' },
      ],
    });

    await spin(code, 'burn-one@example.test');
    db.prepare(
      `UPDATE rewards SET quantity = 2 WHERE campaign_id = (SELECT id FROM campaigns WHERE public_code = ?) AND type != 'none'`,
    )
      .bind(code)
      .run();

    const payload = await body(await handlePublicCampaignRoute(jsonRequest(publicPath(code), 'GET'), env));
    const rare = payload.rewards.find((reward: { name: string }) => reward.name === 'Rare');
    const noWin = payload.rewards.find((reward: { name: string }) => reward.name === 'Prochaine fois');

    expect(rare).toMatchObject({ weight: 70, quantity: 2 });
    // Restock only restores the odds; the merchant turns the none slice off themselves.
    expect(noWin).toMatchObject({ weight: 0, type: 'none' });
  });

  it('drops the freed weight instead of guessing when no none slice exists', async () => {
    const code = await createCampaign({ rewards: [{ name: 'Rare', weight: 100, quantity: 1 }] });
    await spin(code, 'burn-one@example.test');

    const payload = await body(await handlePublicCampaignRoute(jsonRequest(publicPath(code), 'GET'), env));

    expect(payload.rewards).toHaveLength(1);
    expect(payload.rewards[0]).toMatchObject({ name: 'Rare', weight: 0, quantity: 0 });
  });

  it('treats a reward configured without a cap as unlimited', async () => {
    const code = await createCampaign({ rewards: [{ name: 'Always on', weight: 100 }] });
    db.prepare(`UPDATE rewards SET quantity = 0, quantity_initial = 0`).run();

    const payload = await body(await spin(code, 'unlimited@example.test'));

    expect(payload.participation.reward.quantity).toBe(0);
    expect(db.query(`SELECT quantity FROM rewards`)).toEqual([{ quantity: 0 }]);
  });

  it('never leaves an orphan customer row when a spin fails after capture', async () => {
    const code = await createCampaign({ rewards: [{ name: 'Rare', weight: 100, quantity: 1 }] });

    const winner = await spin(code, 'keep-row@example.test');
    expect(winner.status).toBe(200);

    const loser = await spin(code, 'drop-row@example.test');
    expect(loser.status).toBe(400);

    // The winning spin keeps its CRM row; the failed spin's freshly created
    // row is rolled back so scripted failures (random emails at a sold-out
    // wheel) cannot fill the merchant's customer-storage quota.
    expect(db.query<{ email: string }>(`SELECT email FROM customers`)).toEqual([
      { email: 'keep-row@example.test' },
    ]);
  });

  it('refuses spins past the campaign daily cap with a friendly capacity error', async () => {
    Object.assign(env, { CAMPAIGN_DAILY_SPIN_CAP: '2' });
    const code = await createCampaign({ rewards: [{ name: 'Free coffee', weight: 100 }] });

    expect((await spin(code, 'cap-1@example.test')).status).toBe(200);
    expect((await spin(code, 'cap-2@example.test')).status).toBe(200);

    const capped = await spin(code, 'cap-3@example.test');
    expect(capped.status).toBe(429);
    expect((await body(capped)).message).toBe('The wheel is at capacity today. Please come back tomorrow.');
    // The cap is checked before the DO claim, so the refused visitor's slot
    // is never burned and the campaign stays at its accepted count.
    expect(db.query(`SELECT id FROM participations`)).toHaveLength(2);
  });
});

describe('anonymous spins', () => {
  async function anonymousSpin(code: string, anonymousId: string) {
    return handlePublicCampaignRoute(
      participateRequest(publicPath(code, '/participate'), { anonymousId }),
      env,
    );
  }

  it('lets two visitors without contact details spin', async () => {
    const code = await createCampaign({ rewards: [{ name: 'Free coffee', weight: 100 }] });

    const first = await anonymousSpin(code, '11111111-1111-4111-8111-111111111111');
    const second = await anonymousSpin(code, '22222222-2222-4222-8222-222222222222');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(db.query(`SELECT id FROM participations`)).toHaveLength(2);
    // P2-5: no contact means no customer row — the spins stay unmaterialized
    // until the details form attaches one (under the plan's storage quota).
    expect(db.query(`SELECT id FROM customers`)).toHaveLength(0);
    expect(db.query(`SELECT customer_id FROM participations`)).toEqual([
      { customer_id: null },
      { customer_id: null },
    ]);
    // No details yet = no coupon at all, so nothing can show up as "Unknown"
    // in the merchant's list.
    expect(db.query(`SELECT id FROM coupons`)).toHaveLength(0);
  });

  it('still refuses a second spin from the same anonymous visitor', async () => {
    const code = await createCampaign({ rewards: [{ name: 'Free coffee', weight: 100 }] });
    const anonymousId = '33333333-3333-4333-8333-333333333333';

    expect((await anonymousSpin(code, anonymousId)).status).toBe(200);
    const second = await anonymousSpin(code, anonymousId);

    expect(second.status).toBe(409);
    expect(db.query(`SELECT id FROM participations`)).toHaveLength(1);
    expect(db.query(`SELECT id FROM customers`)).toHaveLength(0);
  });

  it('keeps spinning anonymous visitors when the customer storage quota is already full', async () => {
    const code = await createCampaign({ rewards: [{ name: 'Free coffee', weight: 100 }] });
    const now = new Date().toISOString();

    for (let index = 0; index < 200; index += 1) {
      db.prepare(
        `INSERT INTO customers (id, business_id, email, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
        .bind(crypto.randomUUID(), businessId, `quota-${index}@example.test`, now, now)
        .run();
    }

    const response = await anonymousSpin(code, '55555555-5555-4555-8555-555555555555');

    expect(response.status).toBe(200);
    expect(db.query(`SELECT id FROM customers`)).toHaveLength(200);
    expect(db.query(`SELECT customer_id FROM participations`)).toEqual([{ customer_id: null }]);
  });

  it('returns the participation id so details can be attached later', async () => {
    const code = await createCampaign();
    const payload = await body(await anonymousSpin(code, '44444444-4444-4444-8444-444444444444'));

    expect(payload.participation.participationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects a malformed anonymous id', async () => {
    const code = await createCampaign();
    const response = await anonymousSpin(code, 'not-a-uuid');

    expect(response.status).toBe(400);
    expect(db.query(`SELECT id FROM participations`)).toHaveLength(0);
  });
});

describe('action claim gate', () => {
  const visitor = '99999999-9999-4999-9999-999999999999';

  function actionPath(code: string): string {
    return `/api/public/campaigns/${code}/action`;
  }

  /**
   * Fresh browser load of a gated campaign: returns the cookie the server
   * issued plus an action ticket bound to it. The ticket is backdated by
   * `ticketAgeMs` so tests can satisfy the dwell window (or exceed the TTL)
   * without touching the clock.
   */
  async function loadSession(
    code: string,
    ticketAgeMs = 5_000,
  ): Promise<{ cookie: string; actionTicket: string }> {
    const response = await handlePublicCampaignRoute(
      new Request(`https://example.test${publicPath(code)}`, { method: 'GET' }),
      env,
    );
    expect(response.status).toBe(200);

    const setCookie = response.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    const cookie = String(setCookie).split(';')[0];
    const rawId = decodeURIComponent(String(cookie).split('=')[1] ?? '').split('.')[0] ?? '';
    const campaignId =
      db.query<{ id: string }>(`SELECT id FROM campaigns WHERE public_code = ?`, code)[0]?.id ?? '';

    const actionTicket = await mintActionTicket(
      String(env.COOKIE_SIGNING_KEY),
      campaignId,
      rawId,
      Date.now() - ticketAgeMs,
    );

    return { cookie, actionTicket };
  }

  async function claim(
    code: string,
    action: string,
    session?: { cookie: string; actionTicket: string },
    anonymousId = visitor,
    turnstileToken?: string,
  ): Promise<Response> {
    const request = jsonRequest(actionPath(code), 'POST', {
      anonymousId,
      action,
      ...(session ? { actionTicket: session.actionTicket } : {}),
      ...(turnstileToken ? { turnstileToken } : {}),
    });
    return handlePublicCampaignRoute(session ? withCookie(request, session.cookie) : request, env);
  }

  async function spin(
    code: string,
    session?: { cookie: string; actionTicket: string },
    anonymousId = visitor,
  ): Promise<Response> {
    return handlePublicCampaignRoute(
      participateRequest(publicPath(code, '/participate'), { anonymousId }, session ? { cookie: session.cookie } : {}),
      env,
    );
  }

  it('refuses to spin before the required action is claimed', async () => {
    const code = await createCampaign({ requireAction: 'GOOGLE_REVIEW' });
    const session = await loadSession(code);

    expect((await spin(code, session)).status).toBe(403);
    expect(db.query(`SELECT id FROM participations`)).toHaveLength(0);
    expect(db.query(`SELECT id FROM action_claims`)).toHaveLength(0);
  });

  it('lets the visitor spin once the matching action is claimed', async () => {
    const code = await createCampaign({ requireAction: 'GOOGLE_REVIEW' });
    const session = await loadSession(code);

    const claimResponse = await claim(code, 'GOOGLE_REVIEW', session);
    expect(claimResponse.status).toBe(200);
    expect(await body(claimResponse)).toMatchObject({ success: true, required: true, action: 'GOOGLE_REVIEW' });

    expect((await spin(code, session)).status).toBe(200);
    expect(db.query(`SELECT action FROM action_claims`)).toEqual([{ action: 'GOOGLE_REVIEW' }]);
  });

  it('treats a replayed claim as idempotent', async () => {
    const code = await createCampaign({ requireAction: 'GOOGLE_REVIEW' });
    const session = await loadSession(code);

    expect((await claim(code, 'GOOGLE_REVIEW', session)).status).toBe(200);
    expect((await claim(code, 'GOOGLE_REVIEW', session)).status).toBe(200);
    expect(db.query(`SELECT id FROM action_claims`)).toHaveLength(1);
  });

  it('rejects a claim for a different action and keeps the gate shut', async () => {
    const code = await createCampaign({ requireAction: 'GOOGLE_REVIEW' });
    const session = await loadSession(code);

    expect((await claim(code, 'INSTAGRAM', session)).status).toBe(400);
    expect(db.query(`SELECT id FROM action_claims`)).toHaveLength(0);
    expect((await spin(code, session)).status).toBe(403);
  });

  it('404s for an unknown campaign', async () => {
    expect((await claim('ZZZZZZZZZZZZ', 'GOOGLE_REVIEW')).status).toBe(404);
  });

  it('400s for a malformed claim body', async () => {
    const code = await createCampaign({ requireAction: 'GOOGLE_REVIEW' });

    const response = await handlePublicCampaignRoute(
      jsonRequest(actionPath(code), 'POST', { anonymousId: 'not-a-uuid', action: 'GOOGLE_REVIEW' }),
      env,
    );

    expect(response.status).toBe(400);
    expect(db.query(`SELECT id FROM action_claims`)).toHaveLength(0);
  });

  it('405s for unsupported methods', async () => {
    const code = await createCampaign({ requireAction: 'GOOGLE_REVIEW' });

    expect((await handlePublicCampaignRoute(jsonRequest(actionPath(code), 'GET'), env)).status).toBe(405);
  });

  it('does not unlock a different campaign', async () => {
    const gated = await createCampaign({ requireAction: 'GOOGLE_REVIEW' });
    const other = await createCampaign({ requireAction: 'GOOGLE_REVIEW' });
    const session = await loadSession(gated);

    expect((await claim(gated, 'GOOGLE_REVIEW', session)).status).toBe(200);
    expect((await spin(other, session)).status).toBe(403);
  });

  it('requires an anonymous id when the campaign is gated', async () => {
    const code = await createCampaign({ requireAction: 'GOOGLE_REVIEW' });

    const response = await handlePublicCampaignRoute(
      participateRequest(publicPath(code, '/participate'), { firstName: 'Jean' }),
      env,
    );

    expect(response.status).toBe(403);
  });

  it('needs no claim when the campaign requires no action', async () => {
    const code = await createCampaign({ requireAction: 'NONE' });

    expect((await spin(code)).status).toBe(200);

    const claimResponse = await claim(code, 'GOOGLE_REVIEW');
    expect(claimResponse.status).toBe(200);
    expect(await body(claimResponse)).toMatchObject({ success: true, required: false });
    expect(db.query(`SELECT id FROM action_claims`)).toHaveLength(0);
  });

  it('rejects a claim that carries no action ticket', async () => {
    const code = await createCampaign({ requireAction: 'GOOGLE_REVIEW' });
    const session = await loadSession(code);

    const response = await handlePublicCampaignRoute(
      withCookie(jsonRequest(actionPath(code), 'POST', { anonymousId: visitor, action: 'GOOGLE_REVIEW' }), session.cookie),
      env,
    );

    expect(response.status).toBe(403);
    expect(db.query(`SELECT id FROM action_claims`)).toHaveLength(0);
  });

  it('rejects a ticket issued before the dwell window elapsed', async () => {
    const code = await createCampaign({ requireAction: 'GOOGLE_REVIEW' });

    // The real ticket straight off the GET — issued milliseconds ago.
    const response = await handlePublicCampaignRoute(
      new Request(`https://example.test${publicPath(code)}`, { method: 'GET' }),
      env,
    );
    const cookie = String(response.headers.get('set-cookie')).split(';')[0];
    const freshTicket = (await body(response)).actionTicket as string;
    expect(freshTicket).toBeTruthy();

    const claimResponse = await handlePublicCampaignRoute(
      withCookie(jsonRequest(actionPath(code), 'POST', { anonymousId: visitor, action: 'GOOGLE_REVIEW', actionTicket: freshTicket }), cookie),
      env,
    );

    expect(claimResponse.status).toBe(403);
    expect(db.query(`SELECT id FROM action_claims`)).toHaveLength(0);
  });

  it('rejects an expired ticket', async () => {
    const code = await createCampaign({ requireAction: 'GOOGLE_REVIEW' });
    const session = await loadSession(code, 11 * 60_000); // TTL is 10 minutes.

    expect((await claim(code, 'GOOGLE_REVIEW', session)).status).toBe(403);
    expect(db.query(`SELECT id FROM action_claims`)).toHaveLength(0);
  });

  it('rejects a ticket when the request comes from a different browser', async () => {
    const code = await createCampaign({ requireAction: 'GOOGLE_REVIEW' });
    const owner = await loadSession(code);
    const intruder = await loadSession(code);

    // Right ticket, wrong cookie: the MAC binds ticket → campaign → visitor.
    const response = await handlePublicCampaignRoute(
      withCookie(
        jsonRequest(actionPath(code), 'POST', { anonymousId: visitor, action: 'GOOGLE_REVIEW', actionTicket: owner.actionTicket }),
        intruder.cookie,
      ),
      env,
    );

    expect(response.status).toBe(403);
    expect(db.query(`SELECT id FROM action_claims`)).toHaveLength(0);
  });

  it('rejects a tampered ticket', async () => {
    const code = await createCampaign({ requireAction: 'GOOGLE_REVIEW' });
    const session = await loadSession(code);
    const tampered = session.actionTicket.replace(/.$/, session.actionTicket.endsWith('a') ? 'b' : 'a');

    const response = await handlePublicCampaignRoute(
      withCookie(
        jsonRequest(actionPath(code), 'POST', { anonymousId: visitor, action: 'GOOGLE_REVIEW', actionTicket: tampered }),
        session.cookie,
      ),
      env,
    );

    expect(response.status).toBe(403);
    expect(db.query(`SELECT id FROM action_claims`)).toHaveLength(0);
  });

  describe('Turnstile token on the action claim (#3)', () => {
    // Siteverify is a network call; stub it and turn enforcement on.
    function stubSiteverify(overrides: Record<string, unknown> = {}) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          new Response(JSON.stringify({ success: true, action: 'action', ...overrides }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      );
      env.TURNSTILE_SECRET_KEY = 'turnstile-secret.test';
    }

    afterEach(() => {
      vi.unstubAllGlobals();
      delete env.TURNSTILE_SECRET_KEY;
    });

    it('claims when Siteverify accepts the token', async () => {
      stubSiteverify();
      const code = await createCampaign({ requireAction: 'GOOGLE_REVIEW' });
      const session = await loadSession(code);

      expect((await claim(code, 'GOOGLE_REVIEW', session, visitor, 'valid-token')).status).toBe(200);
      expect(db.query(`SELECT id FROM action_claims`)).toHaveLength(1);
    });

    it('refuses a claim carrying no token once enforcement is on', async () => {
      stubSiteverify();
      const code = await createCampaign({ requireAction: 'GOOGLE_REVIEW' });
      const session = await loadSession(code);

      expect((await claim(code, 'GOOGLE_REVIEW', session)).status).toBe(403);
      expect(db.query(`SELECT id FROM action_claims`)).toHaveLength(0);
    });

    it('refuses a claim whose token failed the challenge', async () => {
      stubSiteverify({ success: false });
      const code = await createCampaign({ requireAction: 'GOOGLE_REVIEW' });
      const session = await loadSession(code);

      expect((await claim(code, 'GOOGLE_REVIEW', session, visitor, 'bad-token')).status).toBe(403);
      expect(db.query(`SELECT id FROM action_claims`)).toHaveLength(0);
    });

    it('refuses a token minted for a different action', async () => {
      // A farm reuses the spin widget's token (action: "participate") on the
      // action claim — siteverify rejects the action mismatch.
      stubSiteverify({ action: 'participate' });
      const code = await createCampaign({ requireAction: 'GOOGLE_REVIEW' });
      const session = await loadSession(code);

      expect((await claim(code, 'GOOGLE_REVIEW', session, visitor, 'spin-token')).status).toBe(403);
      expect(db.query(`SELECT id FROM action_claims`)).toHaveLength(0);
    });

    it('stays open when no secret is configured (fail-open on config)', async () => {
      // No stub, no TURNSTILE_SECRET_KEY — the check is inert, so the claim
      // succeeds without any token at all.
      const code = await createCampaign({ requireAction: 'GOOGLE_REVIEW' });
      const session = await loadSession(code);

      expect((await claim(code, 'GOOGLE_REVIEW', session)).status).toBe(200);
      expect(db.query(`SELECT id FROM action_claims`)).toHaveLength(1);
    });
  });

  it('keys the claim on the browser identity so rotating ids add nothing', async () => {
    const code = await createCampaign({ requireAction: 'GOOGLE_REVIEW' });
    const session = await loadSession(code);

    expect((await claim(code, 'GOOGLE_REVIEW', session, '11111111-1111-4111-8111-111111111111')).status).toBe(200);
    // A different anonymous id from the same browser collides on the same key.
    expect((await claim(code, 'GOOGLE_REVIEW', session, '22222222-2222-4222-8222-222222222222')).status).toBe(200);
    expect(db.query(`SELECT id FROM action_claims`)).toHaveLength(1);

    // And the claim stays invisible to a fresh browser with its own ticket.
    const fresh = await loadSession(code);
    expect((await spin(code, fresh, '11111111-1111-4111-8111-111111111111')).status).toBe(403);
    expect((await spin(code, session, '33333333-3333-4333-8333-333333333333')).status).toBe(200);
  });
});

describe('spin claim backstop', () => {
  const visitor = '77777777-7777-4777-8777-777777777777';
  const otherVisitor = '88888888-8888-4888-8888-888888888888';
  // One browser keeps its HttpOnly cookie for the whole scenario, so the D1
  // backstop keys every attempt on the same server-set identity.
  const browserValue = 'a'.repeat(64);
  let browserCookie = '';

  beforeEach(async () => {
    browserCookie = `__Host-cf_spin_visitor=${await mintSpinVisitorValue(String(env.COOKIE_SIGNING_KEY), browserValue)}`;
  });

  async function spinWith(
    code: string,
    payload: Record<string, unknown>,
    cookie: string | null = browserCookie,
  ): Promise<Response> {
    return handlePublicCampaignRoute(
      participateRequest(publicPath(code, '/participate'), payload, { cookie }),
      env,
    );
  }

  /** Wipes the stand-in Durable Object storage the way a lost DO would. */
  function loseDurableObjectStorage() {
    (env as unknown as { CAMPAIGN_LOCK: ReturnType<typeof createLockRegistry> }).CAMPAIGN_LOCK =
      createLockRegistry();
  }

  it('records one claim per visitor', async () => {
    const code = await createCampaign({ rewards: [{ name: 'Free coffee', weight: 100, quantity: 3 }] });

    expect((await spinWith(code, { anonymousId: visitor })).status).toBe(200);
    const campaignId = db.query<{ id: string }>(`SELECT id FROM campaigns WHERE public_code = ?`, code)[0]?.id;
    const cookieKey = await sha256Hex(`${campaignId}:${browserValue}`);
    expect(db.query(`SELECT visitor_key FROM spin_claims`)).toEqual([{ visitor_key: cookieKey }]);
    expect(db.query(`SELECT quantity FROM rewards`)).toEqual([{ quantity: 2 }]);
  });

  it('blocks a rotated email once the durable object storage is gone', async () => {
    const code = await createCampaign({ rewards: [{ name: 'Free coffee', weight: 100, quantity: 3 }] });

    expect(
      (await spinWith(code, { anonymousId: visitor, email: 'first@example.test' })).status,
    ).toBe(200);

    loseDurableObjectStorage();

    const response = await spinWith(code, { anonymousId: visitor, email: 'rotated@example.test' });

    expect(response.status).toBe(409);
    expect(await body(response)).toMatchObject({ message: expect.stringContaining('already participated') });
    expect(db.query(`SELECT quantity FROM rewards`)).toEqual([{ quantity: 2 }]);
    expect(db.query(`SELECT id FROM participations`)).toHaveLength(1);
  });

  it('blocks a fresh browser that reuses the same email', async () => {
    const code = await createCampaign({ rewards: [{ name: 'Free coffee', weight: 100, quantity: 3 }] });

    expect(
      (await spinWith(code, { anonymousId: visitor, email: 'same@example.test' })).status,
    ).toBe(200);

    const response = await spinWith(code, { anonymousId: otherVisitor, email: 'same@example.test' });

    expect(response.status).toBe(409);
    expect(db.query(`SELECT id FROM participations`)).toHaveLength(1);
  });

  it('gives the attempt back when the campaign has no reward left', async () => {
    const code = await createCampaign({ rewards: [{ name: 'Free coffee', weight: 100, quantity: 1 }] });

    // Burn the only unit so the campaign is genuinely sold out.
    db.prepare(
      `UPDATE rewards SET quantity = 0 WHERE campaign_id = (SELECT id FROM campaigns WHERE public_code = ?)`,
    )
      .bind(code)
      .run();

    const soldOut = await spinWith(code, { anonymousId: visitor });
    expect(soldOut.status).toBe(400);
    expect(db.query(`SELECT id FROM spin_claims`)).toHaveLength(0);

    db.prepare(
      `UPDATE rewards SET quantity = 1 WHERE campaign_id = (SELECT id FROM campaigns WHERE public_code = ?)`,
    )
      .bind(code)
      .run();

    expect((await spinWith(code, { anonymousId: visitor })).status).toBe(200);
    expect(db.query(`SELECT id FROM spin_claims`)).toHaveLength(1);
    expect(db.query(`SELECT id FROM participations`)).toHaveLength(1);
  });
});

describe('windowed play rules', () => {
  const visitorA = '11111111-1111-4111-8111-111111111111';
  const visitorB = '22222222-2222-4222-8222-222222222222';
  const device = 'a1b2c3d4e5f60718a1b2c3d4e5f60718';

  function windowedRules(overrides: Record<string, unknown> = {}) {
    return { mode: 'windowed', perDay: 1, cooldownMinutes: 0, maxPlaysPerIpDay: 0, winBudget: 0, ...overrides };
  }

  async function spin(
    code: string,
    payload: Record<string, unknown>,
    ip?: string,
    cookie?: string | null,
  ): Promise<Response> {
    return handlePublicCampaignRoute(
      participateRequest(publicPath(code, '/participate'), payload, { ip, cookie }),
      env,
    );
  }

  it('permits repeat spins up to the daily limit, then blocks', async () => {
    const code = await createCampaign({
      playRules: windowedRules({ perDay: 2 }),
      rewards: [{ name: 'Free coffee', weight: 100, quantity: 10 }],
    });

    expect((await spin(code, { anonymousId: visitorA })).status).toBe(200);
    expect((await spin(code, { anonymousId: visitorA })).status).toBe(200);

    const third = await spin(code, { anonymousId: visitorA });
    expect(third.status).toBe(409);
    expect(await body(third)).toMatchObject({ message: expect.stringContaining('spin limit') });

    // The permanent D1 backstop stays empty: windowed claims expire, a UNIQUE row never would.
    expect(db.query(`SELECT id FROM spin_claims`)).toHaveLength(0);
    expect(db.query(`SELECT id FROM participations`)).toHaveLength(2);
    expect(db.query(`SELECT id FROM spin_events`)).toHaveLength(2);
  });

  it('waits out the cooldown between spins', async () => {
    const code = await createCampaign({
      playRules: windowedRules({ perDay: 5, cooldownMinutes: 60 }),
      rewards: [{ name: 'Free coffee', weight: 100, quantity: 10 }],
    });

    expect((await spin(code, { anonymousId: visitorA })).status).toBe(200);

    const blocked = await spin(code, { anonymousId: visitorA });
    expect(blocked.status).toBe(409);
    expect(await body(blocked)).toMatchObject({ message: expect.stringContaining('wait') });

    const later = Date.now() + 61 * 60_000;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(later);
    try {
      expect((await spin(code, { anonymousId: visitorA })).status).toBe(200);
    } finally {
      nowSpy.mockRestore();
    }

    expect(db.query(`SELECT id FROM participations`)).toHaveLength(2);
  });

  it('caps spins per network per day', async () => {
    const code = await createCampaign({
      playRules: windowedRules({ perDay: 5, maxPlaysPerIpDay: 1 }),
      rewards: [{ name: 'Free coffee', weight: 100, quantity: 10 }],
    });

    expect((await spin(code, { anonymousId: visitorA }, '203.0.113.10')).status).toBe(200);

    const sameNetwork = await spin(code, { anonymousId: visitorB }, '203.0.113.10');
    expect(sameNetwork.status).toBe(409);
    expect(await body(sameNetwork)).toMatchObject({ message: expect.stringContaining('network') });

    expect((await spin(code, { anonymousId: visitorB }, '198.51.100.7')).status).toBe(200);
    expect(db.query(`SELECT id FROM spin_events`)).toHaveLength(2);
  });

  it('keys the identity on the device hash when one is provided', async () => {
    const code = await createCampaign({
      rewards: [
        { name: 'Free coffee', weight: 90, quantity: 10 },
        { name: 'Try again', weight: 10, type: 'none', quantity: 0 },
      ],
    });

    // Cookie-less fallback path (verified browsers key on the cookie instead).
    expect(
      (await spin(code, { anonymousId: visitorA, deviceHash: device }, undefined, null)).status,
    ).toBe(200);

    const rotated = await spin(code, { anonymousId: visitorB, deviceHash: device }, undefined, null);
    expect(rotated.status).toBe(409);
    expect(await body(rotated)).toMatchObject({ message: expect.stringContaining('already participated') });

    expect(db.query(`SELECT visitor_key FROM spin_claims`)).toEqual([{ visitor_key: device }]);
    expect(db.query(`SELECT device_hash FROM spin_events`)).toEqual([{ device_hash: device }]);
  });

  it('keeps a permanent single spin when play rules are mode "once"', async () => {
    const code = await createCampaign({
      playRules: { mode: 'once' },
      rewards: [{ name: 'Free coffee', weight: 100, quantity: 3 }],
    });

    expect((await spin(code, { anonymousId: visitorA })).status).toBe(200);

    const second = await spin(code, { anonymousId: visitorA });
    expect(second.status).toBe(409);
    expect(await body(second)).toMatchObject({ message: expect.stringContaining('already participated') });
    expect(db.query(`SELECT id FROM spin_claims`)).toHaveLength(1);
    expect(db.query(`SELECT id FROM participations`)).toHaveLength(1);
  });

  it('forces the no-win slice once the win budget is spent', async () => {
    const code = await createCampaign({
      playRules: windowedRules({ perDay: 3, winBudget: 1 }),
      rewards: [
        { name: 'Free coffee', weight: 100, quantity: 10 },
        { name: 'Try again', weight: 0, type: 'none', quantity: 5 },
      ],
    });

    const first = await body(await spin(code, { anonymousId: visitorA }));
    expect(first.participation.reward.name).toBe('Free coffee');

    const second = await body(await spin(code, { anonymousId: visitorA }));
    expect(second.participation.reward.name).toBe('Try again');

    expect(db.query(`SELECT quantity FROM rewards WHERE name = 'Free coffee'`)).toEqual([{ quantity: 9 }]);
    // The win burned stock but the winner never submitted their details, so
    // no coupon row exists yet.
    expect(db.query(`SELECT id FROM coupons`)).toHaveLength(0);
  });

  it('refuses the spin when the budget is spent and no no-win slice exists', async () => {
    const code = await createCampaign({
      playRules: windowedRules({ perDay: 3, winBudget: 1 }),
      rewards: [{ name: 'Free coffee', weight: 100, quantity: 10 }],
    });

    expect((await spin(code, { anonymousId: visitorA })).status).toBe(200);

    const blocked = await spin(code, { anonymousId: visitorA });
    expect(blocked.status).toBe(409);
    expect(await body(blocked)).toMatchObject({ message: expect.stringContaining('win limit') });
    expect(db.query(`SELECT id FROM participations`)).toHaveLength(1);
  });
});

describe('anti-farm per-IP safety floors', () => {
  // Distinct anonymous ids so only the IP (not the identity) can be what blocks.
  const ids = Array.from({ length: 12 }, (_, i) =>
    `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`,
  );

  async function spin(code: string, anonymousId: string, ip: string): Promise<Response> {
    return handlePublicCampaignRoute(
      participateRequest(publicPath(code, '/participate'), { anonymousId }, { ip }),
      env,
    );
  }

  it('blocks a once campaign past the IP spin floor even with rotating identities', async () => {
    // Merchant set no IP cap (maxPlaysPerIpDay defaults to 0); the floor kicks in.
    env.IP_SPINS_PER_DAY = '3';
    // winBudget: 0 isolates the spin floor — the win cap stays out of the way
    // (winBudget defaults to 1, which would exhaust on the second win).
    const code = await createCampaign({
      playRules: { mode: 'once', winBudget: 0 },
      rewards: [{ name: 'Free coffee', weight: 100, quantity: 100 }],
    });

    const statuses: number[] = [];
    for (const id of ids.slice(0, 4)) {
      statuses.push((await spin(code, id, '203.0.113.50')).status);
    }

    // First three identities pass; the fourth is refused by the IP floor even
    // though no single identity has participated twice.
    expect(statuses).toEqual([200, 200, 200, 409]);

    // A different network is unaffected by the first network's spend.
    expect((await spin(code, ids[4], '198.51.100.9')).status).toBe(200);
  });

  it('lifts a windowed campaign with no merchant IP cap up to the floor', async () => {
    env.IP_SPINS_PER_DAY = '2';
    const code = await createCampaign({
      playRules: { mode: 'windowed', perDay: 5, cooldownMinutes: 0, maxPlaysPerIpDay: 0, winBudget: 0 },
      rewards: [{ name: 'Free coffee', weight: 100, quantity: 100 }],
    });

    expect((await spin(code, ids[0], '203.0.113.60')).status).toBe(200);
    expect((await spin(code, ids[1], '203.0.113.60')).status).toBe(200);

    const blocked = await spin(code, ids[2], '203.0.113.60');
    expect(blocked.status).toBe(409);
    expect(await body(blocked)).toMatchObject({ message: expect.stringContaining('network') });
  });

  it('keeps a merchant cap that is higher than the floor', async () => {
    env.IP_SPINS_PER_DAY = '1';
    const code = await createCampaign({
      playRules: { mode: 'windowed', perDay: 5, cooldownMinutes: 0, maxPlaysPerIpDay: 3, winBudget: 0 },
      rewards: [{ name: 'Free coffee', weight: 100, quantity: 100 }],
    });

    // Merchant allows 3/network/day, which beats the floor of 1.
    expect((await spin(code, ids[0], '203.0.113.70')).status).toBe(200);
    expect((await spin(code, ids[1], '203.0.113.70')).status).toBe(200);
    expect((await spin(code, ids[2], '203.0.113.70')).status).toBe(200);

    const blocked = await spin(code, ids[3], '203.0.113.70');
    expect(blocked.status).toBe(409);
    expect(await body(blocked)).toMatchObject({ message: expect.stringContaining('network') });
  });

  it('forces the no-win slice past the per-IP win floor on a once campaign', async () => {
    // No merchant win budget at all; the IP win floor still caps a farm.
    env.IP_WINS_PER_DAY = '1';
    const code = await createCampaign({
      playRules: { mode: 'once' },
      rewards: [
        { name: 'Free coffee', weight: 100, quantity: 100 },
        { name: 'Try again', weight: 0, type: 'none', quantity: 0 },
      ],
    });

    // First spin from this IP wins; the IP win budget is now spent.
    const first = await body(await spin(code, ids[0], '203.0.113.80'));
    expect(first.participation.reward.name).toBe('Free coffee');

    // Every later spin from the same IP, however many identities rotate, is
    // forced onto the no-win slice instead of winning more stock.
    for (const id of ids.slice(1, 4)) {
      const next = await body(await spin(code, id, '203.0.113.80'));
      expect(next.participation.reward.name).toBe('Try again');
    }

    // Only the single winner burned stock; the forced no-win spins did not.
    expect(db.query(`SELECT quantity FROM rewards WHERE name = 'Free coffee'`)).toEqual([{ quantity: 99 }]);
  });
});

describe('operator play policy override', () => {
  const visitorA = '33333333-3333-4333-8333-333333333333';
  const visitorB = '44444444-4444-4444-8444-444444444444';

  function setPolicy(policy: string | null) {
    db.prepare('UPDATE businesses SET play_policy = ? WHERE id = ?').bind(policy, businessId).run();
  }

  async function spin(code: string, payload: Record<string, unknown>): Promise<Response> {
    return handlePublicCampaignRoute(
      participateRequest(publicPath(code, '/participate'), payload),
      env,
    );
  }

  it('forces one spin per visitor over a windowed campaign', async () => {
    const code = await createCampaign({
      playRules: { mode: 'windowed', perDay: 5, cooldownMinutes: 0, maxPlaysPerIpDay: 0, winBudget: 0 },
      rewards: [{ name: 'Free coffee', weight: 100, quantity: 10 }],
    });
    setPolicy('{"mode":"once"}');

    expect((await spin(code, { anonymousId: visitorA })).status).toBe(200);

    const second = await spin(code, { anonymousId: visitorA });
    expect(second.status).toBe(409);
    expect(await body(second)).toMatchObject({ message: expect.stringContaining('already participated') });

    // The permanent backstop is active under the override even though the
    // campaign itself is windowed (where spin_claims normally stays empty).
    expect(db.query(`SELECT id FROM spin_claims`)).toHaveLength(1);

    expect((await spin(code, { anonymousId: visitorB })).status).toBe(200);
    expect(db.query(`SELECT id FROM participations`)).toHaveLength(2);
  });

  it('applies the daily limit when the campaign has no rules of its own', async () => {
    const code = await createCampaign({ rewards: [{ name: 'Free coffee', weight: 100, quantity: 10 }] });
    setPolicy('{"mode":"windowed","perDay":2,"cooldownMinutes":0}');

    expect((await spin(code, { anonymousId: visitorA })).status).toBe(200);
    expect((await spin(code, { anonymousId: visitorA })).status).toBe(200);

    const third = await spin(code, { anonymousId: visitorA });
    expect(third.status).toBe(409);
    expect(await body(third)).toMatchObject({ message: expect.stringContaining('spin limit') });
    expect(db.query(`SELECT id FROM spin_claims`)).toHaveLength(0);
    expect(db.query(`SELECT id FROM participations`)).toHaveLength(2);
  });

  it('opens repeat spins on a "once" campaign without inheriting a win budget', async () => {
    const code = await createCampaign({
      playRules: { mode: 'once' },
      rewards: [
        { name: 'Free coffee', weight: 100, quantity: 10 },
        { name: 'Try again', weight: 0, type: 'none', quantity: 5 },
      ],
    });
    setPolicy('{"mode":"windowed","perDay":3,"cooldownMinutes":0}');

    const first = await body(await spin(code, { anonymousId: visitorA }));
    const second = await body(await spin(code, { anonymousId: visitorA }));
    expect(first.participation.reward.name).toBe('Free coffee');
    expect(second.participation.reward.name).toBe('Free coffee');
    expect(db.query(`SELECT id FROM participations`)).toHaveLength(2);
  });

  it('returns the effective rules on the public campaign without leaking the policy column', async () => {
    const code = await createCampaign({
      playRules: { mode: 'windowed', perDay: 5, cooldownMinutes: 0, maxPlaysPerIpDay: 0, winBudget: 0 },
    });
    setPolicy('{"mode":"once"}');

    const payload = await body(await handlePublicCampaignRoute(jsonRequest(publicPath(code), 'GET'), env));
    expect(JSON.parse(payload.campaign.play_rules)).toMatchObject({ mode: 'once' });
    expect(payload.campaign.business_play_policy).toBeUndefined();
  });

  it('falls back to the merchant rules and null play rules when no override is set', async () => {
    const code = await createCampaign({ rewards: [{ name: 'Free coffee', weight: 100, quantity: 10 }] });

    const payload = await body(await handlePublicCampaignRoute(jsonRequest(publicPath(code), 'GET'), env));
    expect(payload.campaign.play_rules).toBeNull();
  });
});

describe('POST /api/public/campaigns/:code/participations/:id/customer', () => {
  const details = {
    firstName: 'Jean',
    lastName: 'Dupont',
    email: 'jean.dupont@example.test',
    phone: '+21622111222',
    marketingConsent: true,
  };

  function detailsPath(code: string, participationId: string): string {
    return `/api/public/campaigns/${code}/participations/${participationId}/customer`;
  }

  async function anonymousSpin(code: string) {
    const cookie = takeVisitorCookie();
    const payload = await body(
      await handlePublicCampaignRoute(
        participateRequest(publicPath(code, '/participate'), {
          anonymousId: '55555555-5555-4555-8555-555555555555',
        }, { cookie }),
        env,
      ),
    );

    return { ...(payload.participation as { participationId: string; couponCode: string }), cookie };
  }

  it('stores the winner details and returns the coupon code', async () => {
    const code = await createCampaign();
    const participation = await anonymousSpin(code);

    const response = await handlePublicCampaignRoute(
      withCookie(jsonRequest(detailsPath(code, participation.participationId), 'POST', details), participation.cookie),
      env,
    );

    expect(response.status).toBe(200);
    const payload = await body(response);
    // The code is minted by this submission — the spin issued nothing yet.
    expect(payload.couponCode).toMatch(/^CF-[0-9A-F]{16}$/);
    expect(db.query(`SELECT code FROM coupons`)).toEqual([{ code: payload.couponCode }]);
    expect(db.query(`SELECT first_name, last_name, email, phone, marketing_consent FROM customers`)).toEqual([
      { first_name: 'Jean', last_name: 'Dupont', email: details.email, phone: details.phone, marketing_consent: 1 },
    ]);
    expect(
      db.query<{ last_activity_at: string | null }>(`SELECT last_activity_at FROM customers`)[0]?.last_activity_at,
    ).toBeTruthy();

    // P2-5: the attach binds both the participation and the coupon it won to
    // the newly created customer.
    const boundCustomerId = db.query<{ customer_id: string | null }>(`SELECT customer_id FROM participations`)[0]
      ?.customer_id;
    expect(boundCustomerId).toBeTruthy();
    expect(db.query(`SELECT customer_id FROM coupons`)).toEqual([{ customer_id: boundCustomerId }]);
  });

  it('issues the coupon on the first submit and never mints a second one on a replay', async () => {
    const code = await createCampaign();
    const participation = await anonymousSpin(code);

    // The spin alone must not create anything the merchant could see as
    // an unnamed row.
    expect(db.query(`SELECT id FROM coupons`)).toHaveLength(0);

    const response = await handlePublicCampaignRoute(
      withCookie(jsonRequest(detailsPath(code, participation.participationId), 'POST', details), participation.cookie),
      env,
    );
    expect(response.status).toBe(200);

    const issued = db.query<{ code: string; status: string; customer_id: string | null }>(
      `SELECT code, status, customer_id FROM coupons`,
    );
    expect(issued).toHaveLength(1);
    expect(issued[0]!.status).toBe('ISSUED');
    expect(issued[0]!.customer_id).toBeTruthy();

    const replay = await handlePublicCampaignRoute(
      withCookie(jsonRequest(detailsPath(code, participation.participationId), 'POST', details), participation.cookie),
      env,
    );
    expect(replay.status).toBe(200);
    expect((await body(replay)).couponCode).toBe(issued[0]!.code);
    expect(db.query(`SELECT id FROM coupons`)).toHaveLength(1);
  });

  it('never issues a coupon for a no-win participation, even on a crafted submit', async () => {
    const code = await createCampaign({
      rewards: [{ name: 'Try again', weight: 100, quantity: 5, type: 'none' }],
    });
    const participation = await anonymousSpin(code);

    const response = await handlePublicCampaignRoute(
      withCookie(jsonRequest(detailsPath(code, participation.participationId), 'POST', details), participation.cookie),
      env,
    );

    expect(response.status).toBe(200);
    expect((await body(response)).couponCode).toBe('');
    expect(db.query(`SELECT id FROM coupons`)).toHaveLength(0);
  });

  it('stores the details attach at the cap by evicting the oldest customer', async () => {
    const code = await createCampaign();
    const participation = await anonymousSpin(code);
    const base = Date.now() - 200 * 1000;

    for (let index = 0; index < 200; index += 1) {
      const stamp = new Date(base + index * 1000).toISOString();
      db.prepare(
        `INSERT INTO customers (id, business_id, email, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
        .bind(crypto.randomUUID(), businessId, `quota-${index}@example.test`, stamp, stamp)
        .run();
    }

    const oldestId = db.query<{ id: string }>(`SELECT id FROM customers WHERE email = ?`, 'quota-0@example.test')[0]!.id;

    const response = await handlePublicCampaignRoute(
      withCookie(jsonRequest(detailsPath(code, participation.participationId), 'POST', details), participation.cookie),
      env,
    );

    expect(response.status).toBe(200);
    expect(db.query(`SELECT id FROM customers`)).toHaveLength(200);
    expect(db.query(`SELECT id FROM customers WHERE id = ?`, oldestId)).toHaveLength(0);
    expect(db.query(`SELECT id FROM customers WHERE email = ?`, details.email)).toHaveLength(1);
    expect(db.query(`SELECT customer_id FROM participations`)).toEqual([
      { customer_id: db.query<{ id: string }>(`SELECT id FROM customers WHERE email = ?`, details.email)[0]!.id },
    ]);
    expect(db.query(`SELECT id FROM coupons`)).toHaveLength(1);
  });

  it('accepts winner details without an email address', async () => {
    const code = await createCampaign();
    const participation = await anonymousSpin(code);

    const response = await handlePublicCampaignRoute(
      withCookie(
        jsonRequest(detailsPath(code, participation.participationId), 'POST', {
          firstName: 'Jean',
          lastName: 'Dupont',
          phone: '+21622111222',
        }),
        participation.cookie,
      ),
      env,
    );

    expect(response.status).toBe(200);
    expect(db.query(`SELECT first_name, last_name, email, phone FROM customers`)).toEqual([
      { first_name: 'Jean', last_name: 'Dupont', email: null, phone: '+21622111222' },
    ]);
  });

  it('merges into a customer that already exists for the merchant', async () => {
    const existingId = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO customers (id, business_id, first_name, last_name, email, created_at, updated_at)
       VALUES (?, ?, 'Jean', 'Dupont', ?, ?, ?)`,
    )
      .bind(existingId, businessId, details.email, now, now)
      .run();

    const code = await createCampaign();
    const participation = await anonymousSpin(code);

    const response = await handlePublicCampaignRoute(
      withCookie(jsonRequest(detailsPath(code, participation.participationId), 'POST', details), participation.cookie),
      env,
    );

    expect(response.status).toBe(200);
    const payload = await body(response);
    // The code is minted by this submission — the spin issued nothing yet.
    expect(payload.couponCode).toMatch(/^CF-[0-9A-F]{16}$/);
    expect(db.query(`SELECT code FROM coupons`)).toEqual([{ code: payload.couponCode }]);

    const customers = db.query<{
      id: string;
      first_name: string;
      last_name: string;
      email: string;
      phone: string | null;
    }>(`SELECT id, first_name, last_name, email, phone FROM customers`);

    expect(customers).toHaveLength(1);
    expect(customers[0]).toMatchObject({
      id: existingId,
      first_name: 'Jean',
      last_name: 'Dupont',
      email: details.email,
      phone: details.phone,
    });
    expect(db.query(`SELECT customer_id FROM participations`)).toEqual([{ customer_id: existingId }]);
    expect(db.query(`SELECT customer_id FROM coupons`)).toEqual([{ customer_id: existingId }]);
  });

  it('404s when the participation belongs to another campaign', async () => {
    const otherCode = await createCampaign();
    const code = await createCampaign();
    const participation = await anonymousSpin(otherCode);

    const response = await handlePublicCampaignRoute(
      jsonRequest(detailsPath(code, participation.participationId), 'POST', details),
      env,
    );

    expect(response.status).toBe(404);
  });

  it('404s for an unknown participation', async () => {
    const code = await createCampaign();
    const response = await handlePublicCampaignRoute(
      jsonRequest(detailsPath(code, crypto.randomUUID()), 'POST', details),
      env,
    );

    expect(response.status).toBe(404);
  });

  it('400s when required details are missing', async () => {
    const code = await createCampaign();
    const participation = await anonymousSpin(code);

    const response = await handlePublicCampaignRoute(
      jsonRequest(detailsPath(code, participation.participationId), 'POST', { firstName: 'Jean' }),
      env,
    );

    expect(response.status).toBe(400);
    expect((await body(response)).message).toBe('Validation failed.');
    expect(db.query(`SELECT id FROM customers WHERE phone IS NOT NULL`)).toHaveLength(0);
  });

  it('405s for unsupported methods', async () => {
    const code = await createCampaign();
    const participation = await anonymousSpin(code);

    const response = await handlePublicCampaignRoute(
      jsonRequest(detailsPath(code, participation.participationId), 'GET'),
      env,
    );

    expect(response.status).toBe(405);
  });

  it('rejects details submitted from a different browser', async () => {
    const code = await createCampaign();
    const participation = await anonymousSpin(code);

    const response = await handlePublicCampaignRoute(
      withCookie(jsonRequest(detailsPath(code, participation.participationId), 'POST', details), takeVisitorCookie()),
      env,
    );

    expect(response.status).toBe(403);
    expect(db.query(`SELECT id FROM customers WHERE email IS NOT NULL`)).toHaveLength(0);
    expect(db.query(`SELECT id FROM coupons WHERE customer_id IN (SELECT id FROM customers WHERE email IS NOT NULL)`)).toHaveLength(0);
  });

  it('rejects details submitted without the visitor cookie', async () => {
    const code = await createCampaign();
    const participation = await anonymousSpin(code);

    const response = await handlePublicCampaignRoute(
      jsonRequest(detailsPath(code, participation.participationId), 'POST', details),
      env,
    );

    expect(response.status).toBe(403);
    expect(db.query(`SELECT id FROM customers WHERE email IS NOT NULL`)).toHaveLength(0);
  });

  it('binds the participation to the signed visitor identity', async () => {
    const code = await createCampaign();
    const participation = await anonymousSpin(code);

    const row = db.query<{ visitor_hash: string | null }>(`SELECT visitor_hash FROM participations`)[0];
    expect(row?.visitor_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('HttpOnly visitor cookie', () => {
  const visitor = '99999999-9999-4999-9999-999999999999';
  const otherVisitor = '66666666-6666-4666-8666-666666666666';

  async function loadCampaign(code: string, cookie?: string): Promise<Response> {
    return handlePublicCampaignRoute(
      new Request(`https://example.test${publicPath(code)}`, {
        method: 'GET',
        ...(cookie ? { headers: { cookie } } : {}),
      }),
      env,
    );
  }

  async function spinWithCookie(
    code: string,
    payload: Record<string, unknown>,
    cookie: string | null,
  ): Promise<Response> {
    return handlePublicCampaignRoute(
      participateRequest(publicPath(code, '/participate'), payload, { cookie }),
      env,
    );
  }

  async function issueCookie(code: string): Promise<string> {
    const response = await loadCampaign(code);
    expect(response.status).toBe(200);
    const setCookie = response.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    return String(setCookie).split(';')[0];
  }

  it('issues a __Host- HttpOnly cookie on the first campaign load', async () => {
    const code = await createCampaign();

    const response = await loadCampaign(code);
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('__Host-cf_spin_visitor=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain('SameSite=Lax');

    // A returning visitor keeps their identity — no second cookie is issued.
    const second = await loadCampaign(code, setCookie.split(';')[0]);
    expect(second.headers.get('set-cookie')).toBeNull();
  });

  it('blocks a rotated anonymous id once the browser holds the cookie', async () => {
    const code = await createCampaign({ rewards: [{ name: 'Free coffee', weight: 100, quantity: 3 }] });
    const cookie = await issueCookie(code);

    expect((await spinWithCookie(code, { anonymousId: visitor }, cookie)).status).toBe(200);

    // Same browser, brand-new anonymous id: the cookie keys the durable claim.
    const rotated = await spinWithCookie(code, { anonymousId: otherVisitor }, cookie);
    expect(rotated.status).toBe(409);
    expect(await body(rotated)).toMatchObject({ message: expect.stringContaining('already participated') });
    expect(db.query(`SELECT id FROM participations`)).toHaveLength(1);
  });

  it('refuses a cookie-less spin when the campaign has no "no win" slice', async () => {
    const code = await createCampaign({ rewards: [{ name: 'Free coffee', weight: 100, quantity: 3 }] });

    const refused = await spinWithCookie(code, { anonymousId: visitor }, null);

    expect(refused.status).toBe(409);
    expect(await body(refused)).toMatchObject({ message: expect.stringContaining('campaign link') });
    expect(db.query(`SELECT id FROM participations`)).toHaveLength(0);
    expect(db.query(`SELECT id FROM spin_claims`)).toHaveLength(0);
  });

  it('demotes a cookie-less spin to the "no win" slice instead of trusting a rotated id', async () => {
    const code = await createCampaign({
      rewards: [
        { name: 'Free coffee', weight: 90, quantity: 3 },
        { name: 'Try again', weight: 10, type: 'none', quantity: 0 },
      ],
    });

    // Two cookie-less requests with fresh anonymous ids cannot both win:
    // without the server-set identity the route never leaves the "no win" slice.
    const first = await spinWithCookie(code, { anonymousId: visitor }, null);
    const second = await spinWithCookie(code, { anonymousId: otherVisitor }, null);

    expect(first.status).toBe(200);
    expect((await body(first)).participation.reward).toMatchObject({ type: 'none', name: 'Try again' });
    expect(second.status).toBe(200);
    expect((await body(second)).participation.reward).toMatchObject({ type: 'none', name: 'Try again' });
    expect(db.query(`SELECT quantity FROM rewards WHERE type = 'free_product'`)).toEqual([{ quantity: 3 }]);
  });

  it('anchors windowed claims on the cookie as well', async () => {
    const code = await createCampaign({
      playRules: { mode: 'windowed', perDay: 1, cooldownMinutes: 0, maxPlaysPerIpDay: 0, winBudget: 0 },
      rewards: [{ name: 'Free coffee', weight: 100, quantity: 10 }],
    });
    const cookie = await issueCookie(code);

    expect((await spinWithCookie(code, { anonymousId: visitor }, cookie)).status).toBe(200);

    const rotated = await spinWithCookie(code, { anonymousId: otherVisitor }, cookie);
    expect(rotated.status).toBe(409);
    expect(await body(rotated)).toMatchObject({ message: expect.stringContaining('spin limit') });

    // Windowed campaigns never write the permanent backstop — the cookie
    // claim lives in the Durable Object where it can expire.
    expect(db.query(`SELECT id FROM spin_claims`)).toHaveLength(0);
    expect(db.query(`SELECT id FROM participations`)).toHaveLength(1);
  });

  it('treats a forged cookie as no cookie at all', async () => {
    const code = await createCampaign({
      rewards: [
        { name: 'Free coffee', weight: 90, quantity: 3 },
        { name: 'Try again', weight: 10, type: 'none', quantity: 0 },
      ],
    });

    // Right shape, wrong MAC: exactly what a client-side rotation produces.
    const forged = `__Host-cf_spin_visitor=${'b'.repeat(64)}.${'c'.repeat(64)}`;
    const response = await spinWithCookie(code, { anonymousId: visitor }, forged);

    expect(response.status).toBe(200);
    expect((await body(response)).participation.reward).toMatchObject({ type: 'none' });
    expect(db.query(`SELECT id FROM coupons`)).toHaveLength(0);
  });

  it('cannot spin twice by forging a fresh cookie each time', async () => {
    const code = await createCampaign({
      rewards: [
        { name: 'Free coffee', weight: 90, quantity: 3 },
        { name: 'Try again', weight: 10, type: 'none', quantity: 0 },
      ],
    });

    // Forged identities never reach the verified path, so both spins fall
    // through to the no-win slice instead of spending real stock.
    const first = await spinWithCookie(code, { anonymousId: visitor }, `__Host-cf_spin_visitor=${'e'.repeat(64)}.${'f'.repeat(64)}`);
    const second = await spinWithCookie(code, { anonymousId: otherVisitor }, `__Host-cf_spin_visitor=${'0'.repeat(64)}.${'1'.repeat(64)}`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await body(first)).participation.reward).toMatchObject({ type: 'none' });
    expect((await body(second)).participation.reward).toMatchObject({ type: 'none' });
    expect(db.query(`SELECT quantity FROM rewards WHERE type = 'free_product'`)).toEqual([{ quantity: 3 }]);
  });

  it('replaces a forged cookie on the next campaign load', async () => {
    const code = await createCampaign();
    const forged = `__Host-cf_spin_visitor=${'b'.repeat(64)}.${'c'.repeat(64)}`;

    const response = await loadCampaign(code, forged);

    expect(response.status).toBe(200);
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('__Host-cf_spin_visitor=');
    const issuedValue = String(setCookie.split(';')[0]).split('=')[1];
    expect(issuedValue).not.toBe(`${'b'.repeat(64)}.${'c'.repeat(64)}`);
  });

  it('replaces a legacy unsigned cookie on the next campaign load', async () => {
    const code = await createCampaign();
    const legacy = `__Host-cf_spin_visitor=${'d'.repeat(64)}`;

    const response = await loadCampaign(code, legacy);

    expect(response.headers.get('set-cookie')).toContain('__Host-cf_spin_visitor=');
  });

  it('issues no cookie at all when the signing key is missing', async () => {
    const code = await createCampaign();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const keylessEnv = { ...env, COOKIE_SIGNING_KEY: undefined } as unknown as Env;

    const response = await handlePublicCampaignRoute(
      new Request(`https://example.test${publicPath(code)}`, { method: 'GET' }),
      keylessEnv,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(console.error).toHaveBeenCalledWith('cookie_signing_key_missing', expect.any(String));
  });
});

describe('per-network controls in "once" mode', () => {
  const visitorA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const visitorB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const visitorC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  async function spin(code: string, payload: Record<string, unknown>, ip?: string): Promise<Response> {
    return handlePublicCampaignRoute(
      participateRequest(publicPath(code, '/participate'), payload, { ip }),
      env,
    );
  }

  it('enforces the configured per-IP cap without windowed rules', async () => {
    const code = await createCampaign({
      playRules: { mode: 'once', maxPlaysPerIpDay: 1 },
      rewards: [{ name: 'Free coffee', weight: 100, quantity: 10 }],
    });

    expect((await spin(code, { anonymousId: visitorA }, '203.0.113.20')).status).toBe(200);

    const sameNetwork = await spin(code, { anonymousId: visitorB }, '203.0.113.20');
    expect(sameNetwork.status).toBe(409);
    expect(await body(sameNetwork)).toMatchObject({ message: expect.stringContaining('network') });

    expect((await spin(code, { anonymousId: visitorB }, '198.51.100.9')).status).toBe(200);
    expect(db.query(`SELECT id FROM spin_events`)).toHaveLength(2);
  });

  it('refuses when a configured cap has no IP signal to count against', async () => {
    const code = await createCampaign({
      playRules: { mode: 'once', maxPlaysPerIpDay: 1 },
      rewards: [{ name: 'Free coffee', weight: 100, quantity: 10 }],
    });

    const response = await spin(code, { anonymousId: visitorA });
    expect(response.status).toBe(409);
    expect(await body(response)).toMatchObject({ message: expect.stringContaining('network') });
    expect(db.query(`SELECT id FROM spin_events`)).toHaveLength(0);
  });

  it('caps wins per network across rotating identities', async () => {
    const code = await createCampaign({
      playRules: { mode: 'once', winBudget: 1 },
      rewards: [
        { name: 'Free coffee', weight: 100, quantity: 10 },
        { name: 'Try again', weight: 1, type: 'none', quantity: 0 },
      ],
    });

    const first = await body(await spin(code, { anonymousId: visitorA }, '203.0.113.30'));
    expect(first.participation.reward.name).toBe('Free coffee');

    // Fresh identity, same network: the per-network budget is already spent.
    const second = await body(await spin(code, { anonymousId: visitorB }, '203.0.113.30'));
    expect(second.participation.reward).toMatchObject({ type: 'none' });

    // A different network still wins, and the audit trail knows which was which.
    const third = await body(await spin(code, { anonymousId: visitorC }, '198.51.100.30'));
    expect(third.participation.reward.name).toBe('Free coffee');

    expect(db.query(`SELECT is_win FROM spin_events ORDER BY is_win`)).toEqual([
      { is_win: 0 },
      { is_win: 1 },
      { is_win: 1 },
    ]);
    expect(db.query(`SELECT quantity FROM rewards WHERE name = 'Free coffee'`)).toEqual([{ quantity: 8 }]);
  });
});

describe('proximity signal (P2-7, soft)', () => {
  const SHOP = { latitude: 36.8065, longitude: 10.1815 };

  async function createCampaignAtShop(): Promise<string> {
    const code = await createCampaign();
    db.prepare('UPDATE campaigns SET latitude = ?, longitude = ? WHERE public_code = ?')
      .bind(SHOP.latitude, SHOP.longitude, code)
      .run();
    return code;
  }

  function distanceRows(code: string) {
    return {
      participations: db.query<{ distance_meters: number | null }>(
        `SELECT p.distance_meters FROM participations p
         JOIN campaigns c ON c.id = p.campaign_id WHERE c.public_code = ?`,
        code,
      ),
      spinEvents: db.query<{ distance_meters: number | null }>(
        `SELECT s.distance_meters FROM spin_events s
         JOIN campaigns c ON c.id = s.campaign_id WHERE c.public_code = ?`,
        code,
      ),
    };
  }

  it('exposes the campaign coordinates on the public GET', async () => {
    const code = await createCampaignAtShop();
    const payload = await body(await handlePublicCampaignRoute(jsonRequest(publicPath(code), 'GET'), env));

    expect(payload.campaign.latitude).toBeCloseTo(SHOP.latitude, 5);
    expect(payload.campaign.longitude).toBeCloseTo(SHOP.longitude, 5);
  });

  it('records the distance on both the participation and the spin audit row', async () => {
    const code = await createCampaignAtShop();

    const response = await handlePublicCampaignRoute(
      participateRequest(publicPath(code, '/participate'), {
        latitude: 36.8165, // ~1.11 km due north of the shop
        longitude: SHOP.longitude,
      }),
      env,
    );
    expect(response.status).toBe(200);

    const { participations, spinEvents } = distanceRows(code);
    expect(participations).toHaveLength(1);
    expect(spinEvents).toHaveLength(1);
    for (const row of [...participations, ...spinEvents]) {
      expect(row.distance_meters).toBeGreaterThan(1100);
      expect(row.distance_meters).toBeLessThan(1125);
    }
  });

  it('records no signal when the customer sends no position', async () => {
    const code = await createCampaignAtShop();

    const response = await handlePublicCampaignRoute(
      participateRequest(publicPath(code, '/participate'), {}),
      env,
    );
    expect(response.status).toBe(200);

    const { participations, spinEvents } = distanceRows(code);
    expect(participations[0]?.distance_meters).toBeNull();
    expect(spinEvents[0]?.distance_meters).toBeNull();
  });

  it('records no signal when the campaign has no location, and still spins', async () => {
    const code = await createCampaign();

    const response = await handlePublicCampaignRoute(
      participateRequest(publicPath(code, '/participate'), {
        latitude: 36.8165,
        longitude: 10.1815,
      }),
      env,
    );
    expect(response.status).toBe(200);

    const { participations, spinEvents } = distanceRows(code);
    expect(participations[0]?.distance_meters).toBeNull();
    expect(spinEvents[0]?.distance_meters).toBeNull();
  });

  it('rejects an out-of-range position with a validation error', async () => {
    const code = await createCampaignAtShop();

    const response = await handlePublicCampaignRoute(
      participateRequest(publicPath(code, '/participate'), { latitude: 999, longitude: 0 }),
      env,
    );

    expect(response.status).toBe(400);
    expect((await body(response)).message).toBe('Validation failed.');
    expect(db.query(`SELECT id FROM participations`)).toHaveLength(0);
  });
});

describe('radius campaigns no longer geofence (location prompt removed)', () => {
  it('accepts a spin without coordinates even when the campaign has a radius', async () => {
    const code = await createCampaign();
    db.prepare('UPDATE campaigns SET latitude = ?, longitude = ?, radius_meters = ? WHERE public_code = ?')
      .bind(36.8065, 10.1815, 500, code)
      .run();

    const response = await handlePublicCampaignRoute(
      participateRequest(publicPath(code, '/participate'), {}),
      env,
    );

    expect(response.status).toBe(200);
    expect(db.query(`SELECT id FROM participations`)).toHaveLength(1);
  });
});

describe('identity-less spins (L14)', () => {
  it('refuses a spin that carries no cookie, device hash, anonymous id or contact', async () => {
    const code = await createCampaign();

    const response = await handlePublicCampaignRoute(
      participateRequest(publicPath(code, '/participate'), {}, { cookie: null }),
      env,
    );

    expect(response.status).toBe(403);
    expect(db.query(`SELECT id FROM participations`)).toHaveLength(0);
    // The shared guest claim key must never be written.
    expect(
      db.query<{ visitor_key: string }>(`SELECT visitor_key FROM spin_claims`).every(
        (row) => row.visitor_key !== 'guest_visitor',
      ),
    ).toBe(true);
  });

  it('still accepts a cookie-less spin that carries an anonymous id', async () => {
    // A `none` slice lets the unverified visitor complete the spin (the
    // pre-existing policy demotes them to it); the L14 gate must not fire.
    const code = await createCampaign({
      rewards: [
        { name: 'Free coffee', weight: 100, quantity: 5 },
        { name: 'Try again', weight: 1, type: 'none', quantity: 0 },
      ],
    });

    const response = await handlePublicCampaignRoute(
      participateRequest(
        publicPath(code, '/participate'),
        { anonymousId: '11111111-1111-4111-8111-111111111111' },
        { cookie: null },
      ),
      env,
    );

    expect(response.status).toBe(200);
    expect((await body(response)).participation.reward).toMatchObject({ type: 'none' });
  });
});

describe('P2-4 contact-key claims', () => {
  it('never scopes a Durable Object claim on the submitted email', async () => {
    const code = await createCampaign({ rewards: [{ name: 'Free coffee', weight: 100, quantity: 3 }] });
    const claimedNames: string[] = [];
    const registry = env.CAMPAIGN_LOCK as unknown as { getByName: (name: string) => unknown };
    const originalGetByName = registry.getByName.bind(env.CAMPAIGN_LOCK);

    registry.getByName = (name: string) => {
      claimedNames.push(name);
      return originalGetByName(name);
    };

    try {
      const response = await handlePublicCampaignRoute(
        participateRequest(publicPath(code, '/participate'), { email: 'victim@example.test' }),
        env,
      );
      expect(response.status).toBe(200);
    } finally {
      registry.getByName = originalGetByName;
    }

    expect(claimedNames.length).toBeGreaterThan(0);
    expect(claimedNames.some((name) => name.includes('victim@example.test'))).toBe(false);
    expect(claimedNames.every((name) => name.startsWith('campaign:'))).toBe(true);
  });

  it('blocks a fresh browser through the expirable D1 claim, and the merchant expiry lifts it', async () => {
    const code = await createCampaign({ rewards: [{ name: 'Free coffee', weight: 100, quantity: 3 }] });
    const campaignId = db.query<{ id: string }>(`SELECT id FROM campaigns WHERE public_code = ?`, code)[0]?.id;
    expect(campaignId).toBeTruthy();

    const burn = await handlePublicCampaignRoute(
      participateRequest(publicPath(code, '/participate'), { email: 'victim@example.test' }),
      env,
    );
    expect(burn.status).toBe(200);

    const claimKeys = db
      .query<{ visitor_key: string }>(`SELECT visitor_key FROM spin_claims WHERE campaign_id = ?`, campaignId)
      .map((row) => row.visitor_key);
    expect(claimKeys.some((key) => key.startsWith('contact:'))).toBe(true);

    const blocked = await handlePublicCampaignRoute(
      participateRequest(publicPath(code, '/participate'), { email: 'victim@example.test' }),
      env,
    );
    expect(blocked.status).toBe(409);
    expect(db.query(`SELECT id FROM participations`)).toHaveLength(1);

    // Same statement the merchant claims-expire endpoint runs.
    db.prepare(`DELETE FROM spin_claims WHERE campaign_id = ? AND created_at < ?`)
      .bind(campaignId, new Date(Date.now() + 60_000).toISOString())
      .run();

    const allowed = await handlePublicCampaignRoute(
      participateRequest(publicPath(code, '/participate'), { email: 'victim@example.test' }),
      env,
    );
    expect(allowed.status).toBe(200);
    expect(db.query(`SELECT id FROM participations`)).toHaveLength(2);
  });
});
