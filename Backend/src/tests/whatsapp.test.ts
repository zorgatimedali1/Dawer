import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../types';
import { handleWhatsAppRoute } from '../routes/whatsapp';
import { processBroadcastBatch, effectiveBatchSize } from '../durable/whatsapp-batch';
import { clearWhatsAppTemplateCache, normalizePhone, sendTemplateMessage } from '../lib/whatsapp';
import { createTestEnv, type TestDatabase } from './helpers/d1';
import { bearer, jsonRequest, seedMerchant, type SeededMerchant } from './helpers/fixtures';

let db: TestDatabase;
let env: Env;
let merchant: SeededMerchant;

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

async function body(response: Response) {
  return (await response.json()) as Record<string, any>;
}

function validBroadcast(recipientCount = 2) {
  return {
    recipients: Array.from({ length: recipientCount }, (_unused, index) => ({
      name: `Contact ${index + 1}`,
      phone: `216223456${String(10 + index).padStart(2, '0')}`,
    })),
    templateName: 'promo_announcement',
    language: 'fr',
    variables: ['Bonjour', 'https://promo.test'],
  };
}

function setCounter(sent: number, month = currentMonth()) {
  db.prepare(`UPDATE subscriptions SET whatsapp_messages_sent_this_month = ?, whatsapp_usage_month = ? WHERE business_id = ?`)
    .bind(sent, month, merchant.businessId)
    .run();
}

/** Test controls exposed by the stand-in pacing registry (helpers/d1). */
function pacingControls(): { block(ms?: number): void; unblock(): void } {
  return env.WHATSAPP_PACING as unknown as { block(ms?: number): void; unblock(): void };
}

function readCounter() {
  return db.query<{ sent: number; month: string | null }>(
    `SELECT whatsapp_messages_sent_this_month AS sent, whatsapp_usage_month AS month
     FROM subscriptions WHERE business_id = ?`,
    merchant.businessId,
  )[0];
}

async function insertBroadcast(
  recipients: Array<{ name?: string; phone: string }>,
  overrides: { status?: string; sent?: number; failed?: number; total?: number } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO whatsapp_campaigns
       (id, business_id, user_id, template_name, template_language, variables, recipients,
        total_recipients, sent_count, failed_count, status, created_at, updated_at)
     VALUES (?, ?, ?, 'promo_announcement', 'fr', ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      merchant.businessId,
      merchant.userId,
      JSON.stringify(['Bonjour', 'https://promo.test']),
      JSON.stringify(recipients),
      overrides.total ?? recipients.length,
      overrides.sent ?? 0,
      overrides.failed ?? 0,
      overrides.status ?? 'PENDING',
      now,
      now,
    )
    .run();
  return id;
}

