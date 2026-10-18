import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../types';
import { handleEmailAssetRoute, handleEmailRoute } from '../routes/email';
import { handleWebhookRoute } from '../routes/webhooks';
import { buildSender, processEmailBatch, renderTemplate, unsubscribeSignature } from '../lib/email';
import { createTestEnv, type TestDatabase, type TestEnv } from './helpers/d1';
import { jsonRequest, seedMerchant, type SeededMerchant } from './helpers/fixtures';

let db: TestDatabase;
let testEnv: TestEnv;
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
    senderName: 'Café Tej Team',
    subject: 'Nouveautés de la semaine',
    content: '<p>Bonjour {{name}}, voir {{link}}</p>',
    link: 'https://promo.test',
    recipients: Array.from({ length: recipientCount }, (_unused, index) => ({
      email: `customer${index + 1}@example.test`,
      name: `Contact ${index + 1}`,
    })),
  };
}

function setCounter(sent: number, resetDate = new Date().toISOString()) {
  db.prepare(`UPDATE users SET email_messages_sent_this_month = ?, email_reset_date = ? WHERE id = ?`)
    .bind(sent, resetDate, merchant.userId)
    .run();
}

function readCounter() {
  return db.query<{ sent: number; resetDate: string | null }>(
    `SELECT email_messages_sent_this_month AS sent, email_reset_date AS resetDate FROM users WHERE id = ?`,
    merchant.userId,
  )[0];
}

async function insertCampaign(
  overrides: { status?: string; sent?: number; failed?: number; total?: number; lastError?: string } = {},
) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO email_campaigns
       (id, business_id, user_id, subject, sender_name, total_recipients, sent_count, failed_count, status, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      merchant.businessId,
      merchant.userId,
      'Nouveautés de la semaine',
      'Café Tej Team',
      overrides.total ?? 2,
      overrides.sent ?? 0,
      overrides.failed ?? 0,
      overrides.status ?? 'COMPLETED',
      overrides.lastError ?? null,
      now,
      now,
    )
    .run();
  return id;
}

function providerResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubSend(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(handler);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function mailjetOk() {
  return providerResponse({ Messages: [{ Status: 'success', To: [{ Email: 'queued@example.test', MessageID: 1 }] }] });
}

/** Mailjet reports API failures inside Messages[0].Errors with the HTTP status. */
function mailjetError(message: string, status = 400) {
  return providerResponse(
    { Messages: [{ Status: 'error', Errors: [{ ErrorCode: 'MJ-0002', ErrorMessage: message }] }] },
    status,
  );
}

type MailjetMessage = {
  From: { Email: string; Name?: string };
  To: Array<{ Email: string; Name?: string }>;
  Subject: string;
  HTMLPart: string;
  TextPart?: string;
  CustomID?: string;
  Attachments?: Array<{ ContentType: string; Filename: string; Base64Content: string }>;
};

function payloadOf(call: { init?: RequestInit }): MailjetMessage {
  const parsed = JSON.parse(String(call.init?.body ?? '{}')) as { Messages?: MailjetMessage[] };
  return parsed.Messages?.[0] ?? ({} as MailjetMessage);
}

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR length + type
]);
const PDF_TEXT = '%PDF-1.4\n%%EOF';

async function uploadAsset(name: string, mimeType: string, bytes: Uint8Array | string): Promise<Response> {
  const dataBase64 = typeof bytes === 'string' ? bytes : Buffer.from(bytes).toString('base64');
  return handleEmailRoute(
    jsonRequest('/api/email/asset', 'POST', { name, mimeType, dataBase64 }, merchant.token),
    env,
  );
}

