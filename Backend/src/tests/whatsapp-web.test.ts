import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import type { Env } from '../types';
import { handleWhatsAppWebRoute } from '../routes/whatsapp-web';
import { createTestEnv, type TestDatabase } from './helpers/d1';
import { jsonRequest, seedMerchant, type SeededMerchant } from './helpers/fixtures';

let db: TestDatabase;
let env: Env;
let merchant: SeededMerchant;

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/** Mirrors gatewayTokens() in the route — the same HMAC both sides must agree on. */
function gatewayToken(purpose: 'wgt' | 'wgt-pair', businessId?: string, secret = 'gw-secret'): string {
  const id = businessId ?? merchant.businessId;
  return `${id}.${createHmac('sha256', secret).update(`${purpose}:${id}`).digest('hex')}`;
}

async function body(response: Response) {
  return (await response.json()) as Record<string, any>;
}

function setCounter(sent: number, month = currentMonth()) {
  db.prepare(`UPDATE subscriptions SET whatsapp_messages_sent_this_month = ?, whatsapp_usage_month = ? WHERE business_id = ?`)
    .bind(sent, month, merchant.businessId)
    .run();
}

function readCounter() {
  return db.query<{ sent: number; month: string | null }>(
    `SELECT whatsapp_messages_sent_this_month AS sent, whatsapp_usage_month AS month
     FROM subscriptions WHERE business_id = ?`,
    merchant.businessId,
  )[0];
}

function setGateway() {
  Object.assign(env, {
    GATEWAY_URL: 'https://gateway.test',
    GATEWAY_SECRET: 'gw-secret',
    WHATSAPP_WEB_CALLBACK_SECRET: 'cb-secret',
  });
}

function stubGatewayFetch(impl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const mock = vi.fn(impl ?? (async () => new Response('{"state":"READY"}', { status: 200 })));
  vi.stubGlobal('fetch', mock);
  return mock;
}

function webBroadcast(recipientCount = 2) {
  return {
    recipients: Array.from({ length: recipientCount }, (_unused, index) => ({
      name: `Contact ${index + 1}`,
      phone: `216223456${String(10 + index).padStart(2, '0')}`,
      prize: `Prize ${index + 1}`,
    })),
  };
}

