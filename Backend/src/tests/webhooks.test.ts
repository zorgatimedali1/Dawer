import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Env } from '../types';
import { handleWebhookRoute } from '../routes/webhooks';
import { createTestEnv, type TestDatabase } from './helpers/d1';
import { seedMerchant } from './helpers/fixtures';

const VERIFY_URL = 'https://campaignflow-backend.test/api/webhooks/whatsapp';

function newEnv(): Env {
  return createTestEnv() as unknown as Env;
}

function verifyRequest(params: Record<string, string>): Request {
  const url = new URL(VERIFY_URL);
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }
  return new Request(url);
}

function signedEventRequest(raw: string, secret: string): Request {
  const signature = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
  return new Request(VERIFY_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
    body: raw,
  });
}

const sampleEvent = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [
    {
      changes: [
        {
          field: 'messages',
          value: {
            statuses: [{ id: 'wamid.HBgM', status: 'delivered' }],
            messages: [{ id: 'wamid.HBgN', type: 'text' }],
          },
        },
      ],
    },
  ],
});

describe('webhook route', () => {
  it('answers Meta\'s subscribe handshake with the challenge', async () => {
    const env = newEnv();
    const response = await handleWebhookRoute(
      verifyRequest({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'webhook-verify.test',
        'hub.challenge': '648291735',
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('648291735');
    expect(response.headers.get('content-type')).toContain('text/plain');
  });

  it('rejects a wrong verify token', async () => {
    const response = await handleWebhookRoute(
      verifyRequest({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'not-the-token',
        'hub.challenge': '648291735',
      }),
      newEnv(),
    );

    expect(response.status).toBe(403);
  });

  it('rejects a handshake when no verify token is configured', async () => {
    const env = newEnv();
    delete (env as { WHATSAPP_WEBHOOK_VERIFY_TOKEN?: string }).WHATSAPP_WEBHOOK_VERIFY_TOKEN;

    const response = await handleWebhookRoute(
      verifyRequest({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'webhook-verify.test',
        'hub.challenge': '648291735',
      }),
      env,
    );

    expect(response.status).toBe(503);
  });

  it('rejects a handshake with a mode other than subscribe', async () => {
    const response = await handleWebhookRoute(
      verifyRequest({
        'hub.mode': 'unsubscribe',
        'hub.verify_token': 'webhook-verify.test',
        'hub.challenge': '648291735',
      }),
      newEnv(),
    );

    expect(response.status).toBe(403);
  });

  it('accepts a correctly signed event POST', async () => {
    const env = newEnv();
    const response = await handleWebhookRoute(signedEventRequest(sampleEvent, 'meta-app-secret.test'), env);

    expect(response.status).toBe(200);
    expect((await response.json()) as Record<string, unknown>).toEqual({ success: true });
  });

  it('rejects an unsigned event POST when the app secret is configured', async () => {
    const env = newEnv();
    const response = await handleWebhookRoute(
      new Request(VERIFY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: sampleEvent,
      }),
      env,
    );

    expect(response.status).toBe(401);
  });

  it('rejects a forged signature', async () => {
    const env = newEnv();
    const response = await handleWebhookRoute(
      new Request(VERIFY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=deadbeef' },
        body: sampleEvent,
      }),
      env,
    );

    expect(response.status).toBe(401);
  });

  it('fails closed when no app secret is configured', async () => {
    const env = newEnv();
    delete (env as { META_APP_SECRET?: string }).META_APP_SECRET;

    const response = await handleWebhookRoute(
      new Request(VERIFY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: sampleEvent,
      }),
      env,
    );

    expect(response.status).toBe(503);
    expect((await response.json()) as Record<string, string>).toMatchObject({
      error: 'Webhook signature verification is not configured.',
    });
  });

  it('rejects a malformed event payload', async () => {
    const env = newEnv();
    const raw = '{not json';
    const signature = `sha256=${createHmac('sha256', 'meta-app-secret.test').update(raw).digest('hex')}`;

    const response = await handleWebhookRoute(
      new Request(VERIFY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
        body: raw,
      }),
      env,
    );

    expect(response.status).toBe(400);
  });

  it('404s unknown webhook paths', async () => {
    const response = await handleWebhookRoute(
      new Request('https://campaignflow-backend.test/api/webhooks/other'),
      newEnv(),
    );

    expect(response.status).toBe(404);
  });
});

function statusPayload(statuses: Array<{ id: string; status: string }>): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value: { statuses } }] }],
  });
}

async function seedCampaign(raw: TestDatabase): Promise<string> {
  const merchant = await seedMerchant(raw);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  raw.prepare(
    `INSERT INTO whatsapp_campaigns
       (id, business_id, user_id, template_name, template_language, recipients,
        total_recipients, status, created_at, updated_at)
     VALUES (?, ?, ?, 'promo_announcement', 'fr', '[]', 2, 'COMPLETED', ?, ?)`,
  )
    .bind(id, merchant.businessId, merchant.userId, now, now)
    .run();
  return id;
}

