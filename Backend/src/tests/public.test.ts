import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../types';
import { handlePublicCampaignRoute } from '../routes/public';
import { secureRandomHex } from '../lib/crypto';
import { createTestEnv, type TestDatabase } from './helpers/d1';
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

async function createCampaign(
  overrides: {
    status?: string;
    startAt?: string | null;
    endAt?: string | null;
    rewards?: Array<{ name: string; weight: number; quantity?: number }>;
  } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  const publicCode = secureRandomHex(6).toUpperCase();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO campaigns (id, business_id, name, description, public_code, status, start_at, end_at,
                            game_type, require_customer_information, require_action, created_at, updated_at)
     VALUES (?, ?, 'Coffee Spin', 'Spin to win', ?, ?, ?, ?, 'WHEEL', 1, 'GOOGLE_REVIEW', ?, ?)`,
  )
    .bind(
      id,
      businessId,
      publicCode,
      overrides.status ?? 'ACTIVE',
      overrides.startAt ?? null,
      overrides.endAt ?? null,
      now,
      now,
    )
    .run();

  for (const reward of overrides.rewards ?? [{ name: 'Free coffee', weight: 100 }]) {
    db.prepare(
      `INSERT INTO rewards (id, business_id, campaign_id, name, type, value, description,
                            quantity, quantity_initial, weight, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'free_product', '1', ?, ?, ?, ?, 1, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        businessId,
        id,
        reward.name,
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
  const merchant = await seedMerchant(db);
  businessId = merchant.businessId;
});

afterEach(() => {
  db.close();
});

describe('GET /api/public/campaigns/:code', () => {
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
      rewards: [
        { name: 'Free coffee', weight: 70 },
        { name: 'Try again', weight: 30, quantity: 0 },
      ],
    });

    const payload = await body(await handlePublicCampaignRoute(jsonRequest(publicPath(code), 'GET'), env));

    expect(payload.success).toBe(true);
    expect(payload.campaign.name).toBe('Coffee Spin');
    expect(payload.campaign.business_name).toBe('Test Shop');
    expect(payload.campaign.require_action).toBe('GOOGLE_REVIEW');
    expect(payload.rewards).toHaveLength(2);
    expect(payload.rewards[0]).toMatchObject({ name: 'Free coffee', description: 'Free coffee description' });
    expect(payload.campaign.business_id).toBeUndefined();
  });
});

describe('POST /api/public/campaigns/:code/participate', () => {
  it('records the participation, issues a coupon and returns the reward', async () => {
    const code = await createCampaign({ rewards: [{ name: 'Free coffee', weight: 100 }] });

    const payload = await body(
      await handlePublicCampaignRoute(
        jsonRequest(publicPath(code, '/participate'), 'POST', {
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'ada@example.test',
        }),
        env,
      ),
    );

    expect(payload.success).toBe(true);
    expect(payload.participation.reward.name).toBe('Free coffee');
    expect(payload.participation.couponCode).toMatch(/^CF-[0-9A-F]{16}$/);

    expect(db.query(`SELECT id FROM participations`)).toHaveLength(1);
    expect(db.query(`SELECT status FROM coupons`)).toEqual([{ status: 'ISSUED' }]);
    expect(
      db
        .query<{ event_type: string }>(`SELECT event_type FROM analytics_events ORDER BY event_type`)
        .map((row) => row.event_type),
    ).toEqual(['PARTICIPATION', 'REWARD_CLAIMED']);
    expect(db.query(`SELECT id FROM customers WHERE email = ?`, 'ada@example.test')).toHaveLength(1);
  });

  it('refuses a second spin from the same customer', async () => {
    const code = await createCampaign({ rewards: [{ name: 'Free coffee', weight: 100 }] });
    const spin = { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test' };

    await handlePublicCampaignRoute(jsonRequest(publicPath(code, '/participate'), 'POST', spin), env);
    const second = await handlePublicCampaignRoute(
      jsonRequest(publicPath(code, '/participate'), 'POST', spin),
      env,
    );

    expect(second.status).toBe(409);
    expect((await body(second)).message).toBe('This customer has already participated in this campaign.');
    expect(db.query(`SELECT id FROM participations`)).toHaveLength(1);
  });

  it('404s for an unknown campaign', async () => {
    const response = await handlePublicCampaignRoute(
      jsonRequest(publicPath('ZZZZZZZZZZZZ', '/participate'), 'POST', { firstName: 'Ada', lastName: 'Lovelace' }),
      env,
    );
    expect(response.status).toBe(404);
  });

  it('409s when the campaign is paused', async () => {
    const code = await createCampaign({ status: 'PAUSED' });
    const response = await handlePublicCampaignRoute(
      jsonRequest(publicPath(code, '/participate'), 'POST', { firstName: 'Ada', lastName: 'Lovelace' }),
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
      jsonRequest(publicPath(code, '/participate'), 'POST', { firstName: 'Ada', lastName: 'Lovelace' }),
      env,
    );

    expect(response.status).toBe(400);
    expect((await body(response)).message).toBe('No reward available for this campaign.');
  });
});

describe('reward stock loop', () => {
  async function spin(code: string, email: string) {
    return handlePublicCampaignRoute(
      jsonRequest(publicPath(code, '/participate'), 'POST', { firstName: 'Spin', lastName: 'Ner', email }),
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

  it('hides a sold-out reward from the public campaign payload', async () => {
    const code = await createCampaign({ rewards: [{ name: 'Rare', weight: 100, quantity: 1 }] });
    await spin(code, 'hide-one@example.test');

    const payload = await body(await handlePublicCampaignRoute(jsonRequest(publicPath(code), 'GET'), env));
    expect(payload.rewards).toHaveLength(0);
  });

  it('treats a reward configured without a cap as unlimited', async () => {
    const code = await createCampaign({ rewards: [{ name: 'Always on', weight: 100 }] });
    db.prepare(`UPDATE rewards SET quantity = 0, quantity_initial = 0`).run();

    const payload = await body(await spin(code, 'unlimited@example.test'));

    expect(payload.participation.reward.quantity).toBe(0);
    expect(db.query(`SELECT quantity FROM rewards`)).toEqual([{ quantity: 0 }]);
  });
});
