import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../types';
import { handleSmsRoute } from '../routes/sms';
import { runReconcile } from '../lib/reconcile';
import { setBusinessFeatures } from '../lib/feature-access';
import { createTestEnv, type TestDatabase } from './helpers/d1';
import { jsonRequest, seedMerchant, type SeededMerchant } from './helpers/fixtures';

const DAY_MS = 86_400_000;
const GATEWAY_USER = 'sms-gate-user';
const GATEWAY_PASSWORD = 'sms-gate-pass';
const GATEWAY_BASE_URL = 'https://sms-gateway.test/3rdparty/v1';
const CALLBACK_SECRET = 'sms-cb-secret';
/** plan_growth SMS quota from SMS_PLAN_MONTHLY_LIMITS / SMS_PLAN_BATCH_LIMITS. */
const PRO_MONTHLY = 100;
const PRO_BATCH = 50;

let db: TestDatabase;
let env: Env;
let merchant: SeededMerchant;

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function previousMonth(): string {
  const date = new Date();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

async function body(response: Response) {
  return (await response.json()) as Record<string, any>;
}

/** Operator/master switch stand-in: flips the per-business `sms_enabled` column. */
async function enableSms() {
  await setBusinessFeatures(env, merchant.businessId, { smsEnabled: true });
}

function setGateway() {
  Object.assign(env, {
    SMS_GATEWAY_URL: GATEWAY_BASE_URL,
    SMS_GATEWAY_USER: GATEWAY_USER,
    SMS_GATEWAY_PASSWORD: GATEWAY_PASSWORD,
    SMS_WEBHOOK_SECRET: CALLBACK_SECRET,
  });
}

/** Mirrors authHeader() in lib/sms.ts — the same Basic token both sides compute. */
function expectedAuthHeader(): string {
  return `Basic ${btoa(`${GATEWAY_USER}:${GATEWAY_PASSWORD}`)}`;
}

function setSmsCounter(sent: number, month = currentMonth()) {
  db.prepare(
    `UPDATE subscriptions SET sms_messages_sent_this_month = ?, sms_usage_month = ? WHERE business_id = ?`,
  )
    .bind(sent, month, merchant.businessId)
    .run();
}

function readSmsCounter() {
  return db.query<{ sent: number; month: string | null }>(
    `SELECT sms_messages_sent_this_month AS sent, sms_usage_month AS month
     FROM subscriptions WHERE business_id = ?`,
    merchant.businessId,
  )[0];
}

function stubGatewayFetch(impl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const mock = vi.fn(impl ?? (async () => new Response('{"ok":true}', { status: 200 })));
  vi.stubGlobal('fetch', mock);
  return mock;
}

/** POST /message success: one unique id per recipient phone, as the real API does. */
function stubSmsGatewaySend() {
  return stubGatewayFetch(async (_input, init) => {
    const payload = JSON.parse(String(init?.body ?? '{}')) as { phoneNumbers?: string[] };
    return new Response(JSON.stringify({ id: `gw-${payload.phoneNumbers?.[0] ?? 'unknown'}` }), { status: 200 });
  });
}

type Recipient = { name?: string; phone: string };

function recipientList(count: number): Recipient[] {
  return Array.from({ length: count }, (_unused, index) => ({
    name: `Contact ${index + 1}`,
    phone: `2234567${String(index).padStart(3, '0')}`,
  }));
}

function broadcastPayload(
  recipients: Recipient[],
  message = 'Bonjour ! Votre récompense vous attend en boutique.',
) {
  return { message, recipients };
}

function seedSmsCampaign(
  overrides: {
    status?: string;
    sent?: number;
    failed?: number;
    total?: number;
    recipients?: Recipient[];
    message?: string;
  } = {},
): string {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const recipients =
    overrides.recipients ?? Array.from({ length: overrides.total ?? 3 }, (_unused, index) => ({
      name: `Winner ${index + 1}`,
      phone: `21622345678${index}`,
    }));
  db.prepare(
    `INSERT INTO sms_campaigns
       (id, business_id, user_id, message, recipients, total_recipients, sent_count, failed_count,
        status, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  )
    .bind(
      id,
      merchant.businessId,
      merchant.userId,
      overrides.message ?? 'Bonjour ! Votre récompense vous attend.',
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

function seedLogRow(
  campaignId: string,
  options: { phone: string; status: string; error?: string | null; gatewayMessageId?: string | null },
) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO sms_message_log
       (id, campaign_id, business_id, phone, phone_normalized, gateway_message_id, status, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      campaignId,
      merchant.businessId,
      options.phone,
      options.phone,
      options.gatewayMessageId ?? null,
      options.status,
      options.error ?? null,
      now,
      now,
    )
    .run();
}

function progressRequest(payload: unknown, secret: string | null = CALLBACK_SECRET): Request {
  return new Request(
    `https://example.test/api/sms/internal/progress${secret === null ? '' : `?secret=${secret}`}`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) },
  );
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
    email: 'sms-merchant@example.test',
    withActiveSubscription: true,
    planId: 'plan_growth',
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  db.close();
});