function seedWebCampaign(
  overrides: {
    status?: string;
    sent?: number;
    failed?: number;
    total?: number;
    recipients?: Array<{ name?: string; phone: string; prize?: string }>;
    message?: string;
  } = {},
): string {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const recipients =
    overrides.recipients ?? Array.from({ length: overrides.total ?? 3 }, (_unused, index) => ({
      name: `Winner ${index + 1}`,
      phone: `21622345678${index}`,
      prize: 'Coffee',
    }));
  db.prepare(
    `INSERT INTO whatsapp_web_campaigns
       (id, business_id, user_id, message, recipients, total_recipients, sent_count, failed_count,
        status, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  )
    .bind(
      id,
      merchant.businessId,
      merchant.userId,
      overrides.message ?? 'Hello {name}',
      JSON.stringify(recipients),
      overrides.total ?? recipients.length,
      overrides.sent ?? 0,
      overrides.failed ?? 0,
      overrides.status ?? 'PROCESSING',
      now,
      now,
    )
    .run();
  return id;
}

function callbackRequest(payload: unknown, secret: string | null = 'cb-secret'): Request {
  return new Request('https://example.test/api/whatsapp-web/internal/progress', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret ? { 'x-callback-secret': secret } : {}),
    },
    body: JSON.stringify(payload),
  });
}

function seedWinner(options: { phone: string | null; firstName?: string; lastName?: string; ageMs?: number }) {
  const now = new Date(Date.now() - (options.ageMs ?? 0)).toISOString();
  const campaignId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO campaigns (id, business_id, name, public_code, status, created_at, updated_at)
     VALUES (?, ?, 'Summer Wheel', ?, 'LIVE', ?, ?)`,
  )
    .bind(campaignId, merchant.businessId, `code-${campaignId.slice(0, 8)}`, now, now)
    .run();

  const rewardId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO rewards (id, business_id, campaign_id, name, type, weight, created_at, updated_at)
     VALUES (?, ?, ?, 'Free coffee', 'custom_reward', 1, ?, ?)`,
  )
    .bind(rewardId, merchant.businessId, campaignId, now, now)
    .run();

  const customerId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO customers (id, business_id, first_name, last_name, phone, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      customerId,
      merchant.businessId,
      options.firstName ?? 'Ada',
      options.lastName ?? 'Lovelace',
      options.phone,
      now,
      now,
    )
    .run();

  db.prepare(
    `INSERT INTO coupons (id, business_id, campaign_id, customer_id, reward_id, code, status, issued_at)
     VALUES (?, ?, ?, ?, ?, ?, 'ISSUED', ?)`,
  )
    .bind(crypto.randomUUID(), merchant.businessId, campaignId, customerId, rewardId, `CPN-${crypto.randomUUID()}`, now).run();

  return campaignId;
}

beforeEach(async () => {
  const testEnv = createTestEnv();
  db = testEnv.DB;
  env = testEnv as unknown as Env;
  merchant = await seedMerchant(db, {
    email: 'wa-web-merchant@example.test',
    withActiveSubscription: true,
    planId: 'plan_growth',
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  db.close();
});

describe('GET /api/whatsapp-web/status', () => {
  it('401s without a session', async () => {
    const response = await handleWhatsAppWebRoute(jsonRequest('/api/whatsapp-web/status', 'GET'), env);
    expect(response.status).toBe(401);
  });

  it('reports plan quota plus gateway reachability', async () => {
    setGateway();
    stubGatewayFetch();
    setCounter(40);

    const response = await handleWhatsAppWebRoute(jsonRequest('/api/whatsapp-web/status', 'GET', undefined, merchant.token), env);
    expect(response.status).toBe(200);
    const payload = await body(response);
    expect(payload.status).toMatchObject({
      allowed: true,
      planSlug: 'growth',
      monthlyLimit: 200,
      batchLimit: 100,
      sentThisMonth: 40,
      remaining: 160,
      gateway: { configured: true, reachable: true, state: 'READY', qr: null, pairUrl: `https://gateway.test/pair?key=${gatewayToken('wgt-pair')}` },
    });
  });

  it('surfaces the pairing QR and pair link while the gateway is unpaired', async () => {
    setGateway();
    const qr = 'data:image/png;base64,iVBORw0KGgo=';
    stubGatewayFetch(async () => new Response(JSON.stringify({ state: 'PAIRING', qr }), { status: 200 }));

    const response = await handleWhatsAppWebRoute(jsonRequest('/api/whatsapp-web/status', 'GET', undefined, merchant.token), env);
    expect(response.status).toBe(200);
    const payload = await body(response);
    expect(payload.status.gateway).toEqual({
      configured: true,
      reachable: true,
      state: 'PAIRING',
      qr,
      pairUrl: `https://gateway.test/pair?key=${gatewayToken('wgt-pair')}`,
    });
  });

  it('reports the gateway as unconfigured when secrets are missing', async () => {
    const response = await handleWhatsAppWebRoute(jsonRequest('/api/whatsapp-web/status', 'GET', undefined, merchant.token), env);
    const payload = await body(response);
    expect(payload.status.gateway).toEqual({ configured: false, reachable: false, state: null, qr: null, pairUrl: null });
  });

  it('never exposes the platform secret; the pair link is a pair-only token', async () => {
    setGateway();
    stubGatewayFetch();

    const response = await handleWhatsAppWebRoute(jsonRequest('/api/whatsapp-web/status', 'GET', undefined, merchant.token), env);
    const payload = await body(response);
    const pairUrl = payload.status.gateway.pairUrl as string;
    expect(pairUrl).not.toContain('gw-secret');
    const key = new URL(pairUrl).searchParams.get('key');
    expect(key).toBe(gatewayToken('wgt-pair'));
    expect(key).not.toBe(gatewayToken('wgt'));
    expect(key?.startsWith(`${merchant.businessId}.`)).toBe(true);
  });

  it('blocks a workspace outside the gateway allowlist without calling the gateway', async () => {
    setGateway();
    env.WHATSAPP_WEB_ALLOWLIST = '00000000-0000-4000-8000-000000000000';
    const fetchMock = stubGatewayFetch();

    const response = await handleWhatsAppWebRoute(jsonRequest('/api/whatsapp-web/status', 'GET', undefined, merchant.token), env);
    const payload = await body(response);
    expect(payload.status.gateway).toEqual({ configured: false, reachable: false, state: null, qr: null, pairUrl: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows a workspace listed in the gateway allowlist', async () => {
    setGateway();
    env.WHATSAPP_WEB_ALLOWLIST = ` 00000000-0000-4000-8000-000000000000, ${merchant.businessId} `;
    stubGatewayFetch();

    const response = await handleWhatsAppWebRoute(jsonRequest('/api/whatsapp-web/status', 'GET', undefined, merchant.token), env);
    const payload = await body(response);
    expect(payload.status.gateway).toMatchObject({ configured: true, reachable: true, state: 'READY' });
  });
});

