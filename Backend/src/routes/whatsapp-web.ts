import { z } from 'zod';
import { errorResponse, jsonResponse } from '../lib/http';
import { timingSafeEqualString } from '../lib/crypto';
import { getAuthenticatedUser, getPrimaryBusinessId, writeAuditLog } from '../lib/tenant';
import { getBusinessAccess } from '../lib/subscription-access';
import { getWhatsAppBroadcastLimits } from '../lib/subscription-limits';
import { getEffectiveFeatures } from '../lib/feature-access';
import { whatsappWebBroadcastSchema } from '../lib/validation';
import { normalizePhone } from '../lib/whatsapp';
import type { AuthenticatedUser } from '../lib/tenant';
import type { Env } from '../types';

const BASE_PATH = '/api/whatsapp-web';
const INTERNAL_PATH = `${BASE_PATH}/internal/progress`;
const BROADCAST_PATH = `${BASE_PATH}/broadcast`;
const CAMPAIGN_ITEM_PATTERN = /^\/api\/whatsapp-web\/campaigns\/([^/]+)(?:\/(cancel|resume))?$/;
const GATEWAY_TIMEOUT_MS = 8_000;
const STATE_TIMEOUT_MS = 4_000;

/** Must stay byte-identical to DEFAULT_TEMPLATE in whatsapp-saas-backend/server.js. */
const DEFAULT_WEB_MESSAGE =
  '🎁 *{greet} {name}!*\n\nThanks for spinning our wheel. You won a *{prize}*! Show this message to claim your reward on your next visit. 🥂';

const progressCallbackSchema = z.object({
  campaignId: z.string().min(1).max(64),
  event: z.enum(['progress', 'complete', 'failed']),
  phone: z.string().max(64).optional(),
  ok: z.boolean().optional(),
  error: z.string().max(500).optional(),
});

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/** 403 copy; identical wording to the Cloud API route (same product contract). */
function limitMessage(limit: number): string {
  if (limit === 200) return 'PRO plan limit reached. Upgrade to Business for 1000 messages';
  if (limit >= 1000) return `BUSINESS plan limit reached (${limit} messages per month).`;
  return `Plan limit reached (${limit} messages per month).`;
}

function batchLimitMessage(batch: number): string {
  if (batch === 100) return 'PRO plan allows 100 recipients per broadcast.';
  if (batch === 250) return 'BUSINESS plan allows 250 recipients per broadcast.';
  return `Plan allows ${batch} recipients per broadcast.`;
}

async function readUsage(env: Env, businessId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT whatsapp_messages_sent_this_month AS sent, whatsapp_usage_month AS month
     FROM subscriptions WHERE business_id = ? ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(businessId)
    .first<{ sent: number; month: string | null }>();

  if (!row) return 0;
  return row.month === currentMonth() ? Number(row.sent ?? 0) : 0;
}

function gatewayConfig(env: Env): { url: string; secret: string } | null {
  if (!env.GATEWAY_URL || !env.GATEWAY_SECRET) return null;
  return { url: env.GATEWAY_URL.replace(/\/+$/, ''), secret: env.GATEWAY_SECRET };
}

const WEB_GATEWAY_DISABLED_MESSAGE = 'WhatsApp Web is not enabled for this workspace.';

/** Optional pilot switch: CSV of business ids; empty/absent = every workspace. */
function webGatewayAllowed(env: Env, businessId: string): boolean {
  const raw = (env.WHATSAPP_WEB_ALLOWLIST ?? '').trim();
  if (!raw) return true;
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .includes(businessId);
}