describe('GET /api/sms/status', () => {
  it('401s without a session', async () => {
    const response = await handleSmsRoute(jsonRequest('/api/sms/status', 'GET'), env);
    expect(response.status).toBe(401);
  });

  it('reports the feature switch off by default and never 403s', async () => {
    setGateway();
    setSmsCounter(40);

    const response = await handleSmsRoute(jsonRequest('/api/sms/status', 'GET', undefined, merchant.token), env);
    expect(response.status).toBe(200);
    const payload = await body(response);
    expect(payload.status).toMatchObject({
      allowed: false,
      enabled: false,
      planSlug: 'growth',
      monthlyLimit: PRO_MONTHLY,
      batchLimit: PRO_BATCH,
      sentThisMonth: 40,
      remaining: 60,
      configured: true,
      gateway: { state: 'UNKNOWN' },
    });
  });

  it('allows the workspace once the business switch is on', async () => {
    setGateway();
    await enableSms();

    const response = await handleSmsRoute(jsonRequest('/api/sms/status', 'GET', undefined, merchant.token), env);
    expect(response.status).toBe(200);
    const payload = await body(response);
    expect(payload.status).toMatchObject({ allowed: true, enabled: true, remaining: PRO_MONTHLY });
  });

  it('treats a counter from a stale usage month as zero and re-reserves from a fresh month', async () => {
    setGateway();
    await enableSms();
    setSmsCounter(55, previousMonth());

    const response = await handleSmsRoute(jsonRequest('/api/sms/status', 'GET', undefined, merchant.token), env);
    const payload = await body(response);
    expect(payload.status.sentThisMonth).toBe(0);
    expect(payload.status.remaining).toBe(PRO_MONTHLY);

    stubSmsGatewaySend();
    const sent = await handleSmsRoute(
      jsonRequest(
        '/api/sms/broadcast',
        'POST',
        broadcastPayload([{ name: 'Ada', phone: '22345678' }]),
        merchant.token,
      ),
      env,
    );
    expect(sent.status).toBe(202);
    expect(readSmsCounter()).toMatchObject({ sent: 1, month: currentMonth() });
  });

  it('reports the gateway as unconfigured when the Basic credentials are missing', async () => {
    env.SMS_GATEWAY_URL = GATEWAY_BASE_URL;
    env.SMS_GATEWAY_USER = 'only-user';

    const response = await handleSmsRoute(jsonRequest('/api/sms/status', 'GET', undefined, merchant.token), env);
    const payload = await body(response);
    expect(payload.status.configured).toBe(false);
  });

  it('shows the gateway ONLINE once a heartbeat was recorded', async () => {
    setGateway();
    await env.TOKENS.put('sms:gw:last_seen', String(Date.now()));

    const response = await handleSmsRoute(jsonRequest('/api/sms/status', 'GET', undefined, merchant.token), env);
    const payload = await body(response);
    expect(payload.status.gateway).toEqual({ state: 'ONLINE' });
  });
});

describe('GET /api/sms/winners', () => {
  it('lists issued winners with phone, excluding anonymous, already-messaged and normalized duplicates', async () => {
    await enableSms();
    seedWinner({ phone: '22345678', ageMs: 0 });
    seedWinner({ phone: null, ageMs: 1000 });
    seedWinner({ phone: '33 1 23 45 67 89', firstName: 'Marie', ageMs: 2000 });
    // Same E.164 digits as '22345678' (21622345678) — must collapse.
    seedWinner({ phone: '0021622345678', firstName: 'Dup', lastName: 'Ada', ageMs: 500 });

    const alreadyMessaged = seedWinner({ phone: '99887766', ageMs: 3000 });
    db.prepare(
      `INSERT INTO sms_message_log
         (id, campaign_id, business_id, phone, phone_normalized, status, created_at, updated_at)
       VALUES (?, ?, ?, '99887766', '21699887766', 'SENT', ?, ?)`,
    )
      .bind(crypto.randomUUID(), alreadyMessaged, merchant.businessId, new Date().toISOString(), new Date().toISOString())
      .run();

    const response = await handleSmsRoute(jsonRequest('/api/sms/winners', 'GET', undefined, merchant.token), env);
    expect(response.status).toBe(200);
    const payload = await body(response);
    expect(payload.winners).toHaveLength(2);
    expect(payload.winners.map((winner: { phone: string }) => winner.phone)).toEqual(['22345678', '33 1 23 45 67 89']);
    expect(payload.winners[0]).toMatchObject({
      id: expect.any(String),
      name: 'Ada Lovelace',
      prize: 'Free coffee',
      campaignId: expect.any(String),
    });
  });

  it('caps the list at 200 winners', async () => {
    await enableSms();
    for (let index = 0; index < 205; index += 1) {
      seedWinner({ phone: `2234567${String(index).padStart(3, '0')}`, ageMs: (205 - index) * 1000 });
    }

    const response = await handleSmsRoute(jsonRequest('/api/sms/winners', 'GET', undefined, merchant.token), env);
    const payload = await body(response);
    expect(payload.winners).toHaveLength(200);
  });
});

