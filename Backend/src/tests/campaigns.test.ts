import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  owner = await seedMerchant(db, { businessName: 'Owner Shop', withActiveSubscription: true });
  outsider = await seedMerchant(db, { email: 'outsider@example.test', businessName: 'Other Shop', withActiveSubscription: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
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

  it('defaults to the last edited live campaign, never an archived one', async () => {
    const live = await body(
      await handleBusinessRoute(jsonRequest(CONFIG, 'PUT', baseConfig({ title: 'Live One' }), owner.token), env),
    );

    const archived = await body(
      await handleBusinessRoute(jsonRequest(LIST, 'POST', { name: 'Archived One', description: 'old' }, owner.token), env),
    );
    // Archiving bumps updated_at; hand the archived row the newest stamp so
    // it would win a plain "most recently updated" pick.
    db.prepare(`UPDATE campaigns SET status = 'ARCHIVED', updated_at = ? WHERE id = ?`)
      .bind('2099-01-01T00:00:00.000Z', archived.campaign.id)
      .run();

    const response = await handleBusinessRoute(jsonRequest(CONFIG, 'GET', undefined, owner.token), env);
    const payload = await body(response);

    expect(payload.campaign.id).toBe(live.campaign.id);
    expect(payload.campaign.name).toBe('Live One');
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

  it('keeps the stored schedule when the wheel config save omits it (H2)', async () => {
    const startAt = '2026-11-01T00:00:00.000Z';
    const endAt = '2026-11-30T23:59:59.999Z';

    // The schedule is set through the campaigns API (which carries startAt /
    // endAt), not the wheel config form.
    const created = await body(
      await handleBusinessRoute(
        jsonRequest(LIST, 'POST', { name: 'Scheduled', startAt, endAt }, owner.token),
        env,
      ),
    );

    // Point the wheel config save at that campaign (its "latest" lookup keys
    // on the newest non-archived campaign), then save without any schedule.
    db.prepare(`UPDATE campaigns SET updated_at = ? WHERE id = ?`)
      .bind('2099-01-02T00:00:00.000Z', created.campaign.id)
      .run();
    await handleBusinessRoute(jsonRequest(CONFIG, 'PUT', baseConfig({ title: 'Scheduled Renamed' }), owner.token), env);

    const row = db.query<{ name: string; start_at: string | null; end_at: string | null }>(
      `SELECT name, start_at, end_at FROM campaigns WHERE id = ?`,
      created.campaign.id,
    )[0]!;
    expect(row.name).toBe('Scheduled Renamed');
    // The wheel save must not null out the schedule (which would turn a
    // scheduled campaign into an always-open one).
    expect(row.start_at).toBe(startAt);
    expect(row.end_at).toBe(endAt);
  });

  it('never writes into an archived campaign when no id is given', async () => {
    const live = await body(
      await handleBusinessRoute(jsonRequest(CONFIG, 'PUT', baseConfig({ title: 'Live One' }), owner.token), env),
    );
    const doomed = await body(
      await handleBusinessRoute(jsonRequest(LIST, 'POST', { name: 'Doomed', description: 'old' }, owner.token), env),
    );
    db.prepare(`UPDATE campaigns SET status = 'ARCHIVED', updated_at = ? WHERE id = ?`)
      .bind('2099-01-01T00:00:00.000Z', doomed.campaign.id)
      .run();

    const saved = await body(
      await handleBusinessRoute(jsonRequest(CONFIG, 'PUT', baseConfig({ title: 'Live Renamed' }), owner.token), env),
    );

    expect(saved.campaign.id).toBe(live.campaign.id);
    expect(
      db.query<{ name: string }>(`SELECT name FROM campaigns WHERE id = ?`, doomed.campaign.id)[0]!.name,
    ).toBe('Doomed');
    expect(db.query<{ name: string }>(`SELECT name FROM campaigns WHERE name = 'Live Renamed'`)).toHaveLength(1);
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

  it('keeps live stock and cap when a save omits quantity (wheel editor)', async () => {
    const created = await body(
      await handleBusinessRoute(
        jsonRequest(CONFIG, 'PUT', baseConfig({
          rewards: [{ name: 'Rare', type: 'custom_reward', value: 1, weight: 100, quantity: 2 }],
        }), owner.token),
        env,
      ),
    );

    // A visitor burn takes the stock down, then the wheel builder saves
    // without a quantity field — sold-out state and the original cap must
    // survive instead of being restocked to the default of 100.
    db.prepare(`UPDATE rewards SET quantity = 0 WHERE campaign_id = ?`).bind(created.campaign.id).run();
    const rewardId = db.query<{ id: string }>(
      `SELECT id FROM rewards WHERE campaign_id = ?`,
      created.campaign.id,
    )[0]!.id;

    await handleBusinessRoute(
      jsonRequest(CONFIG, 'PUT', baseConfig({
        rewards: [{ id: rewardId, name: 'Rare renamed', type: 'custom_reward', value: 1, weight: 100 }],
      }), owner.token),
      env,
    );

    expect(
      db.query<{ quantity: number; quantity_initial: number }>(
        `SELECT quantity, quantity_initial FROM rewards WHERE campaign_id = ?`,
        created.campaign.id,
      ),
    ).toEqual([{ quantity: 0, quantity_initial: 2 }]);
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

  it('clears every reward when saved with an empty list', async () => {
    const created = await body(
      await handleBusinessRoute(
        jsonRequest(CONFIG, 'PUT', baseConfig({
          rewards: [{ name: 'A', type: 'custom_reward', value: 1, weight: 60, quantity: 3 }],
        }), owner.token),
        env,
      ),
    );

    const cleared = await handleBusinessRoute(
      jsonRequest(CONFIG, 'PUT', baseConfig({ rewards: [] }), owner.token),
      env,
    );
    expect(cleared.status).toBe(200);

    const rows = db.query<{ id: string }>(`SELECT id FROM rewards WHERE campaign_id = ?`, created.campaign.id);
    expect(rows).toHaveLength(0);
  });

  it('requires a business before saving', async () => {
    const lone = await seedMerchant(db, { email: 'lone@example.test', withBusiness: false });
    const response = await handleBusinessRoute(jsonRequest(CONFIG, 'PUT', baseConfig(), lone.token), env);
    expect(response.status).toBe(404);
  });

  it('allows trial users to read campaigns but blocks campaign writes', async () => {
    const trial = await seedMerchant(db, { email: 'trial@example.test', businessName: 'Trial Shop' });
    const list = await handleBusinessRoute(jsonRequest(LIST, 'GET', undefined, trial.token), env);
    expect(list.status).toBe(200);

    const create = await handleBusinessRoute(
      jsonRequest(LIST, 'POST', { name: 'Blocked campaign' }, trial.token),
      env,
    );
    expect(create.status).toBe(403);
    expect((await body(create)).message).toContain('read-only');
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

  it('creates a campaign with its scheduled duration and status', async () => {
    const startAt = '2026-10-10T00:00:00.000Z';
    const endAt = '2026-10-20T23:59:59.999Z';
    const response = await handleBusinessRoute(
      jsonRequest(LIST, 'POST', {
        name: 'Autumn promotion',
        description: 'October campaign',
        status: 'SCHEDULED',
        startAt,
        endAt,
      }, owner.token),
      env,
    );
    const payload = await body(response);
    const row = db.query<{ status: string; start_at: string; end_at: string }>(
      `SELECT status, start_at, end_at FROM campaigns WHERE id = ?`,
      payload.campaign.id,
    );

    expect(response.status).toBe(201);
    expect(row[0]).toEqual({ status: 'SCHEDULED', start_at: startAt, end_at: endAt });
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
        jsonRequest(`${LIST}/${existing.id}`, 'PATCH', {
          name: 'Updated',
          status: 'PAUSED',
          startAt: '2026-10-10T00:00:00.000Z',
          endAt: '2026-10-20T23:59:59.999Z',
        }, owner.token),
        env,
      ),
    );
    expect(payload.success).toBe(true);

    const row = db.query<{ name: string; status: string; start_at: string; end_at: string }>(
      `SELECT name, status, start_at, end_at FROM campaigns WHERE id = ?`,
      existing.id,
    );
    expect(row[0]).toEqual({
      name: 'Updated',
      status: 'PAUSED',
      start_at: '2026-10-10T00:00:00.000Z',
      end_at: '2026-10-20T23:59:59.999Z',
    });
  });

  it('rejects campaign periods where the end is before the start', async () => {
    const response = await handleBusinessRoute(
      jsonRequest(LIST, 'POST', {
        name: 'Invalid period',
        startAt: '2026-10-20T00:00:00.000Z',
        endAt: '2026-10-10T23:59:59.999Z',
      }, owner.token),
      env,
    );

    expect(response.status).toBe(400);
    expect((await body(response)).message).toBe('Validation failed.');
  });

  it('rejects moving a campaign start past its saved end date', async () => {
    const startAt = '2026-10-10T00:00:00.000Z';
    const endAt = '2026-10-20T23:59:59.999Z';
    const created = await body(
      await handleBusinessRoute(
        jsonRequest(LIST, 'POST', { name: 'Bounded campaign', startAt, endAt }, owner.token),
        env,
      ),
    );

    const response = await handleBusinessRoute(
      jsonRequest(`${LIST}/${created.campaign.id}`, 'PATCH', { startAt: '2026-10-21T00:00:00.000Z' }, owner.token),
      env,
    );

    expect(response.status).toBe(400);
    expect((await body(response)).message).toBe('End date must be on or after the start date.');
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

describe('campaign limit', () => {
  async function createDrafts(count: number): Promise<void> {
    for (let i = 1; i <= count; i++) {
      const response = await handleBusinessRoute(
        jsonRequest(LIST, 'POST', { name: `Campaign ${i}`, description: '' }, owner.token),
        env,
      );
      expect(response.status, `draft ${i}`).toBe(201);
    }
  }

  it('creates up to four campaigns and refuses the fifth', async () => {
    await createDrafts(4);

    const blocked = await handleBusinessRoute(
      jsonRequest(LIST, 'POST', { name: 'Campaign 5', description: '' }, owner.token),
      env,
    );
    expect(blocked.status).toBe(409);
    expect((await body(blocked)).message).toContain('at most 4 campaigns');
    expect(db.query(`SELECT id FROM campaigns`)).toHaveLength(4);
  });

  it('blocks duplicating a campaign once the cap is reached', async () => {
    await createDrafts(4);
    const source = db.query<{ id: string }>(`SELECT id FROM campaigns ORDER BY created_at ASC`)[0]!;

    const duplicate = await handleBusinessRoute(
      jsonRequest(`${LIST}/${source.id}/duplicate`, 'POST', undefined, owner.token),
      env,
    );
    expect(duplicate.status).toBe(409);
    expect(db.query(`SELECT id FROM campaigns`)).toHaveLength(4);
  });

  it('does not count archived campaigns against the cap', async () => {
    await createDrafts(4);
    const archived = db.query<{ id: string }>(`SELECT id FROM campaigns ORDER BY created_at ASC`)[0]!;
    db.prepare(`UPDATE campaigns SET status = 'ARCHIVED' WHERE id = ?`).bind(archived.id).run();

    const response = await handleBusinessRoute(
      jsonRequest(LIST, 'POST', { name: 'Campaign 5', description: '' }, owner.token),
      env,
    );
    expect(response.status).toBe(201);
    expect(db.query(`SELECT id FROM campaigns WHERE status <> 'ARCHIVED'`)).toHaveLength(4);
  });
});

describe('campaign coordinates (P2-7)', () => {
  it('resolves the selected place to coordinates on save and returns them', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      return new Response(JSON.stringify({ location: { latitude: 36.8065, longitude: 10.1815 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    env = { ...env, GOOGLE_MAPS_API_KEY: 'places-key.test' };

    const saved = await body(
      await handleBusinessRoute(jsonRequest(CONFIG, 'PUT', baseConfig(), owner.token), env),
    );
    expect(saved.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(requestUrl).toBe('https://places.googleapis.com/v1/places/ChIJtest');
    expect((requestInit.headers as Record<string, string>)['x-goog-api-key']).toBe('places-key.test');

    expect(db.query('SELECT latitude, longitude FROM campaigns')).toEqual([
      { latitude: 36.8065, longitude: 10.1815 },
    ]);

    const config = await body(
      await handleBusinessRoute(jsonRequest(CONFIG, 'GET', undefined, owner.token), env),
    );
    expect(config.campaign.latitude).toBe(36.8065);
    expect(config.campaign.longitude).toBe(10.1815);
  });

  it('never blocks the save when the lookup fails or no key is configured', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    env = { ...env, GOOGLE_MAPS_API_KEY: 'places-key.test' };

    const first = await body(
      await handleBusinessRoute(jsonRequest(CONFIG, 'PUT', baseConfig(), owner.token), env),
    );
    expect(first.success).toBe(true);
    expect(db.query('SELECT latitude, longitude FROM campaigns')).toEqual([
      { latitude: null, longitude: null },
    ]);

    // Without a key no call is attempted at all.
    const keylessFetch = vi.fn();
    vi.stubGlobal('fetch', keylessFetch);
    const keyless = { ...env } as { GOOGLE_MAPS_API_KEY?: string };
    delete keyless.GOOGLE_MAPS_API_KEY;
    const second = await body(
      await handleBusinessRoute(jsonRequest(CONFIG, 'PUT', baseConfig({ title: 'Renamed' }), owner.token), keyless as Env),
    );
    expect(second.success).toBe(true);
    expect(keylessFetch).not.toHaveBeenCalled();
    expect(db.query('SELECT latitude, longitude FROM campaigns')).toEqual([
      { latitude: null, longitude: null },
    ]);
  });
});

describe('POST /api/business/campaigns/:id/claims-expire', () => {
  async function createCampaignAndGetId(): Promise<string> {
    const created = await body(
      await handleBusinessRoute(
        jsonRequest(LIST, 'POST', { name: 'Claims test', description: 'claims expire' }, owner.token),
        env,
      ),
    );
    return created.campaign.id as string;
  }

  function insertClaim(campaignId: string, visitorKey: string, createdAt: string): void {
    db.prepare(
      `INSERT INTO spin_claims (id, campaign_id, visitor_key, created_at) VALUES (?, ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), campaignId, visitorKey, createdAt)
      .run();
  }

  it('deletes claims older than the cutoff and audits the action', async () => {
    const campaignId = await createCampaignAndGetId();
    insertClaim(campaignId, 'contact:old@example.test', '2020-01-01T00:00:00.000Z');
    insertClaim(campaignId, 'contact:new@example.test', '2999-01-01T00:00:00.000Z');

    const response = await handleBusinessRoute(
      jsonRequest(
        `${LIST}/${campaignId}/claims-expire`,
        'POST',
        { before: '2021-01-01T00:00:00.000Z' },
        owner.token,
      ),
      env,
    );

    expect(response.status).toBe(200);
    expect(await body(response)).toMatchObject({ success: true, expired: 1 });
    expect(db.query('SELECT visitor_key FROM spin_claims')).toEqual([
      { visitor_key: 'contact:new@example.test' },
    ]);
    expect(
      db.query('SELECT action, entity_id FROM audit_logs WHERE action = ?', 'campaign.claims_expired'),
    ).toEqual([{ action: 'campaign.claims_expired', entity_id: campaignId }]);
  });

  it('defaults to expiring every claim written before now', async () => {
    const campaignId = await createCampaignAndGetId();
    insertClaim(campaignId, 'contact:old@example.test', '2020-01-01T00:00:00.000Z');
    insertClaim(campaignId, 'visitor:still-fresh', new Date(Date.now() + 60_000).toISOString());

    const response = await handleBusinessRoute(
      jsonRequest(`${LIST}/${campaignId}/claims-expire`, 'POST', {}, owner.token),
      env,
    );

    expect(response.status).toBe(200);
    expect((await body(response)).expired).toBe(1);
    expect(db.query('SELECT visitor_key FROM spin_claims')).toEqual([
      { visitor_key: 'visitor:still-fresh' },
    ]);
  });

  it('cannot expire another business campaign claims', async () => {
    const campaignId = await createCampaignAndGetId();
    insertClaim(campaignId, 'contact:old@example.test', '2020-01-01T00:00:00.000Z');

    const response = await handleBusinessRoute(
      jsonRequest(`${LIST}/${campaignId}/claims-expire`, 'POST', {}, outsider.token),
      env,
    );

    expect(response.status).toBe(404);
    expect(db.query('SELECT id FROM spin_claims')).toHaveLength(1);
  });

  it('rejects a malformed before value', async () => {
    const campaignId = await createCampaignAndGetId();

    const response = await handleBusinessRoute(
      jsonRequest(`${LIST}/${campaignId}/claims-expire`, 'POST', { before: 'yesterday' }, owner.token),
      env,
    );

    expect(response.status).toBe(400);
    expect((await body(response)).message).toBe('Validation failed.');
  });
});
