import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../types';
import { handleBusinessRoute } from '../routes/business';
import { createTestEnv, type TestDatabase } from './helpers/d1';
import { bearer, jsonRequest, seedMerchant, type SeededMerchant } from './helpers/fixtures';

let db: TestDatabase;
let env: Env;
let owner: SeededMerchant;
let outsider: SeededMerchant;

const CONFIG = '/api/business/campaign-config';
const LIST = '/api/business/campaigns';

function baseConfig(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Summer Spin',
    description: 'Win a free coffee',
    googleMapsName: 'Blue Bottle Coffee',
    googleMapsUrl: 'https://maps.google.com/?cid=1',
    googlePlaceId: 'ChIJtest',
    facebookUrl: '',
    instagramUrl: 'https://instagram.com/bluebottle',
    action: 'google-review',
    ...overrides,
  };
}

async function body(response: Response) {
  return (await response.json()) as Record<string, any>;
}

beforeEach(async () => {
  const testEnv = createTestEnv();
  db = testEnv.DB;
  env = testEnv as unknown as Env;
  owner = await seedMerchant(db, { businessName: 'Owner Shop' });
  outsider = await seedMerchant(db, { email: 'outsider@example.test', businessName: 'Other Shop' });
});

afterEach(() => {
  db.close();
});

describe('business route authentication', () => {
  it('rejects requests without a bearer token', async () => {
    const response = await handleBusinessRoute(jsonRequest(CONFIG, 'GET'), env);
    expect(response.status).toBe(401);
    expect(await body(response)).toMatchObject({ success: false, message: 'Authentication required.' });
  });

  it('rejects an unknown token', async () => {
    const response = await handleBusinessRoute(jsonRequest(CONFIG, 'GET', undefined, 'cf_deadbeef.deadbeef'), env);
    expect(response.status).toBe(401);
  });

  it('does not crash on malformed JSON bodies', async () => {
    const request = new Request(`https://example.test${CONFIG}`, {
      method: 'PUT',
      headers: { ...bearer(owner.token), 'content-type': 'application/json' },
      body: '{ not json',
    });
    const response = await handleBusinessRoute(request, env);
    expect(response.status).toBe(500);
  });
});

describe('GET /api/business/campaign-config', () => {
  it('returns null before a campaign exists', async () => {
    const response = await handleBusinessRoute(jsonRequest(CONFIG, 'GET', undefined, owner.token), env);
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ success: true, campaign: null });
  });

  it('returns the campaign and its rewards', async () => {
    await handleBusinessRoute(
      jsonRequest(CONFIG, 'PUT', baseConfig({
        rewards: [
          { name: 'Free coffee', type: 'free_product', value: 10, weight: 50, quantity: 5 },
          { name: 'Try again', type: 'none', value: 0, weight: 50, quantity: 0 },
        ],
      }), owner.token),
      env,
    );

    const response = await handleBusinessRoute(jsonRequest(CONFIG, 'GET', undefined, owner.token), env);
    const payload = await body(response);

    expect(payload.success).toBe(true);
    expect(payload.campaign.name).toBe('Summer Spin');
    expect(payload.campaign.require_action).toBe('GOOGLE_REVIEW');
    expect(payload.rewards).toHaveLength(2);
    expect(payload.rewards[0].name).toBe('Free coffee');
    expect(payload.rewards[0].quantity_initial).toBe(5);
    expect(payload.rewards.map((r: any) => r.weight)).toEqual([50, 50]);
  });

  it('scopes the lookup to the requested campaign', async () => {
    const created = await body(
      await handleBusinessRoute(
        jsonRequest(LIST, 'POST', { name: 'Second', description: 'another' }, owner.token),
        env,
      ),
    );

    const response = await handleBusinessRoute(
      jsonRequest(`${CONFIG}?campaignId=${created.campaign.id}`, 'GET', undefined, owner.token),
      env,
    );
    const payload = await body(response);
    expect(payload.campaign.name).toBe('Second');
    expect(payload.rewards).toEqual([]);
  });

  it('404s for a campaign owned by someone else', async () => {
    const response = await handleBusinessRoute(
      jsonRequest(`${CONFIG}?campaignId=not-yours`, 'GET', undefined, outsider.token),
      env,
    );
    expect(response.status).toBe(404);
  });
});