describe('auth & tenant isolation', () => {
  it('401s a broadcast request without a session', async () => {
    const response = await handleSmsRoute(
      jsonRequest('/api/sms/broadcast', 'POST', broadcastPayload([{ phone: '22345678' }])),
      env,
    );
    expect(response.status).toBe(401);
  });

  it('404s broadcasts owned by another business on read and cancel', async () => {
    await enableSms();
    const other = await seedMerchant(db, {
      email: 'sms-other@example.test',
      withActiveSubscription: true,
      planId: 'plan_growth',
    });
    const foreign = seedSmsCampaign({ status: 'QUEUED', total: 2 });
    db.prepare(`UPDATE sms_campaigns SET business_id = ? WHERE id = ?`).bind(other.businessId, foreign).run();

    const get = await handleSmsRoute(
      jsonRequest(`/api/sms/broadcast/${foreign}`, 'GET', undefined, merchant.token),
      env,
    );
    expect(get.status).toBe(404);
    const cancel = await handleSmsRoute(
      jsonRequest(`/api/sms/broadcast/${foreign}/cancel`, 'POST', undefined, merchant.token),
      env,
    );
    expect(cancel.status).toBe(404);
  });

  it('404s an unknown SMS path', async () => {
    await enableSms();
    const response = await handleSmsRoute(jsonRequest('/api/sms/bogus', 'GET', undefined, merchant.token), env);
    expect(response.status).toBe(404);
  });
});