function seedLogRow(raw: TestDatabase, campaignId: string | null, wamid: string, status = 'sent'): void {
  const now = new Date().toISOString();
  raw.prepare(
    `INSERT INTO whatsapp_message_log (id, wamid, campaign_id, phone, status, created_at, updated_at)
     VALUES (?, ?, ?, '21622345678', ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), wamid, campaignId, status, now, now)
    .run();
}

function logRow(raw: TestDatabase, wamid: string) {
  return raw.query<{ status: string; campaign_id: string | null }>(
    'SELECT status, campaign_id FROM whatsapp_message_log WHERE wamid = ?',
    wamid,
  )[0];
}

function campaignCounters(raw: TestDatabase, id: string) {
  return raw.query<{ delivered_count: number; read_count: number }>(
    'SELECT delivered_count, read_count FROM whatsapp_campaigns WHERE id = ?',
    id,
  )[0];
}

describe('webhook status persistence', () => {
  function newDbEnv() {
    const testEnv = createTestEnv();
    return { raw: testEnv.DB, env: testEnv as unknown as Env };
  }

  async function post(env: Env, statuses: Array<{ id: string; status: string }>) {
    const response = await handleWebhookRoute(signedEventRequest(statusPayload(statuses), 'meta-app-secret.test'), env);
    expect(response.status).toBe(200);
  }

  it('persists statuses and rolls up per-campaign counters', async () => {
    const { raw, env } = newDbEnv();
    const campaignId = await seedCampaign(raw);
    seedLogRow(raw, campaignId, 'wamid.A');
    seedLogRow(raw, campaignId, 'wamid.B');

    await post(env, [
      { id: 'wamid.A', status: 'delivered' },
      { id: 'wamid.B', status: 'read' },
    ]);

    expect(logRow(raw, 'wamid.A').status).toBe('delivered');
    expect(logRow(raw, 'wamid.B').status).toBe('read');
    expect(campaignCounters(raw, campaignId)).toMatchObject({ delivered_count: 2, read_count: 1 });
    raw.close();
  });

  it('never downgrades a status out of order', async () => {
    const { raw, env } = newDbEnv();
    const campaignId = await seedCampaign(raw);
    seedLogRow(raw, campaignId, 'wamid.A', 'read');

    await post(env, [{ id: 'wamid.A', status: 'delivered' }]);

    expect(logRow(raw, 'wamid.A').status).toBe('read');
    // Nothing advanced, so the rollup must not have invented a counter.
    expect(campaignCounters(raw, campaignId)).toMatchObject({ delivered_count: 0, read_count: 0 });
    raw.close();
  });

  it('keeps statuses for messages it never logged', async () => {
    const { raw, env } = newDbEnv();
    const campaignId = await seedCampaign(raw);

    await post(env, [{ id: 'wamid.unknown', status: 'delivered' }]);

    expect(logRow(raw, 'wamid.unknown')).toMatchObject({ status: 'delivered', campaign_id: null });
    expect(campaignCounters(raw, campaignId)).toMatchObject({ delivered_count: 0 });
    raw.close();
  });

  it('dedupes a repeated wamid in one payload on its highest rank', async () => {
    const { raw, env } = newDbEnv();
    const campaignId = await seedCampaign(raw);
    seedLogRow(raw, campaignId, 'wamid.A');

    await post(env, [
      { id: 'wamid.A', status: 'read' },
      { id: 'wamid.A', status: 'delivered' },
    ]);

    expect(logRow(raw, 'wamid.A').status).toBe('read');
    const rows = raw.query<{ id: string }>('SELECT id FROM whatsapp_message_log WHERE wamid = ?', 'wamid.A');
    expect(rows).toHaveLength(1);
    expect(campaignCounters(raw, campaignId)).toMatchObject({ delivered_count: 1, read_count: 1 });
    raw.close();
  });

  it('handles payloads past the IN-list parameter cap', async () => {
    const { raw, env } = newDbEnv();
    const campaignId = await seedCampaign(raw);
    const wamids = Array.from({ length: 120 }, (_unused, index) => `wamid.chunk.${index}`);
    for (const wamid of wamids) seedLogRow(raw, campaignId, wamid);

    await post(
      env,
      wamids.map((wamid) => ({ id: wamid, status: 'delivered' })),
    );

    const pending = wamids.filter((wamid) => logRow(raw, wamid).status !== 'delivered');
    expect(pending).toEqual([]);
    expect(campaignCounters(raw, campaignId)).toMatchObject({ delivered_count: 120, read_count: 0 });
    raw.close();
  });
});
