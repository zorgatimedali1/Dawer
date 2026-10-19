import { createHmac, timingSafeEqual } from 'node:crypto';
import { errorResponse, jsonResponse } from '../lib/http';
import { addSuppression } from '../lib/email';
import type { Env } from '../types';

const BASE_PATH = '/api/webhooks/whatsapp';
const BREVO_PATH = '/api/webhooks/brevo';
const MAILJET_PATH = '/api/webhooks/mailjet';

type WebhookPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        statuses?: unknown[];
        messages?: unknown[];
      };
    }>;
  }>;
};

function plainResponse(text: string, status: number): Response {
  return new Response(text, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

function safeEqual(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

// Meta's handshake: GET /api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
// The challenge must come back verbatim as plain text or "Vérifier et enregistrer" fails.
function handleVerify(url: URL, env: Env): Response {
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge') ?? '';

  if (mode !== 'subscribe') return plainResponse('hub.mode must be "subscribe".', 403);

  const expected = env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (!expected) return plainResponse('Webhook verification is not configured.', 503);
  if (!token || !safeEqual(token, expected)) return plainResponse('Verify token mismatch.', 403);
  if (!challenge) return plainResponse('Missing hub.challenge.', 400);

  return plainResponse(challenge, 200);
}

function countEvents(payload: WebhookPayload): { statuses: number; messages: number } {
  let statuses = 0;
  let messages = 0;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      statuses += change.value?.statuses?.length ?? 0;
      messages += change.value?.messages?.length ?? 0;
    }
  }

  return { statuses, messages };
}

/** sent < delivered < read, failed is terminal — out-of-order events cannot downgrade. */
const STATUS_RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };

/** D1 caps bound parameters per query — stay comfortably under it on IN lists. */
const IN_CHUNK_SIZE = 80;
/** Statements per batch round trip: large enough to matter, bounded per commit. */
const WRITE_CHUNK_SIZE = 100;

type StatusEvent = {
  id?: string;
  status?: string;
  errors?: Array<{ code?: number; message?: string }>;
};

type NormalizedStatus = { wamid: string; status: string; rank: number };

function chunk<T>(items: T[], size: number): T[][] {
  const parts: T[][] = [];
  for (let index = 0; index < items.length; index += size) parts.push(items.slice(index, index + size));
  return parts;
}

/**
 * Flattens every statuses array into one event per wamid: unranked statuses
 * are dropped and a repeated wamid keeps only its highest rank, so a stale
 * `sent` arriving after `read` in the same payload cannot win.
 */
function flattenStatuses(payload: WebhookPayload): NormalizedStatus[] {
  const byWamid = new Map<string, NormalizedStatus>();

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const raw of change.value?.statuses ?? []) {
        const event = raw as StatusEvent;
        const wamid = event.id;
        const normalized = typeof event.status === 'string' ? event.status.toLowerCase() : '';
        const rank = STATUS_RANK[normalized];
        if (!wamid || !rank) continue;
        const existing = byWamid.get(wamid);
        if (!existing || rank > existing.rank) byWamid.set(wamid, { wamid, status: normalized, rank });
      }
    }
  }

  return [...byWamid.values()];
}

/**
 * Persists Meta's delivery feedback against the message log written at send
 * time and returns the campaigns whose rollup columns must be refreshed.
 *
 * The whole payload costs one chunked lookup SELECT plus one batched write
 * round trip instead of one round trip per event — a 200-recipient campaign
 * would otherwise pay 400 sequential round trips for a single webhook.
 */