describe('POST /api/sms/broadcast', () => {
  it('403s with the disabled-feature copy while the switch is off', async () => {
    setGateway();
    const response = await handleSmsRoute(
      jsonRequest('/api/sms/broadcast', 'POST', broadcastPayload([{ phone: '22345678' }]), merchant.token),
      env,
    );
    expect(response.status).toBe(403);
    expect((await body(response)).error).toBe(
      'SMS marketing is currently disabled by the platform administrator.',
    );
  });

  it('503s when the gateway credentials are missing', async () => {
    await enableSms();
    const response = await handleSmsRoute(
      jsonRequest('/api/sms/broadcast', 'POST', broadcastPayload([{ phone: '22345678' }]), merchant.token),
      env,
    );
    expect(response.status).toBe(503);
    expect((await body(response)).error).toBe('SMS gateway is not configured.');
  });

  it('403s a workspace outside the gateway allowlist before reserving quota', async () => {
    setGateway();
    env.SMS_ALLOWLIST = '00000000-0000-4000-8000-000000000000';
    await enableSms();
    const fetchMock = stubSmsGatewaySend();

    const response = await handleSmsRoute(
      jsonRequest('/api/sms/broadcast', 'POST', broadcastPayload([{ phone: '22345678' }]), merchant.token),
      env,
    );
    expect(response.status).toBe(403);
    expect((await body(response)).error).toBe('SMS marketing is not enabled for this workspace.');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.query(`SELECT id FROM sms_campaigns`)).toHaveLength(0);
    expect(readSmsCounter().sent).toBe(0);
  });

  it('400s on an invalid phone', async () => {
    setGateway();
    await enableSms();
    const response = await handleSmsRoute(
      jsonRequest('/api/sms/broadcast', 'POST', broadcastPayload([{ name: 'Bad', phone: '123' }]), merchant.token),
      env,
    );
    expect(response.status).toBe(400);
    expect((await body(response)).error).toBe('Invalid phone number for recipient #1: "123".');
  });

  it('400s when the message exceeds the 320-character ceiling', async () => {
    setGateway();
    await enableSms();
    const response = await handleSmsRoute(
      jsonRequest(
        '/api/sms/broadcast',
        'POST',
        broadcastPayload([{ phone: '22345678' }], 'x'.repeat(321)),
        merchant.token,
      ),
      env,
    );
    expect(response.status).toBe(400);
    expect((await body(response)).error).toBe('Validation failed.');
  });

  it('dedupes the same E.164 number across formats and filters suppressed phones before counting', async () => {
    setGateway();
    await enableSms();
    db.prepare(
      `INSERT INTO sms_suppression (phone_normalized, reason, created_at) VALUES (?, 'STOP', ?)`,
    )
      .bind('216223456789', new Date().toISOString())
      .run();
    const fetchMock = stubSmsGatewaySend();

    const response = await handleSmsRoute(
      jsonRequest(
        '/api/sms/broadcast',
        'POST',
        broadcastPayload([
          { name: 'Ada', phone: '22345678' }, // -> 21622345678
          { phone: '0021622345678' }, // same E.164 -> deduped
          { name: 'Marie', phone: '+216223456789' }, // suppressed
        ]),
        merchant.token,
      ),
      env,
    );
    expect(response.status).toBe(202);
    const payload = await body(response);
    expect(payload.campaign.totalRecipients).toBe(1);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const handed = JSON.parse(String(init.body));
    expect(handed.phoneNumbers).toEqual(['21622345678']);

    const stored = JSON.parse(
      db.query<{ recipients: string }>(`SELECT recipients FROM sms_campaigns`)[0].recipients,
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ name: 'Ada' });

    expect(readSmsCounter().sent).toBe(1);
    expect(
      db.query<{ phone_normalized: string }>(`SELECT phone_normalized FROM sms_message_log`),
    ).toEqual([{ phone_normalized: '21622345678' }]);
  });

  it('409s when every recipient unsubscribed', async () => {
    setGateway();
    await enableSms();
    db.prepare(
      `INSERT INTO sms_suppression (phone_normalized, reason, created_at) VALUES (?, 'STOP', ?)`,
    )
      .bind('21622345678', new Date().toISOString())
      .run();

    const response = await handleSmsRoute(
      jsonRequest('/api/sms/broadcast', 'POST', broadcastPayload([{ phone: '22345678' }]), merchant.token),
      env,
    );
    expect(response.status).toBe(409);
    expect((await body(response)).error).toBe('Every recipient unsubscribed from SMS messaging.');
    expect(db.query(`SELECT id FROM sms_campaigns`)).toHaveLength(0);
    expect(readSmsCounter().sent).toBe(0);
  });

  it('403s when the batch exceeds the per-broadcast cap', async () => {
    setGateway();
    await enableSms();
    const response = await handleSmsRoute(
      jsonRequest('/api/sms/broadcast', 'POST', broadcastPayload(recipientList(51)), merchant.token),
      env,
    );
    expect(response.status).toBe(403);
    expect((await body(response)).error).toBe('Plan allows 50 recipients per broadcast.');
    expect(db.query(`SELECT id FROM sms_campaigns`)).toHaveLength(0);
  });

  it('403s when the monthly quota cannot absorb the batch and stays unchanged', async () => {
    setGateway();
    await enableSms();
    setSmsCounter(99); // a previous broadcast consumed all but one message

    const response = await handleSmsRoute(
      jsonRequest('/api/sms/broadcast', 'POST', broadcastPayload(recipientList(2)), merchant.token),
      env,
    );
    expect(response.status).toBe(403);
    expect((await body(response)).error).toBe('Plan limit reached (100 messages per month).');
    expect(readSmsCounter().sent).toBe(99);
    expect(db.query(`SELECT id FROM sms_campaigns`)).toHaveLength(0);
  });

  it('409s while another SMS broadcast is active, counter untouched', async () => {
    setGateway();
    await enableSms();
    seedSmsCampaign({ status: 'QUEUED' });

    const response = await handleSmsRoute(
      jsonRequest('/api/sms/broadcast', 'POST', broadcastPayload(recipientList(2)), merchant.token),
      env,
    );
    expect(response.status).toBe(409);
    expect((await body(response)).error).toBe('An SMS broadcast is already in progress. Wait for it to finish.');
    expect(readSmsCounter().sent).toBe(0);
    expect(db.query(`SELECT id FROM sms_campaigns`)).toHaveLength(1);
    expect(
      db.query(`SELECT id FROM audit_logs WHERE action = 'sms.broadcast.started'`),
    ).toHaveLength(0);
  });

  it('lets a new broadcast start after the active one is cancelled', async () => {
    setGateway();
    await enableSms();
    stubSmsGatewaySend();
    const active = seedSmsCampaign({ status: 'QUEUED', total: 2 });
    seedLogRow(active, { phone: '216223456780', status: 'PENDING' });

    const cancel = await handleSmsRoute(
      jsonRequest(`/api/sms/broadcast/${active}/cancel`, 'POST', undefined, merchant.token),
      env,
    );
    expect(cancel.status).toBe(200);

    const second = await handleSmsRoute(
      jsonRequest('/api/sms/broadcast', 'POST', broadcastPayload(recipientList(2)), merchant.token),
      env,
    );
    expect(second.status).toBe(202);
    expect((await body(second)).campaign.status).toBe('PROCESSING');
    expect(readSmsCounter().sent).toBe(2);
  });

  it('queues the campaign, reserves quota, and hands each recipient to the gateway with Basic auth', async () => {
    setGateway();
    await enableSms();
    const fetchMock = stubSmsGatewaySend();

    const response = await handleSmsRoute(
      jsonRequest(
        '/api/sms/broadcast',
        'POST',
        broadcastPayload([
          { name: 'Ada', phone: '22345678' },
          { name: 'Marie', phone: '+21622345689' },
        ]),
        merchant.token,
      ),
      env,
    );
    expect(response.status).toBe(202);
    const payload = await body(response);
    expect(payload.campaign.status).toBe('PROCESSING');
    expect(payload.campaign.totalRecipients).toBe(2);
    expect(payload.campaign.sent).toBe(0);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe(`${GATEWAY_BASE_URL}/message`);
    expect(new Headers(init.headers).get('authorization')).toBe(expectedAuthHeader());
    const handed = JSON.parse(String(init.body));
    expect(handed).toMatchObject({ textMessage: { text: payload.campaign.message }, phoneNumbers: ['21622345678'] });

    const row = db.query<{ status: string; total_recipients: number; sent_count: number }>(
      `SELECT status, total_recipients, sent_count FROM sms_campaigns WHERE id = ?`,
      payload.campaign.id,
    )[0];
    expect(row).toMatchObject({ status: 'PROCESSING', total_recipients: 2, sent_count: 0 });
    expect(readSmsCounter().sent).toBe(2);

    const log = db.query<{ status: string; gateway_message_id: string }>(
      `SELECT status, gateway_message_id FROM sms_message_log`,
    );
    expect(log).toHaveLength(2);
    expect(
      log.some((entry) => entry.status === 'PENDING' && entry.gateway_message_id === 'gw-21622345678'),
    ).toBe(true);

    const audit = db.query(`SELECT id FROM audit_logs WHERE action = 'sms.broadcast.started'`);
    expect(audit).toHaveLength(1);
  });
});