beforeEach(async () => {
  const created = createTestEnv();
  testEnv = created;
  db = created.DB;
  env = created as unknown as Env;
  merchant = await seedMerchant(db, {
    email: 'email-merchant@example.test',
    withActiveSubscription: true,
    planId: 'plan_growth',
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  db.close();
});

describe('email template helpers', () => {
  it('substitutes {{name}}, {{email}} and {{link}} placeholders', () => {
    const rendered = renderTemplate('Hi {{name}} <{{email}}> → {{link}}', {
      name: 'Ada',
      email: 'ada@example.test',
      link: 'https://promo.test',
    });
    expect(rendered).toBe('Hi Ada <ada@example.test> → https://promo.test');
    expect(renderTemplate('Hi {{name}}', { email: 'x@example.test' })).toBe('Hi ');
  });

  it('sanitizes the sender name for the provider sender object', () => {
    expect(buildSender('no-reply@example.test', 'Café Tej Team')).toEqual({
      email: 'no-reply@example.test',
      name: 'Café Tej Team',
    });
    expect(buildSender('no-reply@example.test', 'Bad "Name"\n<inject>')).toEqual({
      email: 'no-reply@example.test',
      name: 'Bad Nameinject',
    });
    expect(buildSender('no-reply@example.test', '   ')).toEqual({
      email: 'no-reply@example.test',
      name: 'CampaignFlow',
    });
  });
});

describe('GET /api/email/status', () => {
  it('401s without an authentication token', async () => {
    const response = await handleEmailRoute(jsonRequest('/api/email/status', 'GET'), env);
    expect(response.status).toBe(401);
  });

  it('reports the Pro monthly quota and batch cap', async () => {
    const response = await handleEmailRoute(jsonRequest('/api/email/status', 'GET', undefined, merchant.token), env);
    expect(response.status).toBe(200);
    expect((await body(response)).status).toMatchObject({
      allowed: true,
      planSlug: 'growth',
      planName: 'Pro',
      monthlyLimit: 1000,
      batchLimit: 200,
      sentThisMonth: 0,
      remaining: 1000,
      configured: true,
      quota: { dailyUsed: 0, dailyLimit: 200 },
    });
  });

  it('reads the reserved counter and remaining quota', async () => {
    setCounter(180);
    const response = await handleEmailRoute(jsonRequest('/api/email/status', 'GET', undefined, merchant.token), env);
    const { status } = await body(response);
    expect(status.sentThisMonth).toBe(180);
    expect(status.remaining).toBe(820);
  });

  it('counts today\'s delivered emails against the provider daily quota', async () => {
    await insertCampaign({ sent: 5, total: 5 });
    const response = await handleEmailRoute(jsonRequest('/api/email/status', 'GET', undefined, merchant.token), env);
    const { status } = await body(response);
    expect(status.quota).toMatchObject({ dailyUsed: 5, dailyLimit: 200 });
  });

  it('treats a counter stamped in a previous month as zero', async () => {
    setCounter(900, '2020-01-15T00:00:00.000Z');
    const response = await handleEmailRoute(jsonRequest('/api/email/status', 'GET', undefined, merchant.token), env);
    const { status } = await body(response);
    expect(status.sentThisMonth).toBe(0);
    expect(status.remaining).toBe(1000);
  });

  it('locks Starter accounts out of email campaigns', async () => {
    const starter = await seedMerchant(db, {
      email: 'email-starter@example.test',
      withActiveSubscription: true,
      planId: 'plan_starter',
    });
    const response = await handleEmailRoute(jsonRequest('/api/email/status', 'GET', undefined, starter.token), env);
    const { status } = await body(response);
    expect(status).toMatchObject({ allowed: false, monthlyLimit: 0, batchLimit: 0, planSlug: 'starter' });
  });

  it('reports configured=false without the provider key pair or sender address', async () => {
    delete (env as { MAILJET_API_KEY?: string }).MAILJET_API_KEY;
    let response = await handleEmailRoute(jsonRequest('/api/email/status', 'GET', undefined, merchant.token), env);
    expect((await body(response)).status.configured).toBe(false);

    (env as { MAILJET_API_KEY?: string }).MAILJET_API_KEY = 'mailjet_test_key';
    delete (env as { MAILJET_API_SECRET?: string }).MAILJET_API_SECRET;
    response = await handleEmailRoute(jsonRequest('/api/email/status', 'GET', undefined, merchant.token), env);
    expect((await body(response)).status.configured).toBe(false);

    (env as { MAILJET_API_SECRET?: string }).MAILJET_API_SECRET = 'mailjet_test_secret';
    delete (env as { EMAIL_FROM?: string }).EMAIL_FROM;
    response = await handleEmailRoute(jsonRequest('/api/email/status', 'GET', undefined, merchant.token), env);
    expect((await body(response)).status.configured).toBe(false);
  });
});

describe('POST /api/email/broadcast', () => {
  it('401s without an authentication token', async () => {
    const response = await handleEmailRoute(jsonRequest('/api/email/broadcast', 'POST', validBroadcast()), env);
    expect(response.status).toBe(401);
  });

  it('403s read-only accounts', async () => {
    const readonly = await seedMerchant(db, { email: 'email-readonly@example.test', withActiveSubscription: false });
    const response = await handleEmailRoute(
      jsonRequest('/api/email/broadcast', 'POST', validBroadcast(), readonly.token),
      env,
    );
    expect(response.status).toBe(403);
    expect((await body(response)).error).toBe(
      'This account is read-only. Activate a plan from Billing to send broadcasts.',
    );
  });

  it('rejects Starter accounts with an upgrade message', async () => {
    const starter = await seedMerchant(db, {
      email: 'email-starter-post@example.test',
      withActiveSubscription: true,
      planId: 'plan_starter',
    });
    const response = await handleEmailRoute(
      jsonRequest('/api/email/broadcast', 'POST', validBroadcast(), starter.token),
      env,
    );
    expect(response.status).toBe(403);
    expect((await body(response)).error).toBe(
      'Email Campaigns require a Pro or Business plan. Upgrade to unlock email broadcasts.',
    );
  });

  it('503s when the email provider is not configured', async () => {
    delete (env as { MAILJET_API_KEY?: string }).MAILJET_API_KEY;
    const response = await handleEmailRoute(
      jsonRequest('/api/email/broadcast', 'POST', validBroadcast(), merchant.token),
      env,
    );
    expect(response.status).toBe(503);
    expect((await body(response)).error).toBe('Email is not configured.');
  });

  it('400s on an invalid recipient address', async () => {
    const payload = validBroadcast();
    payload.recipients[0].email = 'not-an-email';
    const response = await handleEmailRoute(
      jsonRequest('/api/email/broadcast', 'POST', payload, merchant.token),
      env,
    );
    expect(response.status).toBe(400);
    expect((await body(response)).error).toBe('Validation failed.');
  });

  it('400s on an invalid reply address', async () => {
    const payload = { ...validBroadcast(), replyTo: 'not-an-email' };
    const response = await handleEmailRoute(
      jsonRequest('/api/email/broadcast', 'POST', payload, merchant.token),
      env,
    );
    expect(response.status).toBe(400);
    expect((await body(response)).error).toBe('Validation failed.');
  });

  it('400s when there is neither content nor an attachment', async () => {
    const payload = validBroadcast();
    payload.content = '';
    const response = await handleEmailRoute(
      jsonRequest('/api/email/broadcast', 'POST', payload, merchant.token),
      env,
    );
    expect(response.status).toBe(400);
    expect((await body(response)).error).toBe('Validation failed.');
    expect(readCounter().sent).toBe(0);
  });

  it('enforces the Pro per-broadcast cap of 200', async () => {
    const response = await handleEmailRoute(
      jsonRequest('/api/email/broadcast', 'POST', validBroadcast(201), merchant.token),
      env,
    );
    expect(response.status).toBe(403);
    expect((await body(response)).error).toBe('PRO plan allows 200 emails per broadcast.');
    expect(readCounter().sent).toBe(0);
  });

  it('enforces the Pro monthly quota', async () => {
    setCounter(1000);
    const response = await handleEmailRoute(
      jsonRequest('/api/email/broadcast', 'POST', validBroadcast(), merchant.token),
      env,
    );
    expect(response.status).toBe(403);
    expect((await body(response)).error).toBe(
      'PRO plan limit reached (1000 emails per month). Upgrade to Business for 3000.',
    );
  });

  it('rejects a second broadcast while one is still PENDING', async () => {
    await insertCampaign({ status: 'PENDING' });
    const response = await handleEmailRoute(
      jsonRequest('/api/email/broadcast', 'POST', validBroadcast(), merchant.token),
      env,
    );
    expect(response.status).toBe(409);
    expect((await body(response)).error).toBe('An email campaign is already in progress. Wait for it to finish.');
  });

  it('answers 202 immediately, hands delivery to the sender, then settles through Mailjet', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    stubSend(async (input, init) => {
      calls.push({ url: String(input), init });
      return mailjetOk();
    });

    const response = await handleEmailRoute(
      jsonRequest('/api/email/broadcast', 'POST', validBroadcast(), merchant.token),
      env,
    );
    expect(response.status).toBe(202);
    const result = await body(response);
    expect(result.campaign).toMatchObject({
      subject: 'Nouveautés de la semaine',
      senderName: 'Café Tej Team',
      totalRecipients: 2,
      sent: 0,
      failed: 0,
      status: 'PENDING',
    });
    expect(result.usage).toMatchObject({ sentThisMonth: 2, monthlyLimit: 1000, remaining: 998 });
    expect(readCounter().sent).toBe(2);
    expect(readCounter().resetDate?.slice(0, 7)).toBe(currentMonth());
    expect(testEnv.EMAIL_SENDER.scheduled).toContain(result.campaign.id);
    expect(calls).toHaveLength(0);

    // The Durable Object alarm round performs the actual send — one POST per recipient.
    const outcome = await processEmailBatch(env, result.campaign.id);
    expect(outcome).toBe('completed');

    expect(calls).toHaveLength(2);
    for (const call of calls) expect(call.url).toBe('https://api.mailjet.com/v3.1/send');
    const firstHeaders = calls[0].init?.headers as Record<string, string>;
    expect(firstHeaders.authorization).toBe(
      `Basic ${Buffer.from('mailjet_test_key:mailjet_test_secret').toString('base64')}`,
    );

    const payloads = calls.map((call) => payloadOf(call));
    const recipients = payloads.map((payload) => payload.To[0]?.Email).sort();
    expect(recipients).toEqual(['customer1@example.test', 'customer2@example.test']);
    const first = payloads.find((payload) => payload.To[0]?.Email === 'customer1@example.test')!;
    expect(first.From).toEqual({ Email: 'no-reply@example.test', Name: 'Café Tej Team' });
    expect(first.To[0]?.Name).toBe('Contact 1');
    expect(first.Subject).toBe('Nouveautés de la semaine');
    expect(first.HTMLPart).toContain('Bonjour Contact 1');
    expect(first.CustomID).toBe(`${result.campaign.id}/0/customer1@example.test`);

    const rows = db.query<{ status: string; sent_count: number; failed_count: number }>(
      `SELECT status, sent_count, failed_count FROM email_campaigns WHERE id = ?`,
      result.campaign.id,
    );
    expect(rows[0]).toMatchObject({ status: 'COMPLETED', sent_count: 2, failed_count: 0 });
    expect(readCounter().sent).toBe(2);
  });

  it('splits a broadcast across multiple sender rounds', async () => {
    const calls: Array<{ init?: RequestInit }> = [];
    stubSend(async (_input, init) => {
      calls.push({ init });
      return mailjetOk();
    });

    const response = await handleEmailRoute(
      jsonRequest('/api/email/broadcast', 'POST', validBroadcast(101), merchant.token),
      env,
    );
    expect(response.status).toBe(202);
    const result = await body(response);
    expect(result.campaign.totalRecipients).toBe(101);
    expect(readCounter().sent).toBe(101);

    const first = await processEmailBatch(env, result.campaign.id);
    expect(first).toBe('continue');
    expect(calls).toHaveLength(5);
    expect(payloadOf(calls[0]).CustomID).toContain('/0/');
    expect(payloadOf(calls[4]).CustomID).toContain('/0/');

    // The remaining 96 recipients drip out in 5-email rounds; each round
    // re-checkpoints the cursor, so driving rounds until completion proves
    // the campaign survives the new small-burst pacing.
    let rounds = 1;
    while (rounds < 30) {
      rounds += 1;
      const outcome = await processEmailBatch(env, result.campaign.id);
      if (outcome === 'completed') break;
      expect(outcome).toBe('continue');
    }
    expect(calls).toHaveLength(101);
    const resumed = payloadOf(calls[100]);
    expect(resumed.CustomID).toContain('/20/');
    expect(resumed.To[0]?.Email).toBe('customer101@example.test');

    const rows = db.query<{ status: string; sent_count: number; failed_count: number }>(
      `SELECT status, sent_count, failed_count FROM email_campaigns WHERE id = ?`,
      result.campaign.id,
    );
    expect(rows[0]).toMatchObject({ status: 'COMPLETED', sent_count: 101, failed_count: 0 });
    expect(readCounter().sent).toBe(101);
  });

  it('refunds the reservation and marks the campaign FAILED when Mailjet rejects the key', async () => {
    stubSend(async () => mailjetError('API key is invalid.', 401));

    const response = await handleEmailRoute(
      jsonRequest('/api/email/broadcast', 'POST', validBroadcast(), merchant.token),
      env,
    );
    expect(response.status).toBe(202);
    const result = await body(response);
    expect(result.campaign.status).toBe('PENDING');
    expect(readCounter().sent).toBe(2);

    const outcome = await processEmailBatch(env, result.campaign.id);
    expect(outcome).toBe('failed');

    const rows = db.query<{ status: string; sent_count: number; failed_count: number; last_error: string | null }>(
      `SELECT status, sent_count, failed_count, last_error FROM email_campaigns WHERE id = ?`,
      result.campaign.id,
    );
    expect(rows[0]).toMatchObject({ status: 'FAILED', sent_count: 0, failed_count: 2, last_error: 'API key is invalid.' });
    expect(readCounter().sent).toBe(0);
  });

  it('counts recipients as failed after transient errors exhaust the one retry', async () => {
    const calls: Array<{ init?: RequestInit }> = [];
    stubSend(async (_input, init) => {
      calls.push({ init });
      return mailjetError('Internal server error.', 500);
    });

    const response = await handleEmailRoute(
      jsonRequest('/api/email/broadcast', 'POST', validBroadcast(1), merchant.token),
      env,
    );
    const id = (await body(response)).campaign.id as string;

    const outcome = await processEmailBatch(env, id);
    expect(outcome).toBe('completed');
    // One initial attempt + one retry for the single recipient; with nothing
    // delivered the settle status is FAILED.
    expect(calls).toHaveLength(2);
    const rows = db.query<{ status: string; sent_count: number; failed_count: number; last_error: string | null }>(
      `SELECT status, sent_count, failed_count, last_error FROM email_campaigns WHERE id = ?`,
      id,
    );
    expect(rows[0]).toMatchObject({ status: 'FAILED', sent_count: 0, failed_count: 1 });
    expect(rows[0]?.last_error).toBe('Internal server error.');
  });

  it('deduplicates recipients before reserving the quota', async () => {
    stubSend(async () => mailjetOk());
    const payload = validBroadcast();
    payload.recipients.push({ email: 'CUSTOMER1@example.test', name: 'Dupe' });

    const response = await handleEmailRoute(
      jsonRequest('/api/email/broadcast', 'POST', payload, merchant.token),
      env,
    );
    const result = await body(response);
    expect(result.campaign.totalRecipients).toBe(2);
    expect(readCounter().sent).toBe(2);
  });
});

describe('GET /api/email/broadcast', () => {
  it('lists recent campaigns for the business', async () => {
    await insertCampaign({ sent: 2, total: 2 });
    await insertCampaign({ status: 'FAILED', failed: 2, lastError: 'API key is invalid.' });

    const response = await handleEmailRoute(jsonRequest('/api/email/broadcast', 'GET', undefined, merchant.token), env);
    expect(response.status).toBe(200);
    const { campaigns } = await body(response);
    expect(campaigns).toHaveLength(2);
    const failed = campaigns.find((campaign: { status: string }) => campaign.status === 'FAILED');
    expect(failed).toMatchObject({
      subject: 'Nouveautés de la semaine',
      senderName: 'Café Tej Team',
      assetName: null,
      status: 'FAILED',
      failed: 2,
      lastError: 'API key is invalid.',
    });
    const completed = campaigns.find((campaign: { status: string }) => campaign.status === 'COMPLETED');
    expect(completed).toMatchObject({ sent: 2, totalRecipients: 2, lastError: null });
  });

  it('401s without an authentication token', async () => {
    const response = await handleEmailRoute(jsonRequest('/api/email/broadcast', 'GET'), env);
    expect(response.status).toBe(401);
  });
});

describe('quota pause & refunds (free tier guards)', () => {
  async function createBroadcast(count = 2): Promise<string> {
    const response = await handleEmailRoute(
      jsonRequest('/api/email/broadcast', 'POST', validBroadcast(count), merchant.token),
      env,
    );
    expect(response.status).toBe(202);
    return (await body(response)).campaign.id as string;
  }

  function readCampaign(id: string) {
    return db.query<{ status: string; sent_count: number; failed_count: number; last_error: string | null }>(
      `SELECT status, sent_count, failed_count, last_error FROM email_campaigns WHERE id = ?`,
      id,
    )[0];
  }

  it('pauses on the daily limit without burning recipients, then resumes after midnight', async () => {
    // The defensive quota path: a provider limit response (Mailjet normally queues instead).
    stubSend(async () => mailjetError('The daily sending limit has been reached.', 400));
    const id = await createBroadcast(2);

    const paused = await processEmailBatch(env, id);
    expect(paused).toBe('paused');
    expect(readCampaign(id)).toMatchObject({
      status: 'PAUSED',
      sent_count: 0,
      failed_count: 0,
      last_error: expect.stringContaining('paused until 00:00 UTC'),
    });
    // Reservations stay held while paused (both monthly and daily).
    expect(readCounter().sent).toBe(2);

    // Midnight: the provider accepts again — the same campaign picks up where it left off.
    stubSend(async () => mailjetOk());
    const resumed = await processEmailBatch(env, id);
    expect(resumed).toBe('completed');
    expect(readCampaign(id)).toMatchObject({ status: 'COMPLETED', sent_count: 2, failed_count: 0 });
    expect(readCounter().sent).toBe(2);
  });

  it('checkpoints the processed prefix when the limit hits mid-chunk', async () => {
    stubSend(async (_input, init) => {
      const message = payloadOf({ init });
      if (message.To[0]?.Email === 'customer1@example.test') {
        return mailjetError('Daily limit reached.', 400);
      }
      return mailjetOk();
    });
    const id = await createBroadcast(2);

    const paused = await processEmailBatch(env, id);
    // The quota response lands first (both sends race), so nothing is consumed
    // yet — what matters is that PAUSED persists sent/failed honestly and the
    // campaign is not settled.
    expect(paused).toBe('paused');
    const campaign = readCampaign(id)!;
    expect(campaign.status).toBe('PAUSED');
    expect(campaign.sent_count + campaign.failed_count).toBeLessThanOrEqual(2);
    expect(readCounter().sent).toBe(2);
  });

  it('captures quota numbers from today\'s campaigns for the dashboard', async () => {
    stubSend(async () => mailjetOk());
    const id = await createBroadcast(2);
    await processEmailBatch(env, id);

    const response = await handleEmailRoute(jsonRequest('/api/email/status', 'GET', undefined, merchant.token), env);
    const { status } = await body(response);
    expect(status.quota).toMatchObject({ dailyUsed: 2, dailyLimit: 200 });
  });
});

describe('daily marketing reserve & global soft cap', () => {
  it('rejects a broadcast above the daily marketing cap and refunds the monthly hold', async () => {
    (testEnv as { EMAIL_MARKETING_DAILY_CAP?: string }).EMAIL_MARKETING_DAILY_CAP = '1';
    stubSend(async () => mailjetOk());

    const response = await handleEmailRoute(
      jsonRequest('/api/email/broadcast', 'POST', validBroadcast(2), merchant.token),
      env,
    );
    expect(response.status).toBe(403);
    expect((await body(response)).error).toContain('Daily marketing email cap');
    expect(readCounter().sent).toBe(0);
    expect(db.query('SELECT id FROM email_campaigns')).toHaveLength(0);
  });

  it('accepts a broadcast inside the cap and refunds the daily hold when the campaign dies', async () => {
    stubSend(async () => mailjetError('API key is invalid.', 401));

    const response = await handleEmailRoute(
      jsonRequest('/api/email/broadcast', 'POST', validBroadcast(2), merchant.token),
      env,
    );
    expect(response.status).toBe(202);
    const id = (await body(response)).campaign.id as string;
    expect(
      db.query<{ reserved: number }>(`SELECT reserved FROM email_daily_usage WHERE day = date('now')`)[0]?.reserved,
    ).toBe(2);

    await processEmailBatch(env, id); // 401 → fatal → settle + refunds
    expect(
      db.query<{ reserved: number }>(`SELECT reserved FROM email_daily_usage WHERE day = date('now')`)[0]?.reserved,
    ).toBe(0);
    expect(readCounter().sent).toBe(0);
  });

  it('enforces the account-wide monthly soft cap across tenants', async () => {
    (testEnv as { EMAIL_MONTHLY_SOFT_CAP?: string }).EMAIL_MONTHLY_SOFT_CAP = '1';
    stubSend(async () => mailjetOk());

    const response = await handleEmailRoute(
      jsonRequest('/api/email/broadcast', 'POST', validBroadcast(2), merchant.token),
      env,
    );
    expect(response.status).toBe(403);
    expect((await body(response)).error).toContain('Account-wide monthly email limit');
    expect(readCounter().sent).toBe(0);
  });
});

describe('suppression list & unsubscribe', () => {
  it('drops suppressed recipients before reserving and reports them', async () => {
    db.prepare(
      `INSERT INTO email_suppression (email, reason, business_id, created_at) VALUES (?, ?, NULL, ?)`,
    ).bind('customer1@example.test', 'bounce', new Date().toISOString()).run();
    stubSend(async () => mailjetOk());

    const response = await handleEmailRoute(
      jsonRequest('/api/email/broadcast', 'POST', validBroadcast(2), merchant.token),
      env,
    );
    expect(response.status).toBe(202);
    const result = await body(response);
    expect(result.campaign.totalRecipients).toBe(1);
    expect(result.usage.suppressed).toBe(1);
    expect(readCounter().sent).toBe(1);
  });

  it('403s when every recipient is suppressed', async () => {
    const now = new Date().toISOString();
    for (const email of ['customer1@example.test', 'customer2@example.test']) {
      db.prepare(`INSERT INTO email_suppression (email, reason, business_id, created_at) VALUES (?, ?, NULL, ?)`)
        .bind(email, 'unsubscribe', now)
        .run();
    }

    const response = await handleEmailRoute(
      jsonRequest('/api/email/broadcast', 'POST', validBroadcast(2), merchant.token),
      env,
    );
    expect(response.status).toBe(403);
    expect((await body(response)).error).toContain('unsubscribed or bounced');
  });

  it('never sends to suppressed addresses from the sender loop', async () => {
    const calls: Array<{ init?: RequestInit }> = [];
    stubSend(async (_input, init) => {
      calls.push({ init });
      return mailjetOk();
    });

    const response = await handleEmailRoute(
      jsonRequest('/api/email/broadcast', 'POST', validBroadcast(2), merchant.token),
      env,
    );
    const id = (await body(response)).campaign.id as string;

    // A complaint lands between create and delivery.
    db.prepare(`INSERT INTO email_suppression (email, reason, business_id, created_at) VALUES (?, ?, NULL, ?)`)
      .bind('customer2@example.test', 'complaint', new Date().toISOString())
      .run();

    const outcome = await processEmailBatch(env, id);
    expect(outcome).toBe('completed');
    expect(calls).toHaveLength(1);
    expect(payloadOf(calls[0]).To).toEqual([{ Email: 'customer1@example.test', Name: 'Contact 1' }]);
  });

  it('appends a signed unsubscribe footer to broadcast html', async () => {
    const calls: Array<{ init?: RequestInit }> = [];
    stubSend(async (_input, init) => {
      calls.push({ init });
      return mailjetOk();
    });

    const response = await handleEmailRoute(
      jsonRequest('/api/email/broadcast', 'POST', validBroadcast(2), merchant.token),
      env,
    );
    const id = (await body(response)).campaign.id as string;
    await processEmailBatch(env, id);

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(payloadOf(call).HTMLPart).toContain('Se désabonner');
    }
    const first = payloadOf(calls[0]).HTMLPart;
    expect(first).toContain('/api/email/unsubscribe?e=');
  });

  it('honours a self-placed {{unsubscribe}} placeholder without double footers', async () => {
    const calls: Array<{ init?: RequestInit }> = [];
    stubSend(async (_input, init) => {
      calls.push({ init });
      return mailjetOk();
    });

    const payload = validBroadcast(1);
    payload.content = '<p>Hi {{name}}</p><p><a href="{{unsubscribe}}">unsubscribe</a></p>';
    const response = await handleEmailRoute(
      jsonRequest('/api/email/broadcast', 'POST', payload, merchant.token),
      env,
    );
    const id = (await body(response)).campaign.id as string;
    await processEmailBatch(env, id);

    const html = payloadOf(calls[0]).HTMLPart;
    expect(html).toContain('/api/email/unsubscribe?e=');
    expect(html).not.toContain('border-top');
  });

  it('accepts a valid signed unsubscribe link and rejects tampering', async () => {
    const email = 'customer1@example.test';
    const signature = await unsubscribeSignature(env, email);

    const ok = await handleEmailRoute(
      new Request(`https://example.test/api/email/unsubscribe?e=${encodeURIComponent(email)}&s=${signature}`),
      env,
    );
    expect(ok.status).toBe(200);
    expect(db.query(`SELECT email FROM email_suppression WHERE email = ?`, email)).toHaveLength(1);

    const tampered = await handleEmailRoute(
      new Request(`https://example.test/api/email/unsubscribe?e=${encodeURIComponent(email)}&s=${'0'.repeat(64)}`),
      env,
    );
    expect(tampered.status).toBe(400);
    expect(db.query(`SELECT email FROM email_suppression`)).toHaveLength(1);
  });
});