describe('PUT /api/business/campaign-config', () => {
  it('creates a campaign on first save and is idempotent afterwards', async () => {
    const first = await body(
      await handleBusinessRoute(jsonRequest(CONFIG, 'PUT', baseConfig(), owner.token), env),
    );
    const second = await body(
      await handleBusinessRoute(jsonRequest(CONFIG, 'PUT', baseConfig({ title: 'Renamed' }), owner.token), env),
    );

    expect(first.campaign.publicCode).toMatch(/^[0-9A-F]{12}$/);
    expect(second.campaign.id).toBe(first.campaign.id);

    const rows = db.query<{ id: string; name: string }>(`SELECT id, name FROM campaigns`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Renamed');
  });

  it('upserts rewards in place, preserving ids and deleting removed ones', async () => {
    const created = await body(
      await handleBusinessRoute(
        jsonRequest(CONFIG, 'PUT', baseConfig({
          rewards: [
            { name: 'A', type: 'custom_reward', value: 1, weight: 60, quantity: 3 },
            { name: 'B', type: 'none', value: 0, weight: 40, quantity: 0 },
          ],
        }), owner.token),
        env,
      ),
    );

    const before = db.query<{ id: string; name: string }>(
      `SELECT id, name FROM rewards WHERE campaign_id = ? ORDER BY name`,
      created.campaign.id,
    );
    expect(before).toHaveLength(2);

    const saved = await body(
      await handleBusinessRoute(
        jsonRequest(CONFIG, 'PUT', baseConfig({
          rewards: [
            { id: before[0]!.id, name: 'A renamed', type: 'custom_reward', value: 2, weight: 100, quantity: 9 },
          ],
        }), owner.token),
        env,
      ),
    );
    expect(saved.campaign.id).toBe(created.campaign.id);

    const after = db.query<{ id: string; name: string; weight: number; quantity: number }>(
      `SELECT id, name, weight, quantity FROM rewards WHERE campaign_id = ?`,
      created.campaign.id,
    );
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(before[0]!.id);
    expect(after[0]!.name).toBe('A renamed');
    expect(after[0]!.weight).toBe(100);
    expect(after[0]!.quantity).toBe(9);
  });

  it('rejects an unknown reward type with 400', async () => {
    const response = await handleBusinessRoute(
      jsonRequest(CONFIG, 'PUT', baseConfig({
        rewards: [{ name: 'Bad', type: 'lottery_ticket', value: 1, weight: 10 }],
      }), owner.token),
      env,
    );
    expect(response.status).toBe(400);
    expect((await body(response)).message).toBe('Validation failed.');
  });

  it('requires a business before saving', async () => {
    const lone = await seedMerchant(db, { email: 'lone@example.test', withBusiness: false });
    const response = await handleBusinessRoute(jsonRequest(CONFIG, 'PUT', baseConfig(), lone.token), env);
    expect(response.status).toBe(404);
  });
});

describe('campaign CRUD', () => {
  it('creates a draft campaign', async () => {
    const response = await handleBusinessRoute(
      jsonRequest(LIST, 'POST', { name: 'Autumn', description: '' }, owner.token),
      env,
    );
    expect(response.status).toBe(201);
    const payload = await body(response);
    expect(payload.campaign.id).toBeTruthy();

    const row = db.query<{ status: string }>(`SELECT status FROM campaigns WHERE id = ?`, payload.campaign.id);
    expect(row[0]?.status).toBe('DRAFT');
  });

  it('lists only the caller campaigns with counts', async () => {
    await handleBusinessRoute(
      jsonRequest(CONFIG, 'PUT', baseConfig({ rewards: [{ name: 'R', weight: 1, type: 'none', value: 0 }] }), owner.token),
      env,
    );
    await handleBusinessRoute(jsonRequest(CONFIG, 'PUT', baseConfig({ title: 'Other' }), outsider.token), env);

    const payload = await body(
      await handleBusinessRoute(jsonRequest(LIST, 'GET', undefined, owner.token), env),
    );

    expect(payload.total).toBe(1);
    expect(payload.campaigns).toHaveLength(1);
    expect(payload.campaigns[0].reward_count).toBe(1);
    expect(payload.campaigns[0].participant_count).toBe(0);
  });

  it('filters by status and search', async () => {
    await handleBusinessRoute(
      jsonRequest(LIST, 'POST', { name: 'Winter promo', description: '' }, owner.token),
      env,
    );
    const second = await body(
      await handleBusinessRoute(jsonRequest(LIST, 'POST', { name: 'Summer sale', description: '' }, owner.token), env),
    );
    await handleBusinessRoute(
      jsonRequest(`${LIST}/${second.campaign.id}`, 'PATCH', { status: 'ACTIVE' }, owner.token),
      env,
    );

    const drafts = await body(
      await handleBusinessRoute(jsonRequest(`${LIST}?status=DRAFT`, 'GET', undefined, owner.token), env),
    );
    expect(drafts.campaigns).toHaveLength(1);
    expect(drafts.campaigns[0].name).toBe('Winter promo');

    const active = await body(
      await handleBusinessRoute(jsonRequest(`${LIST}?status=active`, 'GET', undefined, owner.token), env),
    );
    expect(active.campaigns).toHaveLength(1);
    expect(active.campaigns[0].name).toBe('Summer sale');

    const searched = await body(
      await handleBusinessRoute(jsonRequest(`${LIST}?search=winter`, 'GET', undefined, owner.token), env),
    );
    expect(searched.campaigns).toHaveLength(1);
    expect(searched.campaigns[0].name).toBe('Winter promo');
  });

  it('patches name and status', async () => {
    await handleBusinessRoute(jsonRequest(CONFIG, 'PUT', baseConfig(), owner.token), env);
    const existing = db.query<{ id: string }>(`SELECT id FROM campaigns`)[0]!;

    const payload = await body(
      await handleBusinessRoute(
        jsonRequest(`${LIST}/${existing.id}`, 'PATCH', { name: 'Updated', status: 'PAUSED' }, owner.token),
        env,
      ),
    );
    expect(payload.success).toBe(true);

    const row = db.query<{ name: string; status: string }>(
      `SELECT name, status FROM campaigns WHERE id = ?`,
      existing.id,
    );
    expect(row[0]).toEqual({ name: 'Updated', status: 'PAUSED' });
  });

  it('duplicates a campaign together with its rewards as a draft', async () => {
    await handleBusinessRoute(
      jsonRequest(CONFIG, 'PUT', baseConfig({
        title: 'Original',
        rewards: [{ name: 'R1', type: 'free_product', value: 5, weight: 100, quantity: 2 }],
      }), owner.token),
      env,
    );
    const original = db.query<{ id: string }>(`SELECT id FROM campaigns`)[0]!;

    const payload = await body(
      await handleBusinessRoute(jsonRequest(`${LIST}/${original.id}/duplicate`, 'POST', {}, owner.token), env),
    );
    expect(payload.campaign.id).not.toBe(original.id);

    const copy = db.query<{ name: string; status: string }>(
      `SELECT name, status FROM campaigns WHERE id = ?`,
      payload.campaign.id,
    );
    expect(copy[0]).toEqual({ name: 'Original (copy)', status: 'DRAFT' });

    const rewards = db.query<{ name: string; quantity_initial: number }>(
      `SELECT name, quantity_initial FROM rewards WHERE campaign_id = ?`,
      payload.campaign.id,
    );
    expect(rewards).toHaveLength(1);
    expect(rewards[0]?.quantity_initial).toBe(2);
  });

  it('hard deletes a campaign with no participations', async () => {
    await handleBusinessRoute(jsonRequest(CONFIG, 'PUT', baseConfig(), owner.token), env);
    const existing = db.query<{ id: string }>(`SELECT id FROM campaigns`)[0]!;

    const payload = await body(
      await handleBusinessRoute(jsonRequest(`${LIST}/${existing.id}`, 'DELETE', undefined, owner.token), env),
    );
    expect(payload).toEqual({ success: true, archived: false });
    expect(db.query(`SELECT id FROM campaigns`)).toHaveLength(0);
  });

  it('archives instead of deleting once a participation exists', async () => {
    await handleBusinessRoute(jsonRequest(CONFIG, 'PUT', baseConfig(), owner.token), env);
    const existing = db.query<{ id: string }>(`SELECT id FROM campaigns`)[0]!;

    db.prepare(
      `INSERT INTO participations (id, campaign_id, customer_id, reward_id, result, created_at)
       VALUES (?, ?, ?, NULL, 'WON', ?)`,
    )
      .bind(crypto.randomUUID(), existing.id, crypto.randomUUID(), new Date().toISOString())
      .run();

    const payload = await body(
      await handleBusinessRoute(jsonRequest(`${LIST}/${existing.id}`, 'DELETE', undefined, owner.token), env),
    );
    expect(payload.archived).toBe(true);

    const row = db.query<{ status: string }>(`SELECT status FROM campaigns WHERE id = ?`, existing.id);
    expect(row[0]?.status).toBe('ARCHIVED');
  });

  it('returns 404 for another business campaign on read, patch and delete', async () => {
    await handleBusinessRoute(jsonRequest(CONFIG, 'PUT', baseConfig(), owner.token), env);
    const victim = db.query<{ id: string }>(`SELECT id FROM campaigns`)[0]!;

    for (const [method, path] of [
      ['PATCH', `${LIST}/${victim.id}`],
      ['DELETE', `${LIST}/${victim.id}`],
      ['POST', `${LIST}/${victim.id}/duplicate`],
    ] as const) {
      const response = await handleBusinessRoute(
        jsonRequest(path, method, method === 'PATCH' ? { name: 'nope' } : undefined, outsider.token),
        env,
      );
      expect(response.status, `${method} ${path}`).toBe(404);
    }

    expect(db.query<{ name: string }>(`SELECT name FROM campaigns`)[0]?.name).toBe('Summer Spin');
  });
});