describe('broadcast dispatch via gateway + webhook events', () => {
  it('marks the row PENDING with the gateway id, then SENT, then completes the campaign after the webhook', async () => {
    setGateway();
    await enableSms();
    stubSmsGatewaySend();
    const phone = '21622345678';

    const created = await handleSmsRoute(
      jsonRequest('/api/sms/broadcast', 'POST', broadcastPayload([{ name: 'Ada', phone: '22345678' }]), merchant.token),
      env,
    );
    expect(created.status).toBe(202);
    const id = (await body(created)).campaign.id as string;

    let row: { status: string; gateway_message_id: string | null } = db.query<{ status: string; gateway_message_id: string | null }>(
      `SELECT status, gateway_message_id FROM sms_message_log WHERE campaign_id = ?`,
      id,
    )[0];
    expect(row).toMatchObject({ status: 'PENDING', gateway_message_id: `gw-${phone}` });

    const listed = await handleSmsRoute(
      jsonRequest(`/api/sms/broadcast/${id}`, 'GET', undefined, merchant.token),
      env,
    );
    expect((await body(listed)).campaign).toMatchObject({ status: 'PROCESSING', sent: 0 });

    const sent = await handleSmsRoute(
      progressRequest({ event: 'sms:sent', payload: { messageId: `gw-${phone}`, phoneNumber: phone } }),
      env,
    );
    expect(sent.status).toBe(200);

    row = db.query<{ status: string; gateway_message_id: string | null }>(
      `SELECT status, gateway_message_id FROM sms_message_log WHERE campaign_id = ?`,
      id,
    )[0];
    expect(row.status).toBe('SENT');

    const completed = await handleSmsRoute(
      jsonRequest(`/api/sms/broadcast/${id}`, 'GET', undefined, merchant.token),
      env,
    );
    const completedPayload = await body(completed);
    expect(completedPayload.campaign).toMatchObject({ status: 'COMPLETED', sent: 1, failed: 0 });

    const replay = await handleSmsRoute(
      progressRequest({ event: 'sms:sent', payload: { messageId: `gw-${phone}`, phoneNumber: phone } }),
      env,
    );
    expect((await body(replay)).ignored).toBe(true);
    expect(completedPayload.campaign.sent).toBe(1);
    expect(
      db.query<{ sent_count: number; status: string }>(
        `SELECT sent_count, status FROM sms_campaigns WHERE id = ?`,
        id,
      )[0],
    ).toMatchObject({ sent_count: 1, status: 'COMPLETED' });
  }, 15_000);

  it('walks one message through sent then delivered and completes the campaign as a guarded recompute', async () => {
    setGateway();
    await enableSms();
    stubSmsGatewaySend();

    const created = await handleSmsRoute(
      jsonRequest(
        '/api/sms/broadcast',
        'POST',
        broadcastPayload([
          { name: 'Ada', phone: '22345678' },
          { name: 'Marie', phone: '22345689' },
        ]),
        merchant.token,
      ),
      env,
    );
    const id = (await body(created)).campaign.id as string;

    const sentA = await handleSmsRoute(
      progressRequest({ event: 'sms:sent', payload: { messageId: 'gw-21622345678' } }),
      env,
    );
    expect(sentA.status).toBe(200);
    expect(
      db.query<{ status: string; sent_count: number; failed_count: number }>(
        `SELECT status, sent_count, failed_count FROM sms_campaigns WHERE id = ?`,
        id,
      )[0],
    ).toMatchObject({ status: 'PROCESSING', sent_count: 1, failed_count: 0 });

    const delivered = await handleSmsRoute(
      progressRequest({ event: 'sms:delivered', payload: { messageId: 'gw-21622345678' } }),
      env,
    );
    expect(delivered.status).toBe(200);
    expect(
      db.query<{ status: string }>(`SELECT status FROM sms_message_log WHERE gateway_message_id = ?`, 'gw-21622345678')[0],
    ).toMatchObject({ status: 'DELIVERED' });

    const sentB = await handleSmsRoute(
      progressRequest({ event: 'sms:sent', payload: { messageId: 'gw-21622345689' } }),
      env,
    );
    expect(sentB.status).toBe(200);
    // Every log row is terminal -> the campaign completes itself.
    expect(
      db.query<{ status: string; sent_count: number }>(
        `SELECT status, sent_count FROM sms_campaigns WHERE id = ?`,
        id,
      )[0],
    ).toMatchObject({ status: 'COMPLETED', sent_count: 2 });

    const late = await handleSmsRoute(
      progressRequest({ event: 'sms:delivered', payload: { messageId: 'gw-21622345689' } }),
      env,
    );
    expect((await body(late)).ignored).toBe(true);
    expect(
      db.query<{ status: string; sent_count: number }>(
        `SELECT status, sent_count FROM sms_campaigns WHERE id = ?`,
        id,
      )[0],
    ).toMatchObject({ status: 'COMPLETED', sent_count: 2 });
  }, 15_000 );

  it('fails the whole broadcast and refunds the reservation when the gateway rejects the credentials', async () => {
    setGateway();
    await enableSms();
    stubGatewayFetch(async () => new Response('{"error":"unauthorized"}', { status: 401 }));

    const response = await handleSmsRoute(
      jsonRequest('/api/sms/broadcast', 'POST', broadcastPayload(recipientList(2)), merchant.token),
      env,
    );
    expect(response.status).toBe(202);
    const payload = await body(response);
    expect(payload.campaign.status).toBe('FAILED');
    expect(payload.campaign.lastError).toBe(
      'SMS gateway rejected the credentials. Unsent messages were refunded.',
    );

    const row = db.query<{ status: string; last_error: string | null }>(`SELECT status, last_error FROM sms_campaigns`)[0];
    expect(row.status).toBe('FAILED');
    expect(row.last_error).toContain('credentials');

    const log = db.query<{ status: string; error: string }>(`SELECT status, error FROM sms_message_log`);
    expect(log).toHaveLength(2);
    expect(log.every((entry) => entry.status === 'FAILED')).toBe(true);

    // Reservation 2 -> refunded -> 0.
    expect(readSmsCounter().sent).toBe(0);
  }, 15_000);

  it('marks only the retryable-failed recipient FAILED and keeps sending the rest', async () => {
    setGateway();
    await enableSms();
    const failingPhone = '21622345670';
    let calls = 0;
    const fetchMock = stubGatewayFetch(async (_input, init) => {
      const payload = JSON.parse(String(init?.body ?? '{}')) as { phoneNumbers?: string[] };
      calls += 1;
      if (payload.phoneNumbers?.[0] === failingPhone) {
        return new Response('{"error":"overloaded"}', { status: 500 });
      }
      return new Response(JSON.stringify({ id: `gw-${payload.phoneNumbers?.[0]}` }), { status: 200 });
    });

    const response = await handleSmsRoute(
      jsonRequest(
        '/api/sms/broadcast',
        'POST',
        broadcastPayload([
          { name: 'Flaky', phone: '22345670' },
          { name: 'Fine', phone: '22345671' },
        ]),
        merchant.token,
      ),
      env,
    );
    expect(response.status).toBe(202);

    // The 500 was retried to the cap for the failing recipient before the loop moved on.
    expect(calls).toBe(4);

    const failed = db.query<{ status: string; error: string; phone_normalized: string }>(
      `SELECT status, error, phone_normalized FROM sms_message_log WHERE phone_normalized = ?`,
      failingPhone,
    )[0];
    expect(failed).toMatchObject({ status: 'FAILED', error: 'Gateway rejected the message (HTTP 500).' });

    const ok = db.query<{ status: string; gateway_message_id: string | null }>(
      `SELECT status, gateway_message_id FROM sms_message_log WHERE phone_normalized = ?`,
      '21622345671',
    )[0];
    expect(ok).toMatchObject({ status: 'PENDING', gateway_message_id: 'gw-21622345671' });

    expect(
      db.query<{ status: string; sent_count: number; failed_count: number }>(
        `SELECT status, sent_count, failed_count FROM sms_campaigns`,
      )[0],
    ).toMatchObject({ status: 'PROCESSING', sent_count: 0, failed_count: 1 });
  }, 15_000);
});