function hexlify(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Per-tenant gateway credentials. GATEWAY_SECRET only acts as an HMAC key here
 * — the raw secret never leaves the server, and every business gets its own pair:
 *  - queue token (`wgt:`) authorizes status/dispatch; server-to-server only.
 *  - pair token (`wgt-pair:`) only opens that tenant's QR page in a browser,
 *    so a link leaked to a browser can never post to the broadcast pool.
 */
async function gatewayTokens(env: Env, businessId: string): Promise<{ queue: string; pair: string } | null> {
  const gateway = gatewayConfig(env);
  if (!gateway) return null;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(gateway.secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sign = async (purpose: string) =>
    hexlify(await crypto.subtle.sign('HMAC', key, encoder.encode(`${purpose}:${businessId}`)));
  return {
    queue: `${businessId}.${await sign('wgt')}`,
    pair: `${businessId}.${await sign('wgt-pair')}`,
  };
}

export type GatewaySnapshot = {
  configured: boolean;
  reachable: boolean;
  state: string | null;
  qr: string | null;
  pairUrl: string | null;
};

async function readGateway(env: Env, businessId: string): Promise<GatewaySnapshot> {
  const gateway = gatewayConfig(env);
  if (!gateway || !webGatewayAllowed(env, businessId)) {
    return { configured: false, reachable: false, state: null, qr: null, pairUrl: null };
  }
  const tokens = await gatewayTokens(env, businessId);
  if (!tokens) return { configured: false, reachable: false, state: null, qr: null, pairUrl: null };
  const pairUrl = `${gateway.url}/pair?key=${encodeURIComponent(tokens.pair)}`;
  try {
    const response = await fetch(`${gateway.url}/api/status`, {
      headers: { authorization: `Bearer ${tokens.queue}` },
      signal: AbortSignal.timeout(STATE_TIMEOUT_MS),
    });
    if (!response.ok) return { configured: true, reachable: false, state: null, qr: null, pairUrl };
    const body = (await response.json()) as { state?: unknown; qr?: unknown };
    return {
      configured: true,
      reachable: true,
      state: typeof body.state === 'string' ? body.state : null,
      qr: typeof body.qr === 'string' ? body.qr : null,
      pairUrl,
    };
  } catch {
    return { configured: true, reachable: false, state: null, qr: null, pairUrl };
  }
}

/**
 * Refuse to queue work the gateway will drop after its ready timeout:
 * PAIRING = never paired, AUTH_FAILED = needs a re-pair.
 * DISCONNECTED is allowed — the gateway auto-reconnects within that timeout.
 */
function sessionNotReady(gateway: GatewaySnapshot): boolean {
  return (
    gateway.configured &&
    gateway.reachable &&
    gateway.state !== null &&
    gateway.state !== 'READY' &&
    gateway.state !== 'DISCONNECTED'
  );
}

/** Hands the payload to the Node gateway; returns an error message or null on success. */
async function dispatchToGateway(
  env: Env,
  businessId: string,
  campaignId: string,
  recipients: Array<{ name?: string; phone: string; prize?: string }>,
  message: string,
): Promise<string | null> {
  const gateway = gatewayConfig(env);
  if (!gateway) return 'WhatsApp Web gateway is not configured.';
  if (!webGatewayAllowed(env, businessId)) return WEB_GATEWAY_DISABLED_MESSAGE;
  const tokens = await gatewayTokens(env, businessId);
  if (!tokens) return 'WhatsApp Web gateway is not configured.';
  try {
    const response = await fetch(`${gateway.url}/api/broadcast-pool`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens.queue}` },
      body: JSON.stringify({ campaignId, recipients, message }),
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
    });
    if (!response.ok) return `Gateway rejected the queue (HTTP ${response.status}).`;
    return null;
  } catch {
    return 'Web gateway is offline.';
  }
}

/** Best-effort cancel signal; a dead gateway still gets the campaign settled locally. */
async function notifyGatewayCancel(env: Env, businessId: string, campaignId: string): Promise<void> {
  const gateway = gatewayConfig(env);
  if (!gateway || !webGatewayAllowed(env, businessId)) return;
  const tokens = await gatewayTokens(env, businessId);
  if (!tokens) return;
  try {
    await fetch(`${gateway.url}/api/broadcast-pool/${encodeURIComponent(campaignId)}/cancel`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tokens.queue}` },
      signal: AbortSignal.timeout(4_000),
    });
  } catch {
    // The Worker-side status flip is authoritative; the gateway loop checks it too.
  }
}

async function refundUnsent(env: Env, businessId: string, refund: number): Promise<void> {
  if (refund <= 0) return;
  await env.DB.prepare(
    `UPDATE subscriptions
     SET whatsapp_messages_sent_this_month = max(0, whatsapp_messages_sent_this_month - ?)
     WHERE business_id = ? AND whatsapp_usage_month = ?`,
  )
    .bind(refund, businessId, currentMonth())
    .run();
}