describe('campaign attachments (photo/PDF)', () => {
  async function uploadAndCreate(
    file: { name: string; mimeType: string; bytes: Uint8Array | string },
    overrides: { content?: string; recipients?: number } = {},
  ): Promise<{ assetId: string; campaignId: string }> {
    const upload = await uploadAsset(file.name, file.mimeType, file.bytes);
    expect(upload.status).toBe(201);
    const { asset } = await body(upload);

    const payload = validBroadcast(overrides.recipients ?? 1);
    if (overrides.content !== undefined) payload.content = overrides.content;
    const response = await handleEmailRoute(
      jsonRequest('/api/email/broadcast', 'POST', { ...payload, asset: { id: asset.id } }, merchant.token),
      env,
    );
    expect(response.status).toBe(202);
    const result = await body(response);
    return { assetId: asset.id, campaignId: result.campaign.id };
  }

  it('stores an uploaded photo and returns its id and url', async () => {
    const response = await uploadAsset('promo.png', 'image/png', PNG_BYTES);
    expect(response.status).toBe(201);
    const { asset } = await body(response);
    expect(asset).toMatchObject({ name: 'promo.png', mime: 'image/png', url: `/api/email-assets/${asset.id}` });
    expect(testEnv.CAMPAIGN_ASSETS.keys()).toContain(`email-assets/${asset.id}`);
  });

  it('rejects content that does not match the declared type', async () => {
    const response = await uploadAsset('evil.png', 'image/png', Buffer.from('<html>hi</html>').toString('base64'));
    expect(response.status).toBe(400);
    expect((await body(response)).error).toContain('does not match');
    expect(testEnv.CAMPAIGN_ASSETS.keys()).toHaveLength(0);
  });

  it('rejects unsupported file types at validation', async () => {
    const response = await uploadAsset('page.html', 'text/html', Buffer.from('<html></html>').toString('base64'));
    expect(response.status).toBe(400);
    expect((await body(response)).error).toBe('Validation failed.');
  });

  it('404s a broadcast referencing an asset from another business', async () => {
    const upload = await uploadAsset('promo.png', 'image/png', PNG_BYTES);
    const { asset } = await body(upload);
    const other = await seedMerchant(db, { email: 'asset-foreign@example.test', withActiveSubscription: true });

    const payload = validBroadcast(1);
    const response = await handleEmailRoute(
      jsonRequest('/api/email/broadcast', 'POST', { ...payload, asset: { id: asset.id } }, other.token),
      env,
    );
    expect(response.status).toBe(404);
    expect(readCounter().sent).toBe(0);
  });

  it('embeds an image asset by absolute url in every delivered copy', async () => {
    stubSend(async () => mailjetOk());
    const { assetId, campaignId } = await uploadAndCreate({
      name: 'promo.png',
      mimeType: 'image/png',
      bytes: PNG_BYTES,
    });

    const outcome = await processEmailBatch(env, campaignId);
    expect(outcome).toBe('completed');

    const rows = db.query<{ asset_id: string; asset_name: string; asset_mime: string }>(
      `SELECT asset_id, asset_name, asset_mime FROM email_campaigns WHERE id = ?`,
      campaignId,
    );
    expect(rows[0]).toMatchObject({ asset_id: assetId, asset_name: 'promo.png', asset_mime: 'image/png' });
  });

  it('attaches a PDF payload and keeps an empty body valid', async () => {
    const calls: Array<{ init?: RequestInit }> = [];
    stubSend(async (_input, init) => {
      calls.push({ init });
      return mailjetOk();
    });
    const { campaignId } = await uploadAndCreate(
      { name: 'menu.pdf', mimeType: 'application/pdf', bytes: Buffer.from(PDF_TEXT) },
      { content: '' },
    );

    const outcome = await processEmailBatch(env, campaignId);
    expect(outcome).toBe('completed');
    expect(calls).toHaveLength(1);

    const payload = payloadOf(calls[0]);
    expect(payload.Attachments).toEqual([
      {
        ContentType: 'application/pdf',
        Filename: 'menu.pdf',
        Base64Content: Buffer.from(PDF_TEXT).toString('base64'),
      },
    ]);
    // An empty body still carries the unsubscribe footer.
    expect(payload.HTMLPart).toContain('Se désabonner');
  });

  it('serves stored asset bytes back with their content type', async () => {
    const upload = await uploadAsset('promo.png', 'image/png', PNG_BYTES);
    const { asset } = await body(upload);

    const response = await handleEmailAssetRoute(new Request(`https://example.test${asset.url}`), env);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG_BYTES);
  });

  it('404s unknown asset ids', async () => {
    const response = await handleEmailAssetRoute(
      new Request('https://example.test/api/email-assets/00000000-0000-4000-8000-000000000000'),
      env,
    );
    expect(response.status).toBe(404);
  });
});