describe('POST /api/sms/internal/progress', () => {
  it('rejects a missing or wrong callback secret without touching state', async () => {
    setGateway();
    const campaignId = seedSmsCampaign({ status: 'PROCESSING', total: 2 });
    seedLogRow(campaignId, { phone: '216223456780', status: 'PENDING' });

    const missing = await handleSmsRoute(
      progressRequest({ event: 'sms:sent', payload: { messageId: 'gw-1' } }, null),
      env,
    );
    expect(missing.status).toBe(403);
    const wrong = await handleSmsRoute(
      progressRequest({ event: 'sms:sent', payload: { messageId: 'gw-1' } }, 'nope'),
      env,
    );
    expect(wrong.status).toBe(403);

    expect(
      db.query<{ status: string }>(`SELECT status FROM sms_message_log WHERE campaign_id = ?`, campaignId)[0],
    ).toMatchObject({ status: 'PENDING' });
    expect(
      db.query<{ status: string }>(`SELECT status FROM sms_campaigns WHERE id = ?`, campaignId)[0],
    ).toMatchObject({ status: 'PROCESSING' });
  });

  it('records heartbeats in KV so the gateway reads as ONLINE', async () => {
    setGateway();
    const ping = await handleSmsRoute(progressRequest({ event: 'system:ping' }), env);
    expect(ping.status).toBe(200);
    expect(await env.TOKENS.get('sms:gw:last_seen')).toBeTruthy();

    const started = await handleSmsRoute(progressRequest({ event: 'app:started' }), env);
    expect(started.status).toBe(200);

    const response = await handleSmsRoute(jsonRequest('/api/sms/status', 'GET', undefined, merchant.token), env);
    expect((await body(response)).status.gateway).toEqual({ state: 'ONLINE' });
  });

  it('unsubscribes a STOP sender idempotently and excludes the phone from future broadcasts', async () => {
    setGateway();
    await enableSms();
    // A prior message log row so the owner business is known for the audit trail.
    const campaignId = seedSmsCampaign({ status: 'COMPLETED', total: 1 });
    seedLogRow(campaignId, { phone: '21622345678', status: 'SENT' });

    const stop = await handleSmsRoute(
      progressRequest({ event: 'sms:received', payload: { message: 'STOP', phoneNumber: '+216 22 345 678' } }),
      env,
    );
    expect(stop.status).toBe(200);
    expect(
      db.query<{ phone_normalized: string; reason: string }>(`SELECT phone_normalized, reason FROM sms_suppression`),
    ).toEqual([{ phone_normalized: '21622345678', reason: 'STOP' }]);
    expect(db.query(`SELECT id FROM audit_logs WHERE action = 'sms.suppression.stop'`)).toHaveLength(1);

    const repeat = await handleSmsRoute(
      progressRequest({ event: 'sms:received', payload: { message: 'stop', phoneNumber: '21622345678' } }),
      env,
    );
    expect(repeat.status).toBe(200);
    expect(db.query(`SELECT phone_normalized FROM sms_suppression`)).toHaveLength(1);

    const french = await handleSmsRoute(
      progressRequest({ event: 'sms:received', payload: { message: 'ARRÊTE', phoneNumber: '21622345689' } }),
      env,
    );
    expect(french.status).toBe(200);
    expect(
      db.query<{ phone_normalized: string }>(`SELECT phone_normalized FROM sms_suppression ORDER BY phone_normalized`),
    ).toEqual([{ phone_normalized: '21622345678' }, { phone_normalized: '21622345689' }]);

    stubSmsGatewaySend();
    const broadcast = await handleSmsRoute(
      jsonRequest(
        '/api/sms/broadcast',
        'POST',
        broadcastPayload([
          { name: 'Stopped', phone: '+216 22 345 678' },
          { name: 'Kept', phone: '22345690' },
        ]),
        merchant.token,
      ),
      env,
    );
    expect(broadcast.status).toBe(202);
    expect((await body(broadcast)).campaign.totalRecipients).toBe(1);
  }, 15_000);
});