describe('GET /api/whatsapp-web/winners', () => {
  it('lists issued winners with phone, excluding anonymous and already-messaged numbers', async () => {
    seedWinner({ phone: '22345678', ageMs: 0 });
    seedWinner({ phone: null, ageMs: 1000 });
    seedWinner({ phone: '33 1 23 45 67 89', firstName: 'Marie', ageMs: 2000 });

    const alreadyMessaged = seedWinner({ phone: '99887766', ageMs: 3000 });
    db.prepare(
      `INSERT INTO whatsapp_web_message_log
         (id, campaign_id, business_id, phone, phone_normalized, status, created_at)
       VALUES (?, ?, ?, '99887766', '21699887766', 'sent', ?)`,
    )
      .bind(crypto.randomUUID(), alreadyMessaged, merchant.businessId, new Date().toISOString())
      .run();

    const response = await handleWhatsAppWebRoute(jsonRequest('/api/whatsapp-web/winners', 'GET', undefined, merchant.token), env);
    expect(response.status).toBe(200);
    const payload = await body(response);
    expect(payload.winners).toHaveLength(2);
    expect(payload.winners.map((winner: { phone: string }) => winner.phone)).toEqual(['22345678', '33 1 23 45 67 89']);
    expect(payload.winners[0]).toMatchObject({ name: 'Ada Lovelace', prize: 'Free coffee' });
  });
});