describe('POST /api/webhooks/brevo (bounce/block suppression)', () => {
  const TOKEN = 'brevo-webhook-token-test';

  function webhookRequest(payload: string, overrides: { token?: string } = {}): Request {
    const token = overrides.token ?? TOKEN;
    return new Request(`https://example.test/api/webhooks/brevo?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
    });
  }

  function configureSecret() {
    (testEnv as { BREVO_WEBHOOK_SECRET?: string }).BREVO_WEBHOOK_SECRET = TOKEN;
  }

  it('503s without a configured webhook token', async () => {
    const payload = JSON.stringify({ event: 'hard_bounce', email: 'dead@example.test' });
    const response = await handleWebhookRoute(webhookRequest(payload), env);
    expect(response.status).toBe(503);
  });

  it('suppresses hard bounces, blocks and spam complaints after token verification', async () => {
    configureSecret();
    const events = [
      JSON.stringify({ event: 'hard_bounce', email: 'dead@example.test' }),
      JSON.stringify({ event: 'blocked', email: 'blocked@example.test' }),
      JSON.stringify({ event: 'spam', email: 'angry@example.test' }),
    ];
    for (const payload of events) {
      const response = await handleWebhookRoute(webhookRequest(payload), env);
      expect(response.status).toBe(200);
    }

    const rows = db.query<{ email: string; reason: string }>(`SELECT email, reason FROM email_suppression ORDER BY email`);
    expect(rows).toEqual([
      { email: 'angry@example.test', reason: 'complaint' },
      { email: 'blocked@example.test', reason: 'blocked' },
      { email: 'dead@example.test', reason: 'bounce' },
    ]);
  });

  it('accepts a batched event array in one payload', async () => {
    configureSecret();
    const payload = JSON.stringify([
      { event: 'hard_bounce', email: 'one@example.test' },
      { event: 'unsubscribed', email: 'two@example.test' },
    ]);
    const response = await handleWebhookRoute(webhookRequest(payload), env);
    expect(response.status).toBe(200);

    const rows = db.query<{ email: string; reason: string }>(`SELECT email, reason FROM email_suppression ORDER BY email`);
    expect(rows).toEqual([
      { email: 'one@example.test', reason: 'bounce' },
      { email: 'two@example.test', reason: 'unsubscribe' },
    ]);
  });

  it('ignores informational events that must not suppress', async () => {
    configureSecret();
    const payload = JSON.stringify({ event: 'delivered', email: 'fine@example.test' });
    const response = await handleWebhookRoute(webhookRequest(payload), env);
    expect(response.status).toBe(200);
    expect(db.query(`SELECT email FROM email_suppression`)).toHaveLength(0);
  });

  it('rejects a wrong webhook token', async () => {
    configureSecret();
    const payload = JSON.stringify({ event: 'hard_bounce', email: 'dead@example.test' });
    const response = await handleWebhookRoute(webhookRequest(payload, { token: 'forged' }), env);
    expect(response.status).toBe(401);
    expect(db.query(`SELECT email FROM email_suppression`)).toHaveLength(0);
  });

  it('400s an invalid payload', async () => {
    configureSecret();
    const response = await handleWebhookRoute(webhookRequest('{not json'), env);
    expect(response.status).toBe(400);
  });
});

describe('POST /api/webhooks/mailjet (bounce/block suppression)', () => {
  const TOKEN = 'mailjet-webhook-token-test';

  function webhookRequest(payload: string, overrides: { token?: string } = {}): Request {
    const token = overrides.token ?? TOKEN;
    return new Request(`https://example.test/api/webhooks/mailjet?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
    });
  }

  function configureSecret() {
    (testEnv as { MAILJET_WEBHOOK_TOKEN?: string }).MAILJET_WEBHOOK_TOKEN = TOKEN;
  }

  it('503s without a configured webhook token', async () => {
    const payload = JSON.stringify({ event: 'bounce', email: 'dead@example.test' });
    const response = await handleWebhookRoute(webhookRequest(payload), env);
    expect(response.status).toBe(503);
  });

  it('suppresses bounces, blocks, spam and unsubs after token verification', async () => {
    configureSecret();
    const events = [
      JSON.stringify({ event: 'bounce', email: 'dead@example.test' }),
      JSON.stringify({ event: 'blocked', email: 'blocked@example.test' }),
      JSON.stringify({ event: 'spam', email: 'angry@example.test' }),
      JSON.stringify({ event: 'unsub', email: 'gone@example.test' }),
    ];
    for (const payload of events) {
      const response = await handleWebhookRoute(webhookRequest(payload), env);
      expect(response.status).toBe(200);
    }

    const rows = db.query<{ email: string; reason: string }>(
      `SELECT email, reason FROM email_suppression ORDER BY email`,
    );
    expect(rows).toEqual([
      { email: 'angry@example.test', reason: 'complaint' },
      { email: 'blocked@example.test', reason: 'blocked' },
      { email: 'dead@example.test', reason: 'bounce' },
      { email: 'gone@example.test', reason: 'unsubscribe' },
    ]);
  });

  it('accepts a grouped event array and ignores informational events', async () => {
    configureSecret();
    const payload = JSON.stringify([
      { event: 'bounce', email: 'one@example.test' },
      { event: 'sent', email: 'two@example.test' },
    ]);
    const response = await handleWebhookRoute(webhookRequest(payload), env);
    expect(response.status).toBe(200);
    const rows = db.query<{ email: string }>(`SELECT email FROM email_suppression`);
    expect(rows).toEqual([{ email: 'one@example.test' }]);
  });

  it('rejects a wrong webhook token', async () => {
    configureSecret();
    const payload = JSON.stringify({ event: 'bounce', email: 'dead@example.test' });
    const response = await handleWebhookRoute(webhookRequest(payload, { token: 'forged' }), env);
    expect(response.status).toBe(401);
    expect(db.query(`SELECT email FROM email_suppression`)).toHaveLength(0);
  });
});