describe('POST /api/sms/broadcast/:id/cancel', () => {
  it('cancels a queued broadcast, refunds the unsent reservation and calls the gateway DELETE', async () => {
    setGateway();
    await enableSms();
    const fetchMock = stubGatewayFetch();
    const campaignId = seedSmsCampaign({ status: 'QUEUED', total: 5, sent: 1 });
    seedLogRow(campaignId, { phone: '216223456780', status: 'SENT' });
    for (const phone of ['216223456781', '216223456782', '216223456783', '216223456784']) {
      seedLogRow(campaignId, { phone, status: 'PENDING', gatewayMessageId: `gw-${phone}` });
    }
    setSmsCounter(5);

    const response = await handleSmsRoute(
      jsonRequest(`/api/sms/broadcast/${campaignId}/cancel`, 'POST', undefined, merchant.token),
      env,
    );
    expect(response.status).toBe(200);
    const payload = await body(response);
    expect(payload.ok).toBe(true);
    expect(payload.campaign.status).toBe('CANCELLED');

    const log = db.query<{ status: string; error: string }>(
      `SELECT status, error FROM sms_message_log WHERE status = 'CANCELLED'`,
    );
    expect(log).toHaveLength(4);
    expect(log[0].error).toBe('Cancelled before delivery.');

    // 5 reserved - 4 unsent = 1 kept.
    expect(readSmsCounter().sent).toBe(1);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('DELETE');
    expect(String(url)).toContain(`${GATEWAY_BASE_URL}/message/`);
    expect(new Headers(init.headers).get('authorization')).toBe(expectedAuthHeader());
  }, 15_000);

  it('refuses to cancel a finished broadcast and never refunds twice', async () => {
    setGateway();
    await enableSms();
    const campaignId = seedSmsCampaign({ status: 'COMPLETED', total: 5, sent: 5 });
    setSmsCounter(5);

    const response = await handleSmsRoute(
      jsonRequest(`/api/sms/broadcast/${campaignId}/cancel`, 'POST', undefined, merchant.token),
      env,
    );
    expect(response.status).toBe(409);
    expect(readSmsCounter().sent).toBe(5);
  });
});