/**
 * Settles a web campaign whose gateway job vanished (gateway restarted before
 * it finished, its callback never landed). Mirrors the Cloud reconciler: a
 * guarded FAILED transition makes the unsent refund fire at most once even if
 * a slow gateway callback is still in flight.
 */
export async function settleInterruptedWebCampaign(env: Env, campaignId: string, reason: string): Promise<void> {
  const row = await env.DB.prepare(
    `SELECT ${CAMPAIGN_COLUMNS} FROM whatsapp_web_campaigns WHERE id = ? LIMIT 1`,
  )
    .bind(campaignId)
    .first<CampaignRow>();

  if (!row) return;
  if (row.status !== 'QUEUED' && row.status !== 'PROCESSING') return;

  const unsent = Math.max(0, row.total_recipients - row.sent_count - row.failed_count);
  const result = await env.DB.prepare(
    `UPDATE whatsapp_web_campaigns SET status = 'FAILED', last_error = ?, updated_at = ?
     WHERE id = ? AND status IN ('QUEUED', 'PROCESSING')`,
  )
    .bind(reason, new Date().toISOString(), campaignId)
    .run();

  if (Number(result.meta.changes ?? 0) > 0) {
    await refundUnsent(env, row.business_id, unsent);
  }
}

type CampaignRow = {
  id: string;
  business_id: string;
  message: string;
  recipients: string;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  status: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

const CAMPAIGN_COLUMNS = `id, business_id, message, recipients, total_recipients, sent_count, failed_count,
        status, last_error, created_at, updated_at`;

function presentCampaign(row: CampaignRow) {
  return {
    id: row.id,
    totalRecipients: row.total_recipients,
    sent: row.sent_count,
    failed: row.failed_count,
    status: row.status,
    message: row.message,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function handleStatus(env: Env, businessId: string, enabled: boolean): Promise<Response> {
  const [access, limits, sent, gateway] = await Promise.all([
    getBusinessAccess(env, businessId),
    getWhatsAppBroadcastLimits(env, businessId),
    readUsage(env, businessId),
    readGateway(env, businessId),
  ]);

  return jsonResponse({
    success: true,
    status: {
      allowed: enabled && access.canManage && limits.monthly > 0,
      enabled,
      planSlug: access.plan.slug,
      planName: access.plan.name,
      monthlyLimit: limits.monthly,
      batchLimit: limits.batch,
      sentThisMonth: sent,
      remaining: Math.max(0, limits.monthly - sent),
      gateway,
    },
  });
}

async function handleWinners(env: Env, businessId: string): Promise<Response> {
  const [candidates, log] = await Promise.all([
    env.DB.prepare(
      `SELECT c.id, cu.first_name, cu.last_name, cu.phone, r.name AS reward_name,
              ca.name AS campaign_name, c.issued_at
       FROM coupons c
       JOIN customers cu ON cu.id = c.customer_id
       LEFT JOIN rewards r ON r.id = c.reward_id
       JOIN campaigns ca ON ca.id = c.campaign_id
       WHERE c.business_id = ? AND c.status = 'ISSUED'
         AND cu.phone IS NOT NULL AND TRIM(cu.phone) <> ''
       ORDER BY c.issued_at DESC LIMIT 500`,
    )
      .bind(businessId)
      .all<{
        id: string;
        first_name: string | null;
        last_name: string | null;
        phone: string;
        reward_name: string | null;
        campaign_name: string;
        issued_at: string;
      }>(),
    env.DB.prepare(
      `SELECT DISTINCT phone_normalized FROM whatsapp_web_message_log
       WHERE business_id = ? AND phone_normalized IS NOT NULL`,
    )
      .bind(businessId)
      .all<{ phone_normalized: string }>(),
  ]);

  const alreadySent = new Set((log.results ?? []).map((row) => row.phone_normalized));
  const seen = new Set<string>();
  const winners: Array<{
    id: string;
    name: string | null;
    phone: string;
    prize: string | null;
    campaign: string;
    wonAt: string;
  }> = [];

  for (const row of candidates.results ?? []) {
    const normalized = normalizePhone(row.phone);
    if (!normalized || alreadySent.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    winners.push({
      id: row.id,
      name: [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || null,
      phone: row.phone,
      prize: row.reward_name,
      campaign: row.campaign_name,
      wonAt: row.issued_at,
    });
    if (winners.length >= 200) break;
  }

  return jsonResponse({ success: true, winners });
}

async function handleBroadcastCreate(
  request: Request,
  env: Env,
  user: AuthenticatedUser,
  businessId: string,
): Promise<Response> {
  const input = whatsappWebBroadcastSchema.parse(await request.json());

  if (!gatewayConfig(env)) return errorResponse('WhatsApp Web gateway is not configured.', 503);
  if (!webGatewayAllowed(env, businessId)) return errorResponse(WEB_GATEWAY_DISABLED_MESSAGE, 403);

  const limits = await getWhatsAppBroadcastLimits(env, businessId);
  if (limits.monthly <= 0) {
    return errorResponse('WhatsApp Broadcasts require a Pro or Business plan. Upgrade to unlock bulk messaging.', 403);
  }

  const recipients: Array<{ name?: string; phone: string; prize?: string }> = [];
  const seen = new Set<string>();
  for (const [index, recipient] of input.recipients.entries()) {
    const phone = normalizePhone(recipient.phone);
    if (!phone) {
      return errorResponse(`Invalid phone number for recipient #${index + 1}: "${recipient.phone}".`, 400);
    }
    if (seen.has(phone)) continue;
    seen.add(phone);
    recipients.push({
      ...(recipient.name ? { name: recipient.name } : {}),
      ...(recipient.prize ? { prize: recipient.prize } : {}),
      phone,
    });
  }

  if (recipients.length > limits.batch) return errorResponse(batchLimitMessage(limits.batch), 403);
  if (recipients.length > limits.monthly) return errorResponse(limitMessage(limits.monthly), 403);

  const active = await env.DB.prepare(
    `SELECT id FROM whatsapp_web_campaigns WHERE business_id = ? AND status IN ('QUEUED', 'PROCESSING') LIMIT 1`,
  )
    .bind(businessId)
    .first<{ id: string }>();

  if (active) return errorResponse('A Web broadcast is already in progress. Wait for it to finish.', 409);

  // Fail fast instead of queueing a job the gateway will drop after its
  // 10-minute ready timeout (PAIRING = never paired, AUTH_FAILED = needs re-pair).
  // DISCONNECTED is allowed — the gateway auto-reconnects within that timeout.
  const gateway = await readGateway(env, businessId);
  if (sessionNotReady(gateway)) {
    return errorResponse('WhatsApp session is not ready. Scan the pairing QR in the gateway first.', 503);
  }

  const month = currentMonth();
  const count = recipients.length;
  const reservation = await env.DB.prepare(
    `UPDATE subscriptions
     SET whatsapp_usage_month = ?,
         whatsapp_messages_sent_this_month = CASE
           WHEN whatsapp_usage_month = ? THEN whatsapp_messages_sent_this_month + ?
           ELSE ? END
     WHERE business_id = ?
       AND (whatsapp_usage_month IS NULL OR whatsapp_usage_month <> ?
            OR whatsapp_messages_sent_this_month + ? <= ?)`,
  )
    .bind(month, month, count, count, businessId, month, count, limits.monthly)
    .run();

  if (Number(reservation.meta.changes ?? 0) === 0) return errorResponse(limitMessage(limits.monthly), 403);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const message = input.message ?? DEFAULT_WEB_MESSAGE;

  const inserted = await env.DB.prepare(
    `INSERT INTO whatsapp_web_campaigns
       (id, business_id, user_id, message, recipients, total_recipients, sent_count, failed_count,
        status, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, 'QUEUED', NULL, ?, ?)
     ON CONFLICT(business_id) WHERE status IN ('QUEUED', 'PROCESSING') DO NOTHING`,
  )
    .bind(id, businessId, user.id, message, JSON.stringify(recipients), recipients.length, now, now)
    .run();

  if (Number(inserted.meta.changes ?? 0) === 0) {
    await refundUnsent(env, businessId, count);
    return errorResponse('A Web broadcast is already in progress. Wait for it to finish.', 409);
  }

  const dispatchError = await dispatchToGateway(env, businessId, id, recipients, message);
  if (dispatchError) {
    await env.DB.prepare(
      `UPDATE whatsapp_web_campaigns SET status = 'FAILED', last_error = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(dispatchError, new Date().toISOString(), id)
      .run();
    await refundUnsent(env, businessId, count);
    return errorResponse(dispatchError, 503);
  }

  // Flip QUEUED -> PROCESSING only if no gateway callback settled it first.
  await env.DB.prepare(
    `UPDATE whatsapp_web_campaigns SET status = 'PROCESSING', updated_at = ?
     WHERE id = ? AND status = 'QUEUED'`,
  )
    .bind(new Date().toISOString(), id)
    .run();

  await writeAuditLog(env, {
    businessId,
    userId: user.id,
    action: 'whatsapp_web.broadcast.started',
    entityType: 'whatsapp_web_campaign',
    entityId: id,
    metadata: { recipients: recipients.length, message },
  });

  return jsonResponse(
    {
      success: true,
      campaign: {
        id,
        totalRecipients: recipients.length,
        sent: 0,
        failed: 0,
        status: 'PROCESSING',
        message,
        createdAt: now,
      },
    },
    202,
  );
}

async function handleList(env: Env, businessId: string): Promise<Response> {
  const result = await env.DB.prepare(
    `SELECT ${CAMPAIGN_COLUMNS} FROM whatsapp_web_campaigns WHERE business_id = ?
     ORDER BY created_at DESC LIMIT 20`,
  )
    .bind(businessId)
    .all<CampaignRow>();

  return jsonResponse({ success: true, campaigns: (result.results ?? []).map(presentCampaign) });
}

async function handleGet(env: Env, businessId: string, campaignId: string): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT ${CAMPAIGN_COLUMNS} FROM whatsapp_web_campaigns WHERE id = ? AND business_id = ? LIMIT 1`,
  )
    .bind(campaignId, businessId)
    .first<CampaignRow>();

  if (!row) return errorResponse('Broadcast not found.', 404);
  return jsonResponse({ success: true, campaign: presentCampaign(row) });
}

async function handleCancel(env: Env, businessId: string, campaignId: string): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT ${CAMPAIGN_COLUMNS} FROM whatsapp_web_campaigns WHERE id = ? AND business_id = ? LIMIT 1`,
  )
    .bind(campaignId, businessId)
    .first<CampaignRow>();

  if (!row) return errorResponse('Broadcast not found.', 404);
  if (row.status !== 'QUEUED' && row.status !== 'PROCESSING') {
    return errorResponse('This broadcast is not active.', 409);
  }

  await notifyGatewayCancel(env, businessId, campaignId);

  const unsent = Math.max(0, row.total_recipients - row.sent_count - row.failed_count);
  await refundUnsent(env, businessId, unsent);

  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE whatsapp_web_campaigns SET status = 'CANCELLED', updated_at = ? WHERE id = ? AND status IN ('QUEUED', 'PROCESSING')`,
  )
    .bind(now, campaignId)
    .run();

  const updated = await env.DB.prepare(
    `SELECT ${CAMPAIGN_COLUMNS} FROM whatsapp_web_campaigns WHERE id = ? LIMIT 1`,
  )
    .bind(campaignId)
    .first<CampaignRow>();

  return jsonResponse({ success: true, campaign: updated ? presentCampaign(updated) : null });
}

async function handleResume(env: Env, user: AuthenticatedUser, businessId: string, campaignId: string): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT ${CAMPAIGN_COLUMNS} FROM whatsapp_web_campaigns WHERE id = ? AND business_id = ? LIMIT 1`,
  )
    .bind(campaignId, businessId)
    .first<CampaignRow>();

  if (!row) return errorResponse('Broadcast not found.', 404);
  if (row.status !== 'FAILED' && row.status !== 'CANCELLED') {
    return errorResponse('Only failed or cancelled broadcasts can be resumed.', 409);
  }
  if (!webGatewayAllowed(env, businessId)) return errorResponse(WEB_GATEWAY_DISABLED_MESSAGE, 403);

  const active = await env.DB.prepare(
    `SELECT id FROM whatsapp_web_campaigns
     WHERE business_id = ? AND status IN ('QUEUED', 'PROCESSING') AND id <> ? LIMIT 1`,
  )
    .bind(businessId, campaignId)
    .first<{ id: string }>();
  if (active) return errorResponse('A Web broadcast is already in progress. Wait for it to finish.', 409);

  let stored: Array<{ name?: string; phone: string; prize?: string }> = [];
  try {
    const parsed: unknown = JSON.parse(row.recipients);
    if (Array.isArray(parsed)) stored = parsed as typeof stored;
  } catch {
    return errorResponse('Campaign recipients are unreadable.', 500);
  }

  const sentLog = await env.DB.prepare(
    `SELECT DISTINCT phone_normalized FROM whatsapp_web_message_log
     WHERE campaign_id = ? AND phone_normalized IS NOT NULL AND status = 'sent'`,
  )
    .bind(campaignId)
    .all<{ phone_normalized: string }>();

  const delivered = new Set((sentLog.results ?? []).map((entry) => entry.phone_normalized));
  const remaining: typeof stored = [];
  const seen = new Set<string>();
  for (const recipient of stored) {
    const normalized = normalizePhone(recipient.phone);
    if (!normalized || delivered.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    remaining.push(recipient);
  }

  if (remaining.length === 0) return errorResponse('No unsent recipients left in this broadcast.', 409);

  // Same fail-fast as create: dispatching while the gateway is still pairing
  // would park the campaign in PROCESSING for the gateway's 10-minute timeout.
  const gateway = await readGateway(env, businessId);
  if (sessionNotReady(gateway)) {
    return errorResponse('WhatsApp session is not ready. Scan the pairing QR in the gateway first.', 503);
  }

  const dispatchError = await dispatchToGateway(env, businessId, campaignId, remaining, row.message);
  if (dispatchError) return errorResponse(dispatchError, 503);

  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE whatsapp_web_campaigns
     SET status = 'PROCESSING', last_error = NULL, updated_at = ?
     WHERE id = ? AND status IN ('FAILED', 'CANCELLED')`,
  )
    .bind(now, campaignId)
    .run();

  await writeAuditLog(env, {
    businessId,
    userId: user.id,
    action: 'whatsapp_web.broadcast.resumed',
    entityType: 'whatsapp_web_campaign',
    entityId: campaignId,
    metadata: { recipients: remaining.length },
  });

  const updated = await env.DB.prepare(`SELECT ${CAMPAIGN_COLUMNS} FROM whatsapp_web_campaigns WHERE id = ? LIMIT 1`)
    .bind(campaignId)
    .first<CampaignRow>();

  return jsonResponse({ success: true, campaign: updated ? presentCampaign(updated) : null });
}

async function handleInternalProgress(request: Request, env: Env): Promise<Response> {
  const provided = request.headers.get('x-callback-secret') ?? '';
  // L2: constant-time compare, matching every other secret check in the repo.
  if (!env.WHATSAPP_WEB_CALLBACK_SECRET || !timingSafeEqualString(provided, env.WHATSAPP_WEB_CALLBACK_SECRET)) {
    return errorResponse('Invalid callback secret.', 403);
  }

  const input = progressCallbackSchema.parse(await request.json());
  const row = await env.DB.prepare(
    `SELECT ${CAMPAIGN_COLUMNS} FROM whatsapp_web_campaigns WHERE id = ? LIMIT 1`,
  )
    .bind(input.campaignId)
    .first<CampaignRow>();

  if (!row) return errorResponse('Broadcast not found.', 404);

  const active = row.status === 'QUEUED' || row.status === 'PROCESSING';
  const now = new Date().toISOString();

  if (input.event === 'progress') {
    if (!active) return jsonResponse({ success: true, ignored: true });
    const normalized = input.phone ? normalizePhone(input.phone) : null;
    const ok = input.ok === true;
    await env.DB.prepare(
      `INSERT OR IGNORE INTO whatsapp_web_message_log
         (id, campaign_id, business_id, phone, phone_normalized, status, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        row.id,
        row.business_id,
        input.phone ?? null,
        normalized,
        ok ? 'sent' : 'failed',
        ok ? null : (input.error ?? 'Delivery failed.'),
        now,
      )
      .run();
    await env.DB.prepare(
      `UPDATE whatsapp_web_campaigns
       SET sent_count = sent_count + ?, failed_count = failed_count + ?,
           status = CASE WHEN status = 'QUEUED' THEN 'PROCESSING' ELSE status END,
           updated_at = ?
       WHERE id = ? AND status IN ('QUEUED', 'PROCESSING')`,
    )
      .bind(ok ? 1 : 0, ok ? 0 : 1, now, row.id)
      .run();
    return jsonResponse({ success: true });
  }

  if (input.event === 'complete') {
    await env.DB.prepare(
      `UPDATE whatsapp_web_campaigns SET status = 'COMPLETED', updated_at = ?
       WHERE id = ? AND status IN ('QUEUED', 'PROCESSING')`,
    )
      .bind(now, row.id)
      .run();
    return jsonResponse({ success: true });
  }

  const unsent = Math.max(0, row.total_recipients - row.sent_count - row.failed_count);
  await env.DB.prepare(
    `UPDATE whatsapp_web_campaigns SET status = 'FAILED', last_error = ?, updated_at = ?
     WHERE id = ? AND status IN ('QUEUED', 'PROCESSING')`,
  )
    .bind(input.error ?? 'Gateway failed before sending.', now, row.id)
    .run();
  await refundUnsent(env, row.business_id, unsent);
  return jsonResponse({ success: true });
}

export async function handleWhatsAppWebRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (!path.startsWith(BASE_PATH)) return errorResponse('Route not found.', 404);

  try {
    if (path === INTERNAL_PATH) {
      if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
      return await handleInternalProgress(request, env);
    }

    const user = await getAuthenticatedUser(request, env);
    if (!user) return errorResponse('Authentication required.', 401);

    const businessId = await getPrimaryBusinessId(user.id, env);
    if (!businessId) return errorResponse('Create a business before using WhatsApp broadcasts.', 404);

    const access = await getBusinessAccess(env, businessId);
    if (!access.canManage) {
      return errorResponse('This account is read-only. Activate a plan from Billing to send broadcasts.', 403);
    }

    // Operator-controlled kill switch: status stays readable so the UI can
    // explain the disabled state, everything that sends is rejected.
    const features = await getEffectiveFeatures(env, businessId);

    if (path === `${BASE_PATH}/status`) {
      if (request.method !== 'GET') return errorResponse('Method not allowed.', 405);
      return await handleStatus(env, businessId, features.whatsappEnabled);
    }

    if (!features.whatsappEnabled) {
      return errorResponse('WhatsApp marketing is currently disabled by the platform administrator.', 403);
    }

    if (path === `${BASE_PATH}/winners`) {
      if (request.method !== 'GET') return errorResponse('Method not allowed.', 405);
      return await handleWinners(env, businessId);
    }

    if (path === BROADCAST_PATH) {
      if (request.method === 'POST') return await handleBroadcastCreate(request, env, user, businessId);
      if (request.method === 'GET') return await handleList(env, businessId);
      return errorResponse('Method not allowed.', 405);
    }

    const itemMatch = CAMPAIGN_ITEM_PATTERN.exec(path);
    if (itemMatch?.[1]) {
      const campaignId = itemMatch[1];
      const action = itemMatch[2];
      if (action === 'cancel') {
        if (request.method === 'POST') return await handleCancel(env, businessId, campaignId);
        return errorResponse('Method not allowed.', 405);
      }
      if (action === 'resume') {
        if (request.method === 'POST') return await handleResume(env, user, businessId, campaignId);
        return errorResponse('Method not allowed.', 405);
      }
      if (request.method === 'GET') return await handleGet(env, businessId, campaignId);
      return errorResponse('Method not allowed.', 405);
    }

    return errorResponse('Route not found.', 404);
  } catch (error) {
    if (error instanceof z.ZodError) return errorResponse('Validation failed.', 400, error.flatten());
    console.error('WhatsApp Web route failed.', error);
    return errorResponse('WhatsApp Web route failed.', 500);
  }
}