describe('POST /api/whatsapp-web/broadcast', () => {
  it('401s without a session', async () => {
    const response = await handleWhatsAppWebRoute(
      jsonRequest('/api/whatsapp-web/broadcast', 'POST', webBroadcast()),
      env,
    );
    expect(response.status).toBe(401);
  });

  it('403s for plans without WhatsApp access', async () => {
    setGateway();
    const starter = await seedMerchant(db, {
      email: 'starter@example.test',
      withActiveSubscription: true,
      planId: 'plan_starter',
    });

    const response = await handleWhatsAppWebRoute(
      jsonRequest('/api/whatsapp-web/broadcast', 'POST', webBroadcast(), starter.token),
      env,
    );
    expect(response.status).toBe(403);
    expect((await body(response)).error).toContain('require a Pro or Business plan');
  });

  it('400s on an invalid phone', async () => {
    setGateway();
    const response = await handleWhatsAppWebRoute(
      jsonRequest('/api/whatsapp-web/broadcast', 'POST', {
        recipients: [{ name: 'Bad', phone: '123' }],
      }, merchant.token),
      env,
    );
    expect(response.status).toBe(400);
    expect((await body(response)).error).toContain('Invalid phone number for recipient #1');
  });

  it('403s when the batch exceeds the per-broadcast cap', async () => {
    setGateway();
    const payload = {
      recipients: Array.from({ length: 101 }, (_unused, index) => ({
        phone: `216223456${String(index).padStart(3, '0')}`,
      })),
    };
    const response = await handleWhatsAppWebRoute(
      jsonRequest('/api/whatsapp-web/broadcast', 'POST', payload, merchant.token),
      env,
    );
    expect(response.status).toBe(403);
    expect((await body(response)).error).toBe('PRO plan allows 100 recipients per broadcast.');
  });

  it('403s when the monthly quota cannot absorb the batch', async () => {
    setGateway();
    setCounter(199);
    const response = await handleWhatsAppWebRoute(
      jsonRequest('/api/whatsapp-web/broadcast', 'POST', webBroadcast(2), merchant.token),
      env,
    );
    expect(response.status).toBe(403);
    expect((await body(response)).error).toBe('PRO plan limit reached. Upgrade to Business for 1000 messages');
    expect(readCounter().sent).toBe(199);
    expect(db.query(`SELECT id FROM whatsapp_web_campaigns`)).toHaveLength(0);
  });

  it('409s while another Web broadcast is active', async () => {
    setGateway();
    seedWebCampaign({ status: 'PROCESSING' });
    const response = await handleWhatsAppWebRoute(
      jsonRequest('/api/whatsapp-web/broadcast', 'POST', webBroadcast(), merchant.token),
      env,
    );
    expect(response.status).toBe(409);
    expect(readCounter().sent).toBe(0);
  });

  it('queues the campaign, reserves quota, and hands the payload to the gateway', async () => {
    setGateway();
    const fetchMock = stubGatewayFetch();

    const response = await handleWhatsAppWebRoute(
      jsonRequest('/api/whatsapp-web/broadcast', 'POST', webBroadcast(2), merchant.token),
      env,
    );
    expect(response.status).toBe(202);
    const payload = await body(response);
    expect(payload.campaign.status).toBe('PROCESSING');
    expect(payload.campaign.totalRecipients).toBe(2);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [statusUrl, statusInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(statusUrl)).toBe('https://gateway.test/api/status');
    expect((statusInit.headers as Record<string, string>).authorization).toBe(`Bearer ${gatewayToken('wgt')}`);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(String(url)).toBe('https://gateway.test/api/broadcast-pool');
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${gatewayToken('wgt')}`);
    const handed = JSON.parse(String(init.body));
    expect(handed.campaignId).toBe(payload.campaign.id);
    expect(handed.recipients).toHaveLength(2);
    expect(handed.recipients[0]).toMatchObject({ name: 'Contact 1', prize: 'Prize 1' });
    expect(handed.message).toContain('{prize}');

    const row = db.query<{ status: string; total_recipients: number; sent_count: number }>(
      `SELECT status, total_recipients, sent_count FROM whatsapp_web_campaigns WHERE id = ?`,
      payload.campaign.id,
    )[0];
    expect(row).toMatchObject({ status: 'PROCESSING', total_recipients: 2, sent_count: 0 });
    expect(readCounter().sent).toBe(2);

    const audit = db.query(`SELECT id FROM audit_logs WHERE action = 'whatsapp_web.broadcast.started'`);
    expect(audit).toHaveLength(1);
  });

  it('marks the campaign FAILED and refunds the reservation when the gateway is offline', async () => {
    setGateway();
    stubGatewayFetch(async () => {
      throw new Error('connection refused');
    });
    setCounter(0);

    const response = await handleWhatsAppWebRoute(
      jsonRequest('/api/whatsapp-web/broadcast', 'POST', webBroadcast(2), merchant.token),
      env,
    );
    expect(response.status).toBe(503);
    expect((await body(response)).error).toBe('Web gateway is offline.');

    const row = db.query<{ status: string; last_error: string | null }>(
      `SELECT status, last_error FROM whatsapp_web_campaigns`,
    )[0];
    expect(row.status).toBe('FAILED');
    expect(row.last_error).toBe('Web gateway is offline.');
    expect(readCounter().sent).toBe(0);
  });

  it('503s when no gateway is configured', async () => {
    const response = await handleWhatsAppWebRoute(
      jsonRequest('/api/whatsapp-web/broadcast', 'POST', webBroadcast(), merchant.token),
      env,
    );
    expect(response.status).toBe(503);
    expect((await body(response)).error).toBe('WhatsApp Web gateway is not configured.');
  });

  it('503s without reserving quota while the session is still pairing', async () => {
    setGateway();
    stubGatewayFetch(async () => new Response('{"state":"PAIRING"}', { status: 200 }));

    const response = await handleWhatsAppWebRoute(
      jsonRequest('/api/whatsapp-web/broadcast', 'POST', webBroadcast(2), merchant.token),
      env,
    );
    expect(response.status).toBe(503);
    expect((await body(response)).error).toBe(
      'WhatsApp session is not ready. Scan the pairing QR in the gateway first.',
    );
    expect(db.query(`SELECT id FROM whatsapp_web_campaigns`)).toHaveLength(0);
    expect(readCounter().sent).toBe(0);
  });

  it('403s a workspace outside the gateway allowlist before reserving quota', async () => {
    setGateway();
    env.WHATSAPP_WEB_ALLOWLIST = '00000000-0000-4000-8000-000000000000';
    const fetchMock = stubGatewayFetch();

    const response = await handleWhatsAppWebRoute(
      jsonRequest('/api/whatsapp-web/broadcast', 'POST', webBroadcast(2), merchant.token),
      env,
    );
    expect(response.status).toBe(403);
    expect((await body(response)).error).toBe('WhatsApp Web is not enabled for this workspace.');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.query(`SELECT id FROM whatsapp_web_campaigns`)).toHaveLength(0);
    expect(readCounter().sent).toBe(0);
  });
});

describe('POST /api/whatsapp-web/internal/progress', () => {
  it('rejects a missing or wrong callback secret', async () => {
    setGateway();
    const payload = { campaignId: 'x', event: 'complete' };
    const missing = await handleWhatsAppWebRoute(callbackRequest(payload, null), env);
    expect(missing.status).toBe(403);
    const wrong = await handleWhatsAppWebRoute(callbackRequest(payload, 'nope'), env);
    expect(wrong.status).toBe(403);
  });

  it('records sent and failed deliveries and flips the first progress to PROCESSING', async () => {
    setGateway();
    const campaignId = seedWebCampaign({ status: 'QUEUED', total: 3, sent: 0, failed: 0 });

    const sent = await handleWhatsAppWebRoute(
      callbackRequest({ campaignId, event: 'progress', phone: '216223456780', ok: true }),
      env,
    );
    expect(sent.status).toBe(200);

    const failed = await handleWhatsAppWebRoute(
      callbackRequest({ campaignId, event: 'progress', phone: '216223456781', ok: false, error: 'not on whatsapp' }),
      env,
    );
    expect(failed.status).toBe(200);

    const row = db.query<{ status: string; sent_count: number; failed_count: number }>(
      `SELECT status, sent_count, failed_count FROM whatsapp_web_campaigns WHERE id = ?`,
      campaignId,
    )[0];
    expect(row).toMatchObject({ status: 'PROCESSING', sent_count: 1, failed_count: 1 });

    const log = db.query<{ status: string; error: string | null }>(
      `SELECT status, error FROM whatsapp_web_message_log WHERE campaign_id = ? ORDER BY status`,
      campaignId,
    );
    expect(log).toHaveLength(2);
    expect(log.map((entry) => entry.status)).toEqual(['failed', 'sent']);
  });

  it('completes the campaign and ignores late progress callbacks', async () => {
    setGateway();
    const campaignId = seedWebCampaign({ status: 'PROCESSING', total: 2, sent: 1 });

    const complete = await handleWhatsAppWebRoute(callbackRequest({ campaignId, event: 'complete' }), env);
    expect(complete.status).toBe(200);

    const late = await handleWhatsAppWebRoute(
      callbackRequest({ campaignId, event: 'progress', phone: '216223456780', ok: true }),
      env,
    );
    expect((await body(late)).ignored).toBe(true);

    const row = db.query<{ status: string; sent_count: number }>(
      `SELECT status, sent_count FROM whatsapp_web_campaigns WHERE id = ?`,
      campaignId,
    )[0];
    expect(row).toMatchObject({ status: 'COMPLETED', sent_count: 1 });
  });

  it('marks the campaign FAILED and refunds the unattempted reservation', async () => {
    setGateway();
    const campaignId = seedWebCampaign({ status: 'PROCESSING', total: 5, sent: 1, failed: 0 });
    setCounter(5);

    const response = await handleWhatsAppWebRoute(
      callbackRequest({ campaignId, event: 'failed', error: 'WhatsApp session is not ready.' }),
      env,
    );
    expect(response.status).toBe(200);

    const row = db.query<{ status: string; last_error: string }>(
      `SELECT status, last_error FROM whatsapp_web_campaigns WHERE id = ?`,
      campaignId,
    )[0];
    expect(row.status).toBe('FAILED');
    expect(row.last_error).toBe('WhatsApp session is not ready.');
    expect(readCounter().sent).toBe(1);
  });
});

describe('POST /api/whatsapp-web/campaigns/:id/cancel', () => {
  it('cancels an active campaign and refunds unattempted messages', async () => {
    setGateway();
    const campaignId = seedWebCampaign({ status: 'PROCESSING', total: 5, sent: 1, failed: 0 });
    setCounter(5);

    const response = await handleWhatsAppWebRoute(
      jsonRequest(`/api/whatsapp-web/campaigns/${campaignId}/cancel`, 'POST', undefined, merchant.token),
      env,
    );
    expect(response.status).toBe(200);
    const payload = await body(response);
    expect(payload.campaign.status).toBe('CANCELLED');
    expect(readCounter().sent).toBe(1);
  });

  it('409s for campaigns that are not active', async () => {
    const campaignId = seedWebCampaign({ status: 'COMPLETED' });
    const response = await handleWhatsAppWebRoute(
      jsonRequest(`/api/whatsapp-web/campaigns/${campaignId}/cancel`, 'POST', undefined, merchant.token),
      env,
    );
    expect(response.status).toBe(409);
  });
});

describe('POST /api/whatsapp-web/campaigns/:id/resume', () => {
  it('re-hands only recipients without a delivered message log', async () => {
    setGateway();
    const fetchMock = stubGatewayFetch();
    const campaignId = seedWebCampaign({
      status: 'FAILED',
      recipients: [
        { name: 'Delivered', phone: '216223456780', prize: 'Coffee' },
        { name: 'Pending', phone: '216223456781', prize: 'Cake' },
      ],
    });
    db.prepare(
      `INSERT INTO whatsapp_web_message_log
         (id, campaign_id, business_id, phone, phone_normalized, status, created_at)
       VALUES (?, ?, ?, '216223456780', '216223456780', 'sent', ?)`,
    )
      .bind(crypto.randomUUID(), campaignId, merchant.businessId, new Date().toISOString())
      .run();

    const response = await handleWhatsAppWebRoute(
      jsonRequest(`/api/whatsapp-web/campaigns/${campaignId}/resume`, 'POST', undefined, merchant.token),
      env,
    );
    expect(response.status).toBe(200);
    expect((await body(response)).campaign.status).toBe('PROCESSING');

    const poolCall = fetchMock.mock.calls.find(
      (call) => String((call as unknown as [RequestInfo, RequestInit])[0]).endsWith('/api/broadcast-pool'),
    );
    expect(poolCall).toBeTruthy();
    const handed = JSON.parse(String((poolCall as unknown as [RequestInfo, RequestInit])[1]?.body));
    expect(handed.recipients).toHaveLength(1);
    expect(handed.recipients[0].phone).toBe('216223456781');
  });

  it('503s on resume while the session is still pairing', async () => {
    setGateway();
    const fetchMock = stubGatewayFetch(async () => new Response('{"state":"PAIRING"}', { status: 200 }));
    const campaignId = seedWebCampaign({
      status: 'FAILED',
      recipients: [{ name: 'Pending', phone: '216223456781' }],
    });

    const response = await handleWhatsAppWebRoute(
      jsonRequest(`/api/whatsapp-web/campaigns/${campaignId}/resume`, 'POST', undefined, merchant.token),
      env);
    expect(response.status).toBe(503);
    expect((await body(response)).error).toBe('WhatsApp session is not ready. Scan the pairing QR in the gateway first.');

    const row = db.query<{ status: string }>('SELECT status FROM whatsapp_web_campaigns WHERE id = ?', campaignId)[0];
    expect(row.status).toBe('FAILED');
    const dispatched = fetchMock.mock.calls.some(
      (call) => String((call as unknown as [RequestInfo, RequestInit])[0]).endsWith('/api/broadcast-pool'),
    );
    expect(dispatched).toBe(false);
  });

  it('403s resume when the workspace is outside the gateway allowlist', async () => {
    setGateway();
    env.WHATSAPP_WEB_ALLOWLIST = '00000000-0000-4000-8000-000000000000';
    const fetchMock = stubGatewayFetch();
    const campaignId = seedWebCampaign({
      status: 'FAILED',
      recipients: [{ name: 'Pending', phone: '216223456781' }],
    });

    const response = await handleWhatsAppWebRoute(
      jsonRequest(`/api/whatsapp-web/campaigns/${campaignId}/resume`, 'POST', undefined, merchant.token),
      env,
    );
    expect(response.status).toBe(403);
    expect((await body(response)).error).toBe('WhatsApp Web is not enabled for this workspace.');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.query<{ status: string }>('SELECT status FROM whatsapp_web_campaigns WHERE id = ?', campaignId)[0].status).toBe('FAILED');
  });

  it('409s when every recipient already received the message', async () => {
    setGateway();
    stubGatewayFetch();
    const campaignId = seedWebCampaign({
      status: 'FAILED',
      recipients: [{ name: 'Delivered', phone: '216223456780' }],
    });
    db.prepare(
      `INSERT INTO whatsapp_web_message_log
         (id, campaign_id, business_id, phone, phone_normalized, status, created_at)
       VALUES (?, ?, ?, '216223456780', '216223456780', 'sent', ?)`,
    )
      .bind(crypto.randomUUID(), campaignId, merchant.businessId, new Date().toISOString())
      .run();

    const response = await handleWhatsAppWebRoute(
      jsonRequest(`/api/whatsapp-web/campaigns/${campaignId}/resume`, 'POST', undefined, merchant.token),
      env,
    );
    expect(response.status).toBe(409);
    expect((await body(response)).error).toContain('No unsent recipients');
  });

  it('409s on resume while another Web broadcast is active', async () => {
    setGateway();
    stubGatewayFetch();
    const failedId = seedWebCampaign({
      status: 'FAILED',
      recipients: [{ name: 'Pending', phone: '216223456781' }],
    });
    seedWebCampaign({ status: 'PROCESSING', recipients: [{ name: 'Running', phone: '216223456782' }] });

    const response = await handleWhatsAppWebRoute(
      jsonRequest(`/api/whatsapp-web/campaigns/${failedId}/resume`, 'POST', undefined, merchant.token),
      env,
    );
    expect(response.status).toBe(409);
    expect((await body(response)).error).toContain('already in progress');
  });
});

describe('GET /api/whatsapp-web/broadcast', () => {
  it('lists the business campaign history', async () => {
    seedWebCampaign({ status: 'COMPLETED', total: 3, sent: 3 });
    const response = await handleWhatsAppWebRoute(
      jsonRequest('/api/whatsapp-web/broadcast', 'GET', undefined, merchant.token),
      env,
    );
    expect(response.status).toBe(200);
    const payload = await body(response);
    expect(payload.campaigns).toHaveLength(1);
    expect(payload.campaigns[0]).toMatchObject({ status: 'COMPLETED', totalRecipients: 3, sent: 3 });
  });
});