describe('POST /api/sms/broadcast/:id/resume', () => {
  it('re-dispatches only the recipients without a delivered message log, without re-reserving quota', async () => {
    setGateway();
    await enableSms();
    const fetchMock = stubSmsGatewaySend();
    const campaignId = seedSmsCampaign({
      status: 'FAILED',
      recipients: [
        { name: 'Delivered', phone: '216223456780' },
        { name: 'Pending', phone: '216223456781' },
      ],
    });
    seedLogRow(campaignId, { phone: '216223456780', status: 'SENT' });
    seedLogRow(campaignId, { phone: '216223456781', status: 'FAILED', error: 'Gateway rejected the message (HTTP 500).' });
    setSmsCounter(2);

    const response = await handleSmsRoute(
      jsonRequest(`/api/sms/broadcast/${campaignId}/resume`, 'POST', undefined, merchant.token),
      env,
    );
    expect(response.status).toBe(200);
    expect((await body(response)).campaign.status).toBe('PROCESSING');

    const sendCall = fetchMock.mock.calls.find(
      (call) => String((call as unknown as [RequestInfo, RequestInit])[0]).endsWith('/message'),
    );
    expect(sendCall).toBeTruthy();
    expect(JSON.parse(String((sendCall as unknown as [RequestInfo, RequestInit])[1]?.body)).phoneNumbers).toEqual([
      '216223456781',
    ]);

    // The failed row was re-armed for the gateway lifecycle.
    expect(
      db.query<{ status: string }>(
        `SELECT status FROM sms_message_log WHERE phone_normalized = ?`,
        '216223456781',
      )[0],
    ).toMatchObject({ status: 'PENDING' });

    // Counter stays: resume re-uses the original reservation.
    expect(readSmsCounter().sent).toBe(2);

    const completed = await handleSmsRoute(
      progressRequest({ event: 'sms:sent', payload: { messageId: 'gw-216223456781' } }),
      env,
    );
    expect(completed.status).toBe(200);
    expect(
      db.query<{ status: string; sent_count: number; failed_count: number }>(
        `SELECT status, sent_count, failed_count FROM sms_campaigns WHERE id = ?`,
        campaignId,
      )[0],
    ).toMatchObject({ status: 'COMPLETED', sent_count: 2, failed_count: 0 });

    expect(db.query(`SELECT id FROM audit_logs WHERE action = 'sms.broadcast.resumed'`)).toHaveLength(1);
  }, 15_000);
});

describe('runReconcile SMS settlement', () => {
  it('settles a stale processing campaign and refunds the unsent messages', async () => {
    const now = new Date().toISOString();
    const campaignId = seedSmsCampaign({ status: 'PROCESSING', total: 5, sent: 1 });
    db.prepare(`UPDATE sms_campaigns SET updated_at = ? WHERE id = ?`).bind(iso(-40 * 60_000), campaignId).run();
    seedLogRow(campaignId, { phone: '216223456780', status: 'SENT' });
    for (const phone of ['216223456781', '216223456782', '216223456783', '216223456784']) {
      seedLogRow(campaignId, { phone, status: 'PENDING' });
    }
    setSmsCounter(5);

    await runReconcile(env);

    const row = db.query<{ status: string; sent_count: number; failed_count: number; last_error: string }>(
      `SELECT status, sent_count, failed_count, last_error FROM sms_campaigns WHERE id = ?`,
      campaignId,
    )[0];
    expect(row.status).toBe('FAILED');
    expect(row.last_error).toContain('Unsent messages were refunded');
    expect(row.failed_count).toBe(4);
    if (row.sent_count !== 1) throw new Error('sent counter must survive the settle');

    // 5 reserved - 4 unsent refunded = 1 kept.
    expect(readSmsCounter().sent).toBe(1);
  });

  it('settles a stale queued campaign too', async () => {
    const campaignId = seedSmsCampaign({ status: 'QUEUED', total: 2 });
    db.prepare(`UPDATE sms_campaigns SET updated_at = ? WHERE id = ?`).bind(iso(-40 * 60_000), campaignId).run();
    for (const phone of ['216223456780', '216223456781']) {
      seedLogRow(campaignId, { phone, status: 'PENDING' });
    }
    setSmsCounter(2);

    await runReconcile(env);

    expect(
      db.query<{ status: string }>(`SELECT status FROM sms_campaigns WHERE id = ?`, campaignId)[0].status,
    ).toBe('FAILED');
    expect(readSmsCounter().sent).toBe(0);
  });

  it('leaves a fresh campaign alone', async () => {
    const campaignId = seedSmsCampaign({ status: 'PROCESSING', total: 5, sent: 1, failed: 0 });
    db.prepare(`UPDATE sms_campaigns SET updated_at = ? WHERE id = ?`).bind(iso(-10 * 60_000), campaignId).run();

    await runReconcile(env);

    expect(
      db.query<{ status: string }>(`SELECT status FROM sms_campaigns WHERE id = ?`, campaignId)[0].status,
    ).toBe('PROCESSING');
  });
});

describe('runReconcile SMS log garbage collection', () => {
  it('deletes sms_message_log rows past the 180-day window and keeps the rest', async () => {
    const stale = seedSmsCampaign({ status: 'COMPLETED', total: 2, sent: 2 });
    db.prepare(
      `INSERT INTO sms_message_log
         (id, campaign_id, business_id, phone, phone_normalized, status, created_at, updated_at)
       VALUES (?, ?, ?, '21622345678', '21622345678', 'SENT', ?, ?)`,
    )
      .bind(crypto.randomUUID(), stale, merchant.businessId, iso(-181 * DAY_MS), iso(-181 * DAY_MS))
      .run();
    db.prepare(
      `INSERT INTO sms_message_log
         (id, campaign_id, business_id, phone, phone_normalized, status, created_at, updated_at)
       VALUES (?, ?, ?, '21622345689', '21622345689', 'SENT', ?, ?)`,
    )
      .bind(crypto.randomUUID(), stale, merchant.businessId, iso(-179 * DAY_MS), iso(-179 * DAY_MS))
      .run();

    await runReconcile(env);

    const kept = db.query<{ phone_normalized: string }>(`SELECT phone_normalized FROM sms_message_log`);
    expect(kept).toEqual([{ phone_normalized: '21622345689' }]);
  });
});