async function recordWebhookStatuses(env: Env, payload: WebhookPayload): Promise<Set<string>> {
  const campaignIds = new Set<string>();
  const now = new Date().toISOString();
  const events = flattenStatuses(payload);
  if (events.length === 0) return campaignIds;

  const known = new Map<string, { id: string; status: string; campaign_id: string | null }>();
  for (const ids of chunk(events.map((event) => event.wamid), IN_CHUNK_SIZE)) {
    const placeholders = ids.map(() => '?').join(', ');
    const rows = await env.DB.prepare(
      `SELECT id, wamid, status, campaign_id FROM whatsapp_message_log WHERE wamid IN (${placeholders})`,
    )
      .bind(...ids)
      .all<{ id: string; wamid: string; status: string; campaign_id: string | null }>();
    for (const row of rows.results ?? []) known.set(row.wamid, row);
  }

  const writes: D1PreparedStatement[] = [];
  for (const event of events) {
    const row = known.get(event.wamid);

    if (!row) {
      // Status for a message we never logged (pre-log campaign): keep the
      // event anyway so audits and future rollups still see it.
      writes.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO whatsapp_message_log (id, wamid, campaign_id, status, created_at, updated_at)
           VALUES (?, ?, NULL, ?, ?, ?)`,
        ).bind(crypto.randomUUID(), event.wamid, event.status, now, now),
      );
      continue;
    }

    if ((STATUS_RANK[row.status] ?? 0) >= event.rank) continue;

    writes.push(
      env.DB.prepare(
        `UPDATE whatsapp_message_log
         SET status = ?, updated_at = ?
         WHERE id = ?
           AND (CASE status WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3
                            WHEN 'failed' THEN 4 ELSE 0 END) < ?`,
      ).bind(event.status, now, row.id, event.rank),
    );
    if (row.campaign_id) campaignIds.add(row.campaign_id);
  }

  for (const part of chunk(writes, WRITE_CHUNK_SIZE)) await env.DB.batch(part);

  return campaignIds;
}

/**
 * Recomputes delivered/read counters for the campaigns touched above.
 *
 * COUNT recompute instead of increments: it is idempotent by construction, so
 * a Meta retry or two concurrent webhooks converging can never double-count a
 * delivery. The per-campaign round trips are what gets batched.
 */
async function rollupDeliveryCounts(env: Env, campaignIds: Set<string>): Promise<void> {
  const now = new Date().toISOString();
  const statements = [...campaignIds].map((campaignId) =>
    env.DB.prepare(
      `UPDATE whatsapp_campaigns
       SET delivered_count = (SELECT COUNT(*) FROM whatsapp_message_log
                               WHERE campaign_id = ? AND status IN ('delivered', 'read')),
           read_count = (SELECT COUNT(*) FROM whatsapp_message_log
                         WHERE campaign_id = ? AND status = 'read'),
           updated_at = ?
       WHERE id = ?`,
    ).bind(campaignId, campaignId, now, campaignId),
  );

  for (const part of chunk(statements, WRITE_CHUNK_SIZE)) await env.DB.batch(part);
}

async function handleEvents(request: Request, env: Env): Promise<Response> {
  const raw = await request.text();

  // Fail closed: without the app secret every payload could be forged, and a
  // forged status event would corrupt delivery counters.
  if (!env.META_APP_SECRET) {
    return errorResponse('Webhook signature verification is not configured.', 503);
  }

  const signature = request.headers.get('x-hub-signature-256') ?? '';
  const expected = `sha256=${createHmac('sha256', env.META_APP_SECRET).update(raw).digest('hex')}`;
  if (!signature.startsWith('sha256=') || !safeEqual(signature, expected)) {
    return errorResponse('Invalid webhook signature.', 401);
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(raw || '{}') as WebhookPayload;
  } catch {
    return errorResponse('Invalid webhook payload.', 400);
  }

  const counts = countEvents(payload);
  if (counts.statuses > 0 || counts.messages > 0) {
    console.log('WhatsApp webhook events received.', JSON.stringify(counts));
  }

  if (counts.statuses > 0) {
    const campaignIds = await recordWebhookStatuses(env, payload);
    if (campaignIds.size > 0) await rollupDeliveryCounts(env, campaignIds);
  }

  return jsonResponse({ success: true });
}

export async function handleWebhookRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === BREVO_PATH) {
    if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
    return handleBrevoEvent(request, env);
  }

  if (url.pathname === MAILJET_PATH) {
    if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
    return handleMailjetEvent(request, env);
  }

  if (url.pathname === BASE_PATH && request.method === 'GET') {
    return handleVerify(url, env);
  }

  if (url.pathname === BASE_PATH && request.method === 'POST') {
    return handleEvents(request, env);
  }

  return errorResponse('Route not found.', 404);
}

/** Events whose recipients must never be emailed again. */
const BREVO_SUPPRESS_EVENTS: Record<string, string> = {
  hard_bounce: 'bounce',
  bounce: 'bounce',
  bounced: 'bounce',
  invalid_email: 'invalid_email',
  spam: 'complaint',
  complained: 'complaint',
  blocked: 'blocked',
  unsubscribe: 'unsubscribe',
  unsubscribed: 'unsubscribe',
};

/** Mailjet's event names (per event-type callback) → suppression reasons. */
const MAILJET_SUPPRESS_EVENTS: Record<string, string> = {
  bounce: 'bounce',
  blocked: 'blocked',
  spam: 'complaint',
  unsub: 'unsubscribe',
};

/**
 * Delivery feedback (bounces/blocks/spam/unsubscribes) → suppression list,
 * so a dead address is dropped before the next campaign. Auth is a shared
 * token read from the `x-webhook-token` header — Brevo ingests this way
 * (its create/webhook API accepts arbitrary custom headers), so Brevo calls
 * are header-only: a token inside a registered URL lives on in provider
 * request logs. Mailjet offers no header configuration on event callback
 * URLs, so the `?token=` query fallback is accepted only for that provider.
 * Compared in constant time. Neither provider signs payloads. Payloads
 * arrive either as one event object or an array of them. Dedupe is inherent:
 * the suppression PK makes replays idempotent.
 */
async function handleEmailEventWebhook(
  request: Request,
  env: Env,
  options: {
    secret: string | undefined;
    suppressEvents: Record<string, string>;
    logLabel: string;
    allowQueryToken: boolean;
  },
): Promise<Response> {
  const url = new URL(request.url);
  const queryToken = options.allowQueryToken ? url.searchParams.get('token') : null;
  const token = request.headers.get('x-webhook-token') ?? queryToken ?? '';

  // Fail closed: without the shared token anyone could suppress addresses.
  if (!options.secret) {
    return errorResponse('Webhook signature verification is not configured.', 503);
  }
  if (!token || !safeEqual(token, options.secret)) {
    return errorResponse('Invalid webhook token.', 401);
  }

  const raw = await request.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || '[]');
  } catch {
    return errorResponse('Invalid webhook payload.', 400);
  }
  const events = Array.isArray(parsed) ? parsed : [parsed];

  let suppressed = 0;
  for (const entry of events) {
    if (!entry || typeof entry !== 'object') continue;
    const event = entry as { event?: unknown; email?: unknown };
    const type = typeof event.event === 'string' ? event.event.toLowerCase() : '';
    const email = typeof event.email === 'string' ? event.email : '';
    const reason = options.suppressEvents[type];
    if (reason && email.includes('@')) {
      if (await addSuppression(env, email, reason)) suppressed += 1;
    }
  }
  if (suppressed > 0) console.log(`${options.logLabel} webhook suppressed recipients.`, suppressed);

  return jsonResponse({ received: true });
}

async function handleBrevoEvent(request: Request, env: Env): Promise<Response> {
  return handleEmailEventWebhook(request, env, {
    secret: env.BREVO_WEBHOOK_SECRET,
    suppressEvents: BREVO_SUPPRESS_EVENTS,
    logLabel: 'Brevo',
    // Brevo accepts custom headers on registered webhook URLs (create/update
    // webhook API) — register the callback with the token in the header, so
    // no secret ever appears in a logged URL. If the current Brevo callback
    // still sends `?token=`, the webhook must be re-registered with the
    // `x-webhook-token` header configuration.
    allowQueryToken: false,
  });
}

async function handleMailjetEvent(request: Request, env: Env): Promise<Response> {
  return handleEmailEventWebhook(request, env, {
    secret: env.MAILJET_WEBHOOK_TOKEN,
    suppressEvents: MAILJET_SUPPRESS_EVENTS,
    logLabel: 'Mailjet',
    // Mailjet event callback URLs carry no custom headers, so the registered
    // `?token=` query is the only way to authenticate its callbacks.
    allowQueryToken: true,
  });
}