function metaResponse(status = 200) {
  return new Response(JSON.stringify({ messages: [{ id: 'wamid.test' }] }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function metaErrorResponse(status: number, code: number) {
  return new Response(JSON.stringify({ error: { message: 'Meta error.', type: 'OAuthException', code } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(async () => {
  const testEnv = createTestEnv();
  db = testEnv.DB;
  env = testEnv as unknown as Env;
  merchant = await seedMerchant(db, {
    email: 'wa-merchant@example.test',
    withActiveSubscription: true,
    planId: 'plan_growth',
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearWhatsAppTemplateCache();
  db.close();
});

describe('normalizePhone', () => {
  it('maps local Tunisian forms onto 216XXXXXXXX', () => {
    expect(normalizePhone('21622345678')).toBe('21622345678');
    expect(normalizePhone('+216 22 345 678')).toBe('21622345678');
    expect(normalizePhone('0021622345678')).toBe('21622345678');
    expect(normalizePhone('22345678')).toBe('21622345678');
    expect(normalizePhone('022345678')).toBe('21622345678');
    expect(normalizePhone('33 1 23 45 67 89')).toBe('33123456789');
  });

  it('rejects numbers outside the valid digit range', () => {
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('1234567890123456')).toBeNull();
  });
});

describe('POST /api/whatsapp/broadcast', () => {
  it('401s without an authentication token', async () => {
    const response = await handleWhatsAppRoute(jsonRequest('/api/whatsapp/broadcast', 'POST', validBroadcast()), env);
    expect(response.status).toBe(401);
  });

  it('rejects Starter accounts with an upgrade message', async () => {
    const starter = await seedMerchant(db, {
      email: 'starter@example.test',
      withActiveSubscription: true,
      planId: 'plan_starter',
    });

    const response = await handleWhatsAppRoute(
      jsonRequest('/api/whatsapp/broadcast', 'POST', validBroadcast(), starter.token),
      env,
    );

    expect(response.status).toBe(403);
    expect((await body(response)).error).toContain('require a Pro or Business plan');
  });

  it('rejects read-only accounts', async () => {
    db.prepare(`UPDATE subscriptions SET status = 'expired' WHERE business_id = ?`).bind(merchant.businessId).run();

    const response = await handleWhatsAppRoute(
      jsonRequest('/api/whatsapp/broadcast', 'POST', validBroadcast(), merchant.token),
      env,
    );

    expect(response.status).toBe(403);
    expect((await body(response)).error).toContain('read-only');
  });

  it('503s when WhatsApp credentials are missing', async () => {
    const testEnv = env as unknown as Record<string, unknown>;
    delete testEnv.WHATSAPP_TOKEN;
    delete testEnv.WHATSAPP_PHONE_ID;

    const response = await handleWhatsAppRoute(
      jsonRequest('/api/whatsapp/broadcast', 'POST', validBroadcast(), merchant.token),
      env,
    );

    expect(response.status).toBe(503);
    expect((await body(response)).error).toContain('not configured');
  });

  it('creates a PENDING broadcast, reserves quota and kicks the sender', async () => {
    const payload = {
      ...validBroadcast(2),
      recipients: [
        { name: 'Ada', phone: '+216 22 345 678' },
        { name: 'Bo', phone: '22345679' },
      ],
    };

    const response = await handleWhatsAppRoute(
      jsonRequest('/api/whatsapp/broadcast', 'POST', payload, merchant.token),
      env,
    );

    expect(response.status).toBe(202);
    const created = (await body(response)).campaign;
    expect(created).toMatchObject({ status: 'PENDING', totalRecipients: 2, templateName: 'promo_announcement' });

    const row = db.query<{ status: string; recipients: string; total_recipients: number }>(
      'SELECT status, recipients, total_recipients FROM whatsapp_campaigns WHERE id = ?',
      created.id,
    )[0];
    expect(row.status).toBe('PENDING');
    expect(JSON.parse(row.recipients)).toEqual([
      { name: 'Ada', phone: '21622345678' },
      { name: 'Bo', phone: '21622345679' },
    ]);

    expect(readCounter()).toEqual({ sent: 2, month: currentMonth() });
    expect((env as unknown as { WHATSAPP_SENDER: { scheduled: string[] } }).WHATSAPP_SENDER.scheduled).toContain(created.id);

    const audit = db.query<{ action: string }>(`SELECT action FROM audit_logs WHERE action = 'whatsapp.broadcast.started'`);
    expect(audit).toHaveLength(1);
  });

  it('rejects 101 recipients on Pro with the exact batch-limit message', async () => {
    const response = await handleWhatsAppRoute(
      jsonRequest('/api/whatsapp/broadcast', 'POST', validBroadcast(101), merchant.token),
      env,
    );

    expect(response.status).toBe(403);
    expect((await body(response)).error).toBe('PRO plan allows 100 recipients per broadcast.');
    expect(db.query(`SELECT id FROM whatsapp_campaigns`)).toHaveLength(0);
    expect(readCounter().sent).toBe(0);
  });

  it('caps Business broadcasts at 250 recipients but allows exactly 250', async () => {
    const business = await seedMerchant(db, {
      email: 'business-batch@example.test',
      withActiveSubscription: true,
      planId: 'plan_scale',
    });

    const rejected = await handleWhatsAppRoute(
      jsonRequest('/api/whatsapp/broadcast', 'POST', validBroadcast(251), business.token),
      env,
    );
    expect(rejected.status).toBe(403);
    expect((await body(rejected)).error).toBe('BUSINESS plan allows 250 recipients per broadcast.');
    expect(readCounter().sent).toBe(0);

    const accepted = await handleWhatsAppRoute(
      jsonRequest('/api/whatsapp/broadcast', 'POST', validBroadcast(250), business.token),
      env,
    );
    expect(accepted.status).toBe(202);
  });

  it('stores the pacing delay for the chosen pace', async () => {
    const relaxed = await handleWhatsAppRoute(
      jsonRequest('/api/whatsapp/broadcast', 'POST', { ...validBroadcast(1), pace: 'relaxed' }, merchant.token),
      env,
    );
    expect(relaxed.status).toBe(202);
    const relaxedId = (await body(relaxed)).campaign.id as string;
    expect(
      db.query<{ message_delay_ms: number }>('SELECT message_delay_ms FROM whatsapp_campaigns WHERE id = ?', relaxedId)[0]
        .message_delay_ms,
    ).toBe(3000);
    // Settle it so the one-active-campaign guard lets the default-pace create through.
    db.prepare(`UPDATE whatsapp_campaigns SET status = 'COMPLETED' WHERE id = ?`).bind(relaxedId).run();

    const defaulted = await handleWhatsAppRoute(
      jsonRequest('/api/whatsapp/broadcast', 'POST', validBroadcast(1), merchant.token),
      env,
    );
    expect(defaulted.status).toBe(202);
    const defaultedId = (await body(defaulted)).campaign.id as string;
    expect(
      db.query<{ message_delay_ms: number }>('SELECT message_delay_ms FROM whatsapp_campaigns WHERE id = ?', defaultedId)[0]
        .message_delay_ms,
    ).toBe(900);
  });

  it('rejects when the monthly quota is exhausted', async () => {
    setCounter(199);

    const response = await handleWhatsAppRoute(
      jsonRequest('/api/whatsapp/broadcast', 'POST', validBroadcast(2), merchant.token),
      env,
    );

    expect(response.status).toBe(403);
    expect((await body(response)).error).toBe('PRO plan limit reached. Upgrade to Business for 1000 messages');
    expect(readCounter().sent).toBe(199);
  });

  it('allows a new campaign once the month rolls over', async () => {
    setCounter(199, '2020-01');

    const response = await handleWhatsAppRoute(
      jsonRequest('/api/whatsapp/broadcast', 'POST', validBroadcast(2), merchant.token),
      env,
    );

    expect(response.status).toBe(202);
    expect(readCounter()).toEqual({ sent: 2, month: currentMonth() });
  });

  it('rejects invalid phone numbers before reserving anything', async () => {
    const response = await handleWhatsAppRoute(
      jsonRequest(
        '/api/whatsapp/broadcast',
        'POST',
        { ...validBroadcast(1), recipients: [{ name: 'Bo', phone: 'abc' }] },
        merchant.token,
      ),
      env,
    );

    expect(response.status).toBe(400);
    expect((await body(response)).error).toContain('Invalid phone number for recipient #1');
    expect(readCounter().sent).toBe(0);
  });

  it('rejects while another broadcast is in progress', async () => {
    await insertBroadcast([{ phone: '21622345678' }], { status: 'PROCESSING' });

    const response = await handleWhatsAppRoute(
      jsonRequest('/api/whatsapp/broadcast', 'POST', validBroadcast(2), merchant.token),
      env,
    );

    expect(response.status).toBe(409);
    expect((await body(response)).error).toContain('already in progress');
    expect(readCounter().sent).toBe(0);
  });

  it('grants Business plans the 1000-message limit', async () => {
    const business = await seedMerchant(db, {
      email: 'business@example.test',
      withActiveSubscription: true,
      planId: 'plan_scale',
    });

    const response = await handleWhatsAppRoute(
      jsonRequest('/api/whatsapp/broadcast', 'POST', validBroadcast(3), business.token),
      env,
    );
    expect(response.status).toBe(202);

    const status = await body(
      await handleWhatsAppRoute(jsonRequest('/api/whatsapp/status', 'GET', undefined, business.token), env),
    );
    expect(status.status).toMatchObject({
      allowed: true,
      monthlyLimit: 1000,
      batchLimit: 250,
      sentThisMonth: 3,
      remaining: 997,
    });
  });
});

describe('GET /api/whatsapp/status', () => {
  it('401s without an authentication token', async () => {
    const response = await handleWhatsAppRoute(jsonRequest('/api/whatsapp/status', 'GET'), env);
    expect(response.status).toBe(401);
  });

  it('reports the Pro allowance', async () => {
    const payload = await body(
      await handleWhatsAppRoute(jsonRequest('/api/whatsapp/status', 'GET', undefined, merchant.token), env),
    );

    expect(payload.status).toMatchObject({
      allowed: true,
      planSlug: 'growth',
      planName: 'Pro',
      monthlyLimit: 200,
      batchLimit: 100,
      sentThisMonth: 0,
      remaining: 200,
      configured: true,
    });
  });

  it('locks Starter accounts out', async () => {
    const starter = await seedMerchant(db, {
      email: 'starter-status@example.test',
      withActiveSubscription: true,
      planId: 'plan_starter',
    });

    const payload = await body(
      await handleWhatsAppRoute(jsonRequest('/api/whatsapp/status', 'GET', undefined, starter.token), env),
    );

    expect(payload.status).toMatchObject({ allowed: false, monthlyLimit: 0 });
  });

  it('reads a stale month as zero usage', async () => {
    setCounter(150, '2020-01');
    const stale = await body(
      await handleWhatsAppRoute(jsonRequest('/api/whatsapp/status', 'GET', undefined, merchant.token), env),
    );
    expect(stale.status.sentThisMonth).toBe(0);

    setCounter(150);
    const fresh = await body(
      await handleWhatsAppRoute(jsonRequest('/api/whatsapp/status', 'GET', undefined, merchant.token), env),
    );
    expect(fresh.status).toMatchObject({ sentThisMonth: 150, remaining: 50 });
  });

  it('exposes the pacing circuit snapshot', async () => {
    const closed = await body(
      await handleWhatsAppRoute(jsonRequest('/api/whatsapp/status', 'GET', undefined, merchant.token), env),
    );
    expect(closed.status.circuit).toEqual({ blockedUntil: 0, lastSentAt: 0, opens24h: 0 });

    pacingControls().block(5_000);
    try {
      const open = await body(
        await handleWhatsAppRoute(jsonRequest('/api/whatsapp/status', 'GET', undefined, merchant.token), env),
      );
      expect(open.status.circuit).toMatchObject({ opens24h: 1 });
      expect(open.status.circuit.blockedUntil).toBeGreaterThan(Date.now());
    } finally {
      pacingControls().unblock();
    }
  });
});

describe('GET /api/whatsapp/templates', () => {
  it('503s when credentials are missing', async () => {
    const testEnv = env as unknown as Record<string, unknown>;
    delete testEnv.WHATSAPP_TOKEN;
    delete testEnv.WHATSAPP_PHONE_ID;

    const response = await handleWhatsAppRoute(
      jsonRequest('/api/whatsapp/templates', 'GET', undefined, merchant.token),
      env,
    );

    expect(response.status).toBe(503);
    expect((await body(response)).configured).toBe(false);
  });

  it('returns the approved templates from Meta', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ name: 'promo_announcement', language: 'fr', status: 'APPROVED' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const payload = await body(
      await handleWhatsAppRoute(jsonRequest('/api/whatsapp/templates', 'GET', undefined, merchant.token), env),
    );

    expect(payload.templates).toEqual([{ name: 'promo_announcement', language: 'fr', status: 'APPROVED' }]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/111222333444555/message_templates');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer whatsapp-token.test');
  });

  it('includes the template body text so the UI can preview the message', async () => {
    clearWhatsAppTemplateCache();
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              name: 'winner_announcement',
              language: 'fr',
              status: 'APPROVED',
              components: [
                { type: 'HEADER', text: 'Image' },
                { type: 'BODY', text: 'Félicitations {{1}} ! Votre code : {{2}}' },
              ],
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const payload = await body(
      await handleWhatsAppRoute(jsonRequest('/api/whatsapp/templates', 'GET', undefined, merchant.token), env),
    );

    expect(payload.templates).toEqual([
      {
        name: 'winner_announcement',
        language: 'fr',
        status: 'APPROVED',
        body: 'Félicitations {{1}} ! Votre code : {{2}}',
      },
    ]);
  });
});

describe('sendTemplateMessage retries', () => {
  const params = { to: '21622345678', templateName: 'promo_announcement', language: 'fr', variables: [] };
  const config = { WHATSAPP_TOKEN: 'whatsapp-token.test', WHATSAPP_PHONE_ID: '111222333444555' };

  it('retries a 429 and succeeds on the next attempt', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(metaResponse(429))
      .mockResolvedValueOnce(metaResponse(200));
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendTemplateMessage(config, params);

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a network failure and succeeds on the next attempt', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network down.'))
      .mockResolvedValueOnce(metaResponse(200));
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendTemplateMessage(config, params);

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails fast on an auth rejection without retrying', async () => {
    const fetchMock = vi.fn(async () => metaResponse(401));
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendTemplateMessage(config, params);

    expect(result.ok).toBe(false);
    expect(result.authFailed).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('flags a dead template with its Meta error code and never retries it', async () => {
    const fetchMock = vi.fn(async () => metaErrorResponse(400, 131026));
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendTemplateMessage(config, params);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.errorCode).toBe(131026);
    expect(result.templateBlocked).toBe(true);
    expect(result.error).toContain('131026');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('passes other client error codes through without flagging the template', async () => {
    const fetchMock = vi.fn(async () => metaErrorResponse(400, 10));
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendTemplateMessage(config, params);

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(10);
    expect(result.templateBlocked).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('effectiveBatchSize', () => {
  it('keeps the default 20-message rounds at fast pacing', () => {
    expect(effectiveBatchSize(20, 150)).toBe(20);
  });

  it('shrinks rounds as pacing gets more relaxed', () => {
    expect(effectiveBatchSize(20, 900)).toBe(20);
    expect(effectiveBatchSize(20, 3000)).toBe(10);
    expect(effectiveBatchSize(20, 30_000)).toBe(1);
    expect(effectiveBatchSize(20, 60_000)).toBe(1);
  });

  it('never returns zero and ignores unusable delays', () => {
    expect(effectiveBatchSize(20, 0)).toBe(20);
    expect(effectiveBatchSize(20, Number.NaN)).toBe(20);
    expect(effectiveBatchSize(4, 5000)).toBe(4);
  });
});

describe('GET /api/whatsapp/broadcast', () => {
  it('lists the business broadcasts and fetches one by id', async () => {
    const id = await insertBroadcast([{ phone: '21622345678' }], { sent: 1 });

    const list = await body(
      await handleWhatsAppRoute(jsonRequest('/api/whatsapp/broadcast', 'GET', undefined, merchant.token), env),
    );
    expect(list.campaigns).toHaveLength(1);
    expect(list.campaigns[0]).toMatchObject({ id, status: 'PENDING', totalRecipients: 1, sent: 1 });

    const item = await body(
      await handleWhatsAppRoute(jsonRequest(`/api/whatsapp/broadcast/${id}`, 'GET', undefined, merchant.token), env),
    );
    expect(item.campaign).toMatchObject({ id, status: 'PENDING', totalRecipients: 1, sent: 1 });
  });

  it('404s for another business broadcast', async () => {
    const other = await seedMerchant(db, { email: 'other-wa@example.test' });
    const foreign = await insertBroadcast([{ phone: '21622345678' }]);
    db.prepare(`UPDATE whatsapp_campaigns SET business_id = ? WHERE id = ?`)
      .bind(other.businessId, foreign)
      .run();

    const response = await handleWhatsAppRoute(
      jsonRequest(`/api/whatsapp/broadcast/${foreign}`, 'GET', undefined, merchant.token),
      env,
    );
    expect(response.status).toBe(404);
  });
});

describe('processBroadcastBatch', () => {
  const threeRecipients = [
    { name: 'Ada', phone: '21622345678' },
    { name: 'Bo', phone: '21622345679' },
    { name: 'Cy', phone: '21622345680' },
  ];

  it('sends the batch with 150 ms pacing, completes and keeps the reservation for delivered messages', async () => {
    const fetchMock = vi.fn(async () => metaResponse(200));
    vi.stubGlobal('fetch', fetchMock);
    setCounter(3);
    const id = await insertBroadcast(threeRecipients);

    const startedAt = Date.now();
    const outcome = await processBroadcastBatch(env, id);
    const elapsed = Date.now() - startedAt;

    expect(outcome).toBe('completed');
    expect(elapsed).toBeGreaterThanOrEqual(290);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v20.0/111222333444555/messages');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer whatsapp-token.test');
    const sentBody = JSON.parse(String(init.body));
    expect(sentBody).toMatchObject({
      messaging_type: 'TEMPLATE',
      type: 'template',
      to: '21622345678',
      template: {
        name: 'promo_announcement',
        language: { code: 'fr' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: 'Bonjour' }, { type: 'text', text: 'https://promo.test' }] }],
      },
    });

    const row = db.query<{ status: string; sent_count: number; failed_count: number }>(
      'SELECT status, sent_count, failed_count FROM whatsapp_campaigns WHERE id = ?',
      id,
    )[0];
    expect(row).toMatchObject({ status: 'COMPLETED', sent_count: 3, failed_count: 0 });
    expect(readCounter().sent).toBe(3);
  });

  it('counts failures and refunds them from the monthly counter', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(metaResponse(200))
      .mockResolvedValueOnce(metaResponse(200))
      .mockResolvedValueOnce(metaResponse(500))
      .mockResolvedValue(metaResponse(500));
    vi.stubGlobal('fetch', fetchMock);
    setCounter(3);
    const id = await insertBroadcast(threeRecipients);

    const outcome = await processBroadcastBatch(env, id);

    expect(outcome).toBe('completed');
    const row = db.query<{ status: string; sent_count: number; failed_count: number; last_error: string }>(
      'SELECT status, sent_count, failed_count, last_error FROM whatsapp_campaigns WHERE id = ?',
      id,
    )[0];
    expect(row).toMatchObject({ status: 'COMPLETED', sent_count: 2, failed_count: 1 });
    expect(row.last_error).toContain('500');
    expect(readCounter().sent).toBe(2);
  });

  it('stops on a Meta auth failure, marks FAILED and refunds everything unsent', async () => {
    const fetchMock = vi.fn(async () => metaResponse(401));
    vi.stubGlobal('fetch', fetchMock);
    setCounter(5);
    const id = await insertBroadcast(Array.from({ length: 5 }, (_unused, index) => ({ phone: `216223456${index}` })));

    const outcome = await processBroadcastBatch(env, id);

    expect(outcome).toBe('failed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const row = db.query<{ status: string; sent_count: number; failed_count: number }>(
      'SELECT status, sent_count, failed_count FROM whatsapp_campaigns WHERE id = ?',
      id,
    )[0];
    expect(row).toMatchObject({ status: 'FAILED', sent_count: 0, failed_count: 1 });
    expect(readCounter().sent).toBe(0);
  });

  it('resumes across batches from the persisted cursor', async () => {
    const fetchMock = vi.fn(async () => metaResponse(200));
    vi.stubGlobal('fetch', fetchMock);
    setCounter(5);
    const id = await insertBroadcast(Array.from({ length: 5 }, (_unused, index) => ({ phone: `216223456${index}` })));

    expect(await processBroadcastBatch(env, id, 2)).toBe('continue');
    let row = db.query<{ status: string; sent_count: number }>(
      'SELECT status, sent_count FROM whatsapp_campaigns WHERE id = ?',
      id,
    )[0];
    expect(row).toMatchObject({ status: 'PROCESSING', sent_count: 2 });

    expect(await processBroadcastBatch(env, id, 2)).toBe('continue');
    expect(await processBroadcastBatch(env, id, 2)).toBe('completed');
    expect(fetchMock).toHaveBeenCalledTimes(5);

    row = db.query<{ status: string; sent_count: number }>(
      'SELECT status, sent_count FROM whatsapp_campaigns WHERE id = ?',
      id,
    )[0];
    expect(row).toMatchObject({ status: 'COMPLETED', sent_count: 5 });
    expect(readCounter().sent).toBe(5);
  });

  it('does nothing once the campaign is settled', async () => {
    const fetchMock = vi.fn(async () => metaResponse(200));
    vi.stubGlobal('fetch', fetchMock);
    const id = await insertBroadcast(threeRecipients, { status: 'COMPLETED', sent: 3 });

    await processBroadcastBatch(env, id);

    expect(fetchMock).not.toHaveBeenCalled();
    const row = db.query<{ status: string }>('SELECT status FROM whatsapp_campaigns WHERE id = ?', id)[0];
    expect(row.status).toBe('COMPLETED');
  });

  it('completes and refunds when the recipients payload is unusable', async () => {
    const id = await insertBroadcast(threeRecipients, { total: 3 });
    db.prepare(`UPDATE whatsapp_campaigns SET recipients = 'not-json' WHERE id = ?`).bind(id).run();
    setCounter(3);

    const outcome = await processBroadcastBatch(env, id);

    expect(outcome).toBe('completed');
    const row = db.query<{ status: string }>('SELECT status FROM whatsapp_campaigns WHERE id = ?', id)[0];
    expect(row.status).toBe('COMPLETED');
    expect(readCounter().sent).toBe(0);
  });

  it('stops the round immediately when the budget is already spent', async () => {
    const fetchMock = vi.fn(async () => metaResponse(200));
    vi.stubGlobal('fetch', fetchMock);
    setCounter(3);
    const id = await insertBroadcast(threeRecipients);

    const outcome = await processBroadcastBatch(env, id, 20, 0);

    expect(outcome).toBe('continue');
    expect(fetchMock).not.toHaveBeenCalled();
    const row = db.query<{ status: string; sent_count: number; failed_count: number }>(
      'SELECT status, sent_count, failed_count FROM whatsapp_campaigns WHERE id = ?',
      id,
    )[0];
    expect(row).toMatchObject({ status: 'PROCESSING', sent_count: 0, failed_count: 0 });
    expect(readCounter().sent).toBe(3);
  });

  it('hands the round back mid-batch once the 150 ms sleeps push it past the budget', async () => {
    const fetchMock = vi.fn(async () => metaResponse(200));
    vi.stubGlobal('fetch', fetchMock);
    setCounter(3);
    const id = await insertBroadcast(threeRecipients);

    // Budget 100 ms: message 1 and the pre-sleep check for message 2 fit
    // comfortably; message 3's check lands after a full 150 ms sleep and the
    // round stops with counts checkpointed.
    const outcome = await processBroadcastBatch(env, id, 20, 100);

    expect(outcome).toBe('continue');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const row = db.query<{ status: string; sent_count: number }>(
      'SELECT status, sent_count FROM whatsapp_campaigns WHERE id = ?',
      id,
    )[0];
    expect(row).toMatchObject({ status: 'PROCESSING', sent_count: 2 });

    fetchMock.mockClear();
    expect(await processBroadcastBatch(env, id, 20, 60_000)).toBe('completed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops the campaign when Meta rejects the template', async () => {
    const fetchMock = vi.fn(async () => metaErrorResponse(400, 131047));
    vi.stubGlobal('fetch', fetchMock);
    setCounter(5);
    const id = await insertBroadcast(Array.from({ length: 5 }, (_unused, index) => ({ phone: `216223456${index}` })));

    const outcome = await processBroadcastBatch(env, id);

    expect(outcome).toBe('failed');
    // No point burning the rest of the list against a dead template.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const row = db.query<{ status: string; sent_count: number; failed_count: number; last_error: string }>(
      'SELECT status, sent_count, failed_count, last_error FROM whatsapp_campaigns WHERE id = ?',
      id,
    )[0];
    expect(row).toMatchObject({ status: 'FAILED', sent_count: 0, failed_count: 1 });
    expect(row.last_error).toContain('131047');
    // Everything unsent is refunded from the monthly counter.
    expect(readCounter().sent).toBe(0);
  });

  it('pools the pacing gate under the configured phone number', async () => {
    const fetchMock = vi.fn(async () => metaResponse(200));
    vi.stubGlobal('fetch', fetchMock);
    const id = await insertBroadcast(threeRecipients);
    const spy = vi.spyOn(env.WHATSAPP_PACING, 'getByName');

    await processBroadcastBatch(env, id, 20, 60_000);

    expect(spy).toHaveBeenCalledWith('gate:111222333444555');
  });
});

describe('bearer auth', () => {
  it('accepts the merchant bearer token on status', async () => {
    const response = await handleWhatsAppRoute(
      new Request('https://example.test/api/whatsapp/status', { headers: bearer(merchant.token) }),
      env,
    );
    expect(response.status).toBe(200);
  });
});