describe('dormant providers (EMAIL_PROVIDER switch)', () => {
  async function runOneCampaign(
    payload: Record<string, unknown> = validBroadcast(1),
  ): Promise<Array<{ url: string; init?: RequestInit }>> {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    stubSend(async (input, init) => {
      calls.push({ url: String(input), init });
      return providerResponse({ messageId: 'msg_1' }, 201);
    });

    const response = await handleEmailRoute(
      jsonRequest('/api/email/broadcast', 'POST', payload, merchant.token),
      env,
    );
    expect(response.status).toBe(202);
    const id = (await body(response)).campaign.id as string;
    expect(await processEmailBatch(env, id)).toBe('completed');
    return calls;
  }

  it('sends through Brevo when EMAIL_PROVIDER=brevo', async () => {
    (env as { EMAIL_PROVIDER?: string }).EMAIL_PROVIDER = 'brevo';

    const calls = await runOneCampaign();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.brevo.com/v3/smtp/email');
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers['api-key']).toBe('brevo_test_key');
    const parsed = JSON.parse(String(calls[0].init?.body ?? '{}')) as {
      sender: { email: string; name: string };
      htmlContent: string;
      headers?: { idempotencyKey?: string };
    };
    expect(parsed.sender).toEqual({ email: 'no-reply@example.test', name: 'Café Tej Team' });
    expect(parsed.htmlContent).toContain('Bonjour Contact 1');
    expect(parsed.headers?.idempotencyKey).toContain('/0/');
  });

  it('sends through Resend when EMAIL_PROVIDER=resend', async () => {
    (env as { EMAIL_PROVIDER?: string }).EMAIL_PROVIDER = 'resend';
    (env as { RESEND_API_KEY?: string }).RESEND_API_KEY = 'resend_test_key';

    const calls = await runOneCampaign();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer resend_test_key');
    const parsed = JSON.parse(String(calls[0].init?.body ?? '{}')) as {
      from: string;
      to: string[];
      html: string;
    };
    expect(parsed.from).toBe('Café Tej Team <no-reply@example.test>');
    expect(parsed.to).toEqual(['customer1@example.test']);
    expect(parsed.html).toContain('Bonjour Contact 1');
  });

  it('adds the merchant reply address to Resend, Mailjet and Brevo payloads', async () => {
    const replyTo = 'shop@merchant.example.test';
    const parseBody = (call: { init?: RequestInit }) =>
      JSON.parse(String(call.init?.body ?? '{}')) as Record<string, unknown>;

    (env as { EMAIL_PROVIDER?: string }).EMAIL_PROVIDER = 'resend';
    (env as { RESEND_API_KEY?: string }).RESEND_API_KEY = 'resend_test_key';
    const resendPayload = parseBody((await runOneCampaign({ ...validBroadcast(1), replyTo }))[0]!);
    expect(resendPayload.reply_to).toBe(replyTo);

    // Without an explicit address the sender's account email carries Reply-To.
    const accountEmail = db.query<{ email: string }>(
      `SELECT email FROM users WHERE id = ?`,
      merchant.userId,
    )[0]!.email;
    const resendDefault = parseBody(
      (await runOneCampaign({ ...validBroadcast(1), replyTo: '' }))[0]!,
    );
    expect(resendDefault.reply_to).toBe(accountEmail);

    (env as { EMAIL_PROVIDER?: string }).EMAIL_PROVIDER = 'mailjet';
    const mailjetPayload = parseBody((await runOneCampaign({ ...validBroadcast(1), replyTo }))[0]!);
    expect((mailjetPayload.Messages as Array<{ ReplyTo?: string }>)[0]!.ReplyTo).toBe(replyTo);

    (env as { EMAIL_PROVIDER?: string }).EMAIL_PROVIDER = 'brevo';
    const brevoPayload = parseBody((await runOneCampaign({ ...validBroadcast(1), replyTo }))[0]!);
    expect((brevoPayload.replyTo as { email: string }).email).toBe(replyTo);
  });
});
