import { z } from 'zod';
import { errorResponse, jsonResponse } from '../lib/http';
import { timingSafeEqualString } from '../lib/crypto';
import { getAuthenticatedUser, getPrimaryBusinessId, writeAuditLog } from '../lib/tenant';
import { getBusinessAccess } from '../lib/subscription-access';
import { getSmsBroadcastLimits } from '../lib/subscription-limits';
import { getEffectiveFeatures, FeatureDisabledError } from '../lib/feature-access';
import {
  SMS_MAX_MESSAGE_CHARS,
  SmsGatewayConfig,
  getSmsGatewayConfig,
  registerGatewayWebhooks,
  sendSmsMessage,
} from '../lib/sms';
import { normalizePhone } from '../lib/sms';
import type { AuthenticatedUser } from '../lib/tenant';
import type { Env } from '../types';

const BASE_PATH = '/api/sms';
const INTERNAL_PATH = `${BASE_PATH}/internal/progress`;
const BROADCAST_PATH = `${BASE_PATH}/broadcast`;
const WEBHOOK_SETUP_PATH = `${BASE_PATH}/webhook-setup`;
const CAMPAIGN_ITEM_PATTERN = /^\/api\/sms\/broadcast\/([^/]+)(?:\/(cancel|resume))?$/;
/** Gateway liveness windows: a recent ping means ONLINE, a stale one UNKNOWN. */
const GATEWAY_ONLINE_WINDOW_MS = 5 * 60_000;
const GATEWAY_STALE_WINDOW_MS = 30 * 60_000;
const GATEWAY_LAST_SEEN_KEY = 'sms:gw:last_seen';
const CANCEL_TIMEOUT_MS = 4_000;

const SMS_GATEWAY_DISABLED_MESSAGE = 'SMS marketing is not enabled for this workspace.';
/** Shown when the whole broadcast failed upstream (bad credentials). */
const SMS_AUTH_FAILED_MESSAGE = 'SMS gateway rejected the credentials. Unsent messages were refunded.';
const SMS_CANCELLED_ROW_ERROR = 'Cancelled before delivery.';

const smsRecipientSchema = z.object({
  name: z.string().trim().max(120).optional(),
  phone: z.string().trim().min(3).max(32),
});

const smsBroadcastSchema = z.object({
  message: z.string().trim().min(1).max(SMS_MAX_MESSAGE_CHARS),
  recipients: z.array(smsRecipientSchema).min(1).max(500),
});

const smsWebhookCallbackSchema = z
  .object({
    event: z.string().min(1).max(64),
    payload: z
      .object({
        messageId: z.string().max(255).optional(),
        phoneNumber: z.string().max(64).optional(),
        message: z.string().max(1024).optional(),
        receivedAt: z.union([z.string(), z.number()]).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

/** STOP keyword bodies unsubscribe the sender phone. */
const STOP_KEYWORD_PATTERN = /^\s*(STOP|ARR[ÊE]TE|ARR[ÊE]T|UNSUBSCRIBE)\b/i;

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/** 403 copy; identical wording to the WhatsApp routes (same product contract). */
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
    `SELECT sms_messages_sent_this_month AS sent, sms_usage_month AS month
     FROM subscriptions WHERE business_id = ? ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(businessId)
    .first<{ sent: number; month: string | null }>();

  if (!row) return 0;
  // A counter from another month reads as zero until the next write resets it.
  return row.month === currentMonth() ? Number(row.sent ?? 0) : 0;
}

/** Optional pilot switch: CSV of business ids; empty/absent = every workspace. */
function smsGatewayAllowed(env: Env, businessId: string): boolean {
  const raw = (env.SMS_ALLOWLIST ?? '').trim();
  if (!raw) return true;
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .includes(businessId);
}

async function refundUnsent(env: Env, businessId: string, refund: number): Promise<void> {
  if (refund <= 0) return;
  await env.DB.prepare(
    `UPDATE subscriptions
     SET sms_messages_sent_this_month = max(0, sms_messages_sent_this_month - ?)
     WHERE business_id = ? AND sms_usage_month = ?`,
  )
    .bind(refund, businessId, currentMonth())
    .run();
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

/**
 * Gateway liveness from the last callback heartbeat instead of a blocking
 * `GET /health`: pings arrive for free on the webhook and quarantine logic
 * must never depend on a sync gateway roundtrip.
 */
async function readGatewayState(env: Env): Promise<'ONLINE' | 'OFFLINE' | 'UNKNOWN'> {
  const raw = await env.TOKENS.get(GATEWAY_LAST_SEEN_KEY);
  if (!raw) return 'UNKNOWN';
  const seenAt = /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
  if (!Number.isFinite(seenAt)) return 'UNKNOWN';
  const age = Date.now() - seenAt;
  if (age < GATEWAY_ONLINE_WINDOW_MS) return 'ONLINE';
  if (age < GATEWAY_STALE_WINDOW_MS) return 'UNKNOWN';
  return 'OFFLINE';
}

async function handleStatus(env: Env, businessId: string, enabled: boolean): Promise<Response> {
  const [access, limits, sent, state, configured] = await Promise.all([
    getBusinessAccess(env, businessId),
    getSmsBroadcastLimits(env, businessId),
    readUsage(env, businessId),
    readGatewayState(env),
    Promise.resolve(getSmsGatewayConfig(env).configured),
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
      configured,
      gateway: { state },
    },
  });
}

async function handleWinners(env: Env, businessId: string): Promise<Response> {
  const [candidates, log] = await Promise.all([
    env.DB.prepare(
      `SELECT c.id, c.campaign_id, cu.first_name, cu.last_name, cu.phone, r.name AS reward_name, c.issued_at
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
        campaign_id: string;
        first_name: string | null;
        last_name: string | null;
        phone: string;
        reward_name: string | null;
        issued_at: string;
      }>(),
    env.DB.prepare(
      `SELECT DISTINCT phone_normalized FROM sms_message_log
       WHERE business_id = ? AND phone_normalized IS NOT NULL`,
    )
      .bind(businessId)
      .all<{ phone_normalized: string }>(),
  ]);

  const alreadyMessaged = new Set((log.results ?? []).map((row) => row.phone_normalized));
  const seen = new Set<string>();
  const winners: Array<{ id: string; name: string | null; phone: string; prize: string | null; campaignId: string }> = [];

  for (const row of candidates.results ?? []) {
    const normalized = normalizePhone(row.phone);
    if (!normalized || alreadyMessaged.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    winners.push({
      id: row.id,
      name: [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || null,
      phone: row.phone,
      prize: row.reward_name,
      campaignId: row.campaign_id,
    });
    if (winners.length >= 200) break;
  }

  return jsonResponse({ success: true, winners });
}

/** Recomputed counters + completion in one guarded statement: an event that
 *  lands late can never corrupt the totals, and a campaign whose rows are all
 *  terminal completes itself regardless of which event arrived last. */
async function syncCampaignCounters(env: Env, campaignId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE sms_campaigns SET
       sent_count = (SELECT COUNT(*) FROM sms_message_log WHERE campaign_id = ? AND status IN ('SENT', 'DELIVERED')),
       failed_count = (SELECT COUNT(*) FROM sms_message_log WHERE campaign_id = ? AND status IN ('FAILED', 'CANCELLED')),
       status = CASE
         WHEN status IN ('QUEUED', 'PROCESSING')
           AND (SELECT COUNT(*) FROM sms_message_log
                WHERE campaign_id = ? AND status NOT IN ('SENT', 'DELIVERED', 'FAILED', 'CANCELLED')) = 0
         THEN 'COMPLETED'
         ELSE status END,
       updated_at = ?
     WHERE id = ?`,
  )
    .bind(campaignId, campaignId, campaignId, new Date().toISOString(), campaignId)
    .run();
}

/**
 * Settles a campaign whose dispatch died mid-flight (auth rejected, Worker
 * eviction before the send loop finished): never-queued rows become FAILED
 * and their quota reservation is refunded. The guarded status transition
 * makes the refund fire at most once.
 */
export async function settleInterruptedSmsCampaign(env: Env, campaignId: string, reason: string): Promise<void> {
  const row = await env.DB.prepare(
    `SELECT ${CAMPAIGN_COLUMNS} FROM sms_campaigns WHERE id = ? LIMIT 1`,
  )
    .bind(campaignId)
    .first<CampaignRow>();

  if (!row) return;
  if (row.status !== 'QUEUED' && row.status !== 'PROCESSING') return;

  const pending = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM sms_message_log WHERE campaign_id = ? AND status = 'PENDING'`,
  )
    .bind(campaignId)
    .first<{ count: number }>();
  const unsent = Math.min(Number(pending?.count ?? 0), row.total_recipients);

  await env.DB.prepare(
    `UPDATE sms_message_log SET status = 'FAILED', error = ?, updated_at = ?
     WHERE campaign_id = ? AND status = 'PENDING'`,
  )
    .bind(reason, new Date().toISOString(), campaignId)
    .run();

  const result = await env.DB.prepare(
    `UPDATE sms_campaigns SET status = 'FAILED', last_error = ?, updated_at = ?
     WHERE id = ? AND status IN ('QUEUED', 'PROCESSING')`,
  )
    .bind(reason, new Date().toISOString(), campaignId)
    .run();

  if (Number(result.meta.changes ?? 0) > 0) {
    await refundUnsent(env, row.business_id, unsent);
  }
  await syncCampaignCounters(env, campaignId);
}

type HandledRecipient = { name?: string; phone: string };

type DispatchOutcome = { queued: number; failed: number; authFailure: string | null };

/**
 * Sends one SMS per recipient through the gateway, retrying inside the
 * client; per-recipient failures mark just that log row FAILED and the loop
 * carries on. Only bad credentials abort the whole broadcast (retrying the
 * remaining recipients would waste each one).
 */
async function dispatchSmsRecipients(
  env: Env,
  config: SmsGatewayConfig,
  campaignId: string,
  message: string,
  recipients: HandledRecipient[],
): Promise<DispatchOutcome> {
  const outcome: DispatchOutcome = { queued: 0, failed: 0, authFailure: null };

  for (const recipient of recipients) {
    const result = await sendSmsMessage(env, config, message, recipient.phone);
    if (result.ok) {
      outcome.queued += 1;
      if (result.messageId) {
        await env.DB.prepare(
          `UPDATE sms_message_log SET gateway_message_id = ?, error = NULL, updated_at = ?
           WHERE campaign_id = ? AND phone_normalized = ?`,
        )
          .bind(result.messageId, new Date().toISOString(), campaignId, recipient.phone)
          .run();
      }
    } else if (result.authFailed) {
      outcome.authFailure = SMS_AUTH_FAILED_MESSAGE;
      return outcome;
    } else {
      outcome.failed += 1;
      await env.DB.prepare(
        `UPDATE sms_message_log SET status = 'FAILED', error = ?, updated_at = ?
         WHERE campaign_id = ? AND phone_normalized = ? AND status = 'PENDING'`,
      )
        .bind(
          `Gateway rejected the message${result.status ? ` (HTTP ${result.status})` : ''}.`,
          new Date().toISOString(),
          campaignId,
          recipient.phone,
        )
        .run();
    }
  }

  return outcome;
}

async function insertMessageLogRows(
  env: Env,
  businessId: string,
  campaignId: string,
  recipients: HandledRecipient[],
): Promise<void> {
  const now = new Date().toISOString();
  for (const recipient of recipients) {
    await env.DB.prepare(
      `INSERT INTO sms_message_log
         (id, campaign_id, business_id, phone, phone_normalized, gateway_message_id, status, error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, 'PENDING', NULL, ?, ?)`,
    )
      .bind(crypto.randomUUID(), campaignId, businessId, recipient.phone, recipient.phone, now, now)
      .run();
  }
}

async function handleBroadcastCreate(
  request: Request,
  env: Env,
  user: AuthenticatedUser,
  businessId: string,
): Promise<Response> {
  const input = smsBroadcastSchema.parse(await request.json());

  const config = getSmsGatewayConfig(env);
  if (!config.configured) return errorResponse('SMS gateway is not configured.', 503);
  if (!smsGatewayAllowed(env, businessId)) return errorResponse(SMS_GATEWAY_DISABLED_MESSAGE, 403);

  const limits = await getSmsBroadcastLimits(env, businessId);
  if (limits.monthly <= 0) {
    return errorResponse('SMS Broadcasts require a Pro or Business plan. Upgrade to unlock bulk messaging.', 403);
  }

  const recipients: HandledRecipient[] = [];
  const seen = new Set<string>();
  for (const [index, recipient] of input.recipients.entries()) {
    const phone = normalizePhone(recipient.phone);
    if (!phone) {
      return errorResponse(`Invalid phone number for recipient #${index + 1}: "${recipient.phone}".`, 400);
    }
    if (seen.has(phone)) continue;
    seen.add(phone);
    recipients.push({ ...(recipient.name ? { name: recipient.name } : {}), phone });
  }

  // Global stop list: a phone that replied STOP never gets another message.
  const suppressed = await env.DB.prepare(`SELECT phone_normalized FROM sms_suppression`).all<{
    phone_normalized: string;
  }>();
  const suppressedSet = new Set((suppressed.results ?? []).map((row) => row.phone_normalized));
  const filtered = recipients.filter((recipient) => !suppressedSet.has(recipient.phone));
  if (filtered.length === 0) {
    return errorResponse('Every recipient unsubscribed from SMS messaging.', 409);
  }
  recipients.length = 0;
  recipients.push(...filtered);

  if (recipients.length > limits.batch) return errorResponse(batchLimitMessage(limits.batch), 403);
  if (recipients.length > limits.monthly) return errorResponse(limitMessage(limits.monthly), 403);

  const active = await env.DB.prepare(
    `SELECT id FROM sms_campaigns WHERE business_id = ? AND status IN ('QUEUED', 'PROCESSING') LIMIT 1`,
  )
    .bind(businessId)
    .first<{ id: string }>();

  if (active) return errorResponse('An SMS broadcast is already in progress. Wait for it to finish.', 409);

  const month = currentMonth();
  const count = recipients.length;
  const reservation = await env.DB.prepare(
    `UPDATE subscriptions
     SET sms_usage_month = ?,
         sms_messages_sent_this_month = CASE
           WHEN sms_usage_month = ? THEN sms_messages_sent_this_month + ?
           ELSE ? END
     WHERE business_id = ?
       AND (sms_usage_month IS NULL OR sms_usage_month <> ?
            OR sms_messages_sent_this_month + ? <= ?)`,
  )
    .bind(month, month, count, count, businessId, month, count, limits.monthly)
    .run();

  if (Number(reservation.meta.changes ?? 0) === 0) return errorResponse(limitMessage(limits.monthly), 403);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const message = input.message;

  const inserted = await env.DB.prepare(
    `INSERT INTO sms_campaigns
       (id, business_id, user_id, message, recipients, total_recipients, sent_count, failed_count,
        status, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, 'QUEUED', NULL, ?, ?)
     ON CONFLICT(business_id) WHERE status IN ('QUEUED', 'PROCESSING') DO NOTHING`,
  )
    .bind(id, businessId, user.id, message, JSON.stringify(recipients), recipients.length, now, now)
    .run();

  if (Number(inserted.meta.changes ?? 0) === 0) {
    await refundUnsent(env, businessId, count);
    return errorResponse('An SMS broadcast is already in progress. Wait for it to finish.', 409);
  }

  await insertMessageLogRows(env, businessId, id, recipients);

  await writeAuditLog(env, {
    businessId,
    userId: user.id,
    action: 'sms.broadcast.started',
    entityType: 'sms_campaign',
    entityId: id,
    metadata: { recipients: recipients.length, message },
  });

  const outcome = await dispatchSmsRecipients(env, config, id, message, recipients);

  if (outcome.authFailure) {
    await settleInterruptedSmsCampaign(env, id, outcome.authFailure);
    const failed = await env.DB.prepare(`SELECT ${CAMPAIGN_COLUMNS} FROM sms_campaigns WHERE id = ? LIMIT 1`)
      .bind(id)
      .first<CampaignRow>();
    return jsonResponse({ success: true, campaign: failed ? presentCampaign(failed) : null }, 202);
  }

  // Flip QUEUED -> PROCESSING only if no gateway callback settled it first.
  await env.DB.prepare(
    `UPDATE sms_campaigns SET status = 'PROCESSING', updated_at = ? WHERE id = ? AND status = 'QUEUED'`,
  )
    .bind(new Date().toISOString(), id)
    .run();

  await syncCampaignCounters(env, id);

  const updated = await env.DB.prepare(`SELECT ${CAMPAIGN_COLUMNS} FROM sms_campaigns WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<CampaignRow>();

  return jsonResponse({ success: true, campaign: updated ? presentCampaign(updated) : null }, 202);
}

async function handleList(env: Env, businessId: string): Promise<Response> {
  const result = await env.DB.prepare(
    `SELECT ${CAMPAIGN_COLUMNS} FROM sms_campaigns WHERE business_id = ?
     ORDER BY created_at DESC LIMIT 20`,
  )
    .bind(businessId)
    .all<CampaignRow>();

  return jsonResponse({ success: true, campaigns: (result.results ?? []).map(presentCampaign) });
}

async function handleGet(env: Env, businessId: string, campaignId: string): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT ${CAMPAIGN_COLUMNS} FROM sms_campaigns WHERE id = ? AND business_id = ? LIMIT 1`,
  )
    .bind(campaignId, businessId)
    .first<CampaignRow>();

  if (!row) return errorResponse('Broadcast not found.', 404);
  return jsonResponse({ success: true, campaign: presentCampaign(row) });
}

/** Best-effort queue cancel through the device API DELETE /message/{id}; a dead
 *  gateway must not block the Worker-side status flip, which is authoritative. */
async function cancelGatewayMessages(env: Env, campaignId: string): Promise<void> {
  const config = getSmsGatewayConfig(env);
  if (!config.configured) return;
  const rows = await env.DB.prepare(
    `SELECT gateway_message_id FROM sms_message_log
     WHERE campaign_id = ? AND status = 'PENDING' AND gateway_message_id IS NOT NULL`,
  )
    .bind(campaignId)
    .all<{ gateway_message_id: string }>();

  for (const row of rows.results ?? []) {
    try {
      await fetch(`${config.baseUrl}/message/${encodeURIComponent(row.gateway_message_id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Basic ${btoa(`${config.user}:${config.password}`)}` },
        signal: AbortSignal.timeout(CANCEL_TIMEOUT_MS),
      });
    } catch {
      // The Worker-side settle is authoritative; ignore gateway failures.
    }
  }
}

async function handleCancel(env: Env, businessId: string, campaignId: string): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT ${CAMPAIGN_COLUMNS} FROM sms_campaigns WHERE id = ? AND business_id = ? LIMIT 1`,
  )
    .bind(campaignId, businessId)
    .first<CampaignRow>();

  if (!row) return errorResponse('Broadcast not found.', 404);
  if (row.status !== 'QUEUED' && row.status !== 'PROCESSING') {
    return errorResponse('This broadcast is not active.', 409);
  }

  await cancelGatewayMessages(env, campaignId);

  const pending = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM sms_message_log WHERE campaign_id = ? AND status = 'PENDING'`,
  )
    .bind(campaignId)
    .first<{ count: number }>();
  const unsent = Math.min(Number(pending?.count ?? 0), row.total_recipients);

  await env.DB.prepare(
    `UPDATE sms_message_log SET status = 'CANCELLED', error = ?, updated_at = ?
     WHERE campaign_id = ? AND status = 'PENDING'`,
  )
    .bind(SMS_CANCELLED_ROW_ERROR, new Date().toISOString(), campaignId)
    .run();

  await refundUnsent(env, businessId, unsent);

  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE sms_campaigns SET status = 'CANCELLED', updated_at = ? WHERE id = ? AND status IN ('QUEUED', 'PROCESSING')`,
  )
    .bind(now, campaignId)
    .run();

  await syncCampaignCounters(env, campaignId);

  const updated = await env.DB.prepare(`SELECT ${CAMPAIGN_COLUMNS} FROM sms_campaigns WHERE id = ? LIMIT 1`)
    .bind(campaignId)
    .first<CampaignRow>();

  return jsonResponse({ success: true, ok: true, campaign: updated ? presentCampaign(updated) : null });
}

async function handleResume(env: Env, user: AuthenticatedUser, businessId: string, campaignId: string): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT ${CAMPAIGN_COLUMNS} FROM sms_campaigns WHERE id = ? AND business_id = ? LIMIT 1`,
  )
    .bind(campaignId, businessId)
    .first<CampaignRow>();

  if (!row) return errorResponse('Broadcast not found.', 404);
  if (row.status !== 'FAILED' && row.status !== 'CANCELLED') {
    return errorResponse('Only failed or cancelled broadcasts can be resumed.', 409);
  }
  if (!smsGatewayAllowed(env, businessId)) return errorResponse(SMS_GATEWAY_DISABLED_MESSAGE, 403);

  const active = await env.DB.prepare(
    `SELECT id FROM sms_campaigns WHERE business_id = ? AND status IN ('QUEUED', 'PROCESSING') AND id <> ? LIMIT 1`,
  )
    .bind(businessId, campaignId)
    .first<{ id: string }>();
  if (active) return errorResponse('An SMS broadcast is already in progress. Wait for it to finish.', 409);

  let stored: HandledRecipient[] = [];
  try {
    const parsed: unknown = JSON.parse(row.recipients);
    if (Array.isArray(parsed)) stored = parsed as typeof stored;
  } catch {
    return errorResponse('Campaign recipients are unreadable.', 500);
  }

  const sentLog = await env.DB.prepare(
    `SELECT DISTINCT phone_normalized FROM sms_message_log
     WHERE campaign_id = ? AND phone_normalized IS NOT NULL AND status IN ('SENT', 'DELIVERED')`,
  )
    .bind(campaignId)
    .all<{ phone_normalized: string }>();

  const delivered = new Set((sentLog.results ?? []).map((entry) => entry.phone_normalized));
  const remaining: HandledRecipient[] = [];
  const seen = new Set<string>();
  for (const recipient of stored) {
    const normalized = normalizePhone(recipient.phone);
    if (!normalized || delivered.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    remaining.push(recipient);
  }

  if (remaining.length === 0) return errorResponse('No unsent recipients left in this broadcast.', 409);

  // Re-arm the retried rows so a fresh POST flows through the normal lifecycle.
  const now = new Date().toISOString();
  for (const recipient of remaining) {
    const normalized = normalizePhone(recipient.phone);
    if (!normalized) continue;
    await env.DB.prepare(
      `UPDATE sms_message_log SET status = 'PENDING', error = NULL, updated_at = ?
       WHERE campaign_id = ? AND phone_normalized = ?`,
    )
      .bind(now, campaignId, normalized)
      .run();
  }

  const dispatchError = (await dispatchSmsRecipients(env, getSmsGatewayConfig(env), campaignId, row.message, remaining))
    .authFailure;

  // Mirror the Web route: a resume dispatch failure leaves the campaign in its
  // previous settlement; the merchant can retry once the gateway is healthy.
  if (dispatchError) return errorResponse(dispatchError, 503);

  await env.DB.prepare(
    `UPDATE sms_campaigns
     SET status = 'PROCESSING', last_error = NULL, updated_at = ?
     WHERE id = ? AND status IN ('FAILED', 'CANCELLED')`,
  )
    .bind(new Date().toISOString(), campaignId)
    .run();

  await syncCampaignCounters(env, campaignId);

  await writeAuditLog(env, {
    businessId,
    userId: user.id,
    action: 'sms.broadcast.resumed',
    entityType: 'sms_campaign',
    entityId: campaignId,
    metadata: { recipients: remaining.length },
  });

  const updated = await env.DB.prepare(`SELECT ${CAMPAIGN_COLUMNS} FROM sms_campaigns WHERE id = ? LIMIT 1`)
    .bind(campaignId)
    .first<CampaignRow>();

  return jsonResponse({ success: true, ok: true, campaign: updated ? presentCampaign(updated) : null });
}

async function handleWebhookSetup(
  request: Request,
  env: Env,
  user: AuthenticatedUser,
  businessId: string,
): Promise<Response> {
  const config = getSmsGatewayConfig(env);
  if (!config.configured) return errorResponse('SMS gateway is not configured.', 503);
  if (!env.SMS_WEBHOOK_SECRET) return errorResponse('SMS webhook secret is not configured.', 503);

  const origin = env.APP_ORIGIN ?? new URL(request.url).origin;
  const callbackUrl = `${origin}${INTERNAL_PATH}?secret=${encodeURIComponent(env.SMS_WEBHOOK_SECRET)}`;

  const registered = await registerGatewayWebhooks(env, config, callbackUrl);

  await writeAuditLog(env, {
    businessId,
    userId: user.id,
    action: 'sms.webhook.setup',
    entityType: 'sms_gateway_webhook',
    entityId: businessId,
    metadata: { registered, callbackPath: INTERNAL_PATH },
  });

  return jsonResponse({ success: true, registered });
}

/** Log-row statuses allowed before each event can land (idempotent replays). */
const LOG_EVENT_TRANSITIONS: Record<string, { next: string; from: string[] }> = {
  'sms:sent': { next: 'SENT', from: ['PENDING'] },
  'sms:delivered': { next: 'DELIVERED', from: ['PENDING', 'SENT'] },
  'sms:failed': { next: 'FAILED', from: ['PENDING', 'SENT'] },
  'sms:cancelled': { next: 'CANCELLED', from: ['PENDING', 'SENT'] },
};

async function handleInternalProgress(request: Request, env: Env): Promise<Response> {
  const provided = new URL(request.url).searchParams.get('secret') ?? '';
  // L2: constant-time compare, matching every other secret check in the repo.
  if (!env.SMS_WEBHOOK_SECRET || !timingSafeEqualString(provided, env.SMS_WEBHOOK_SECRET)) {
    return errorResponse('Invalid callback secret.', 403);
  }

  const input = smsWebhookCallbackSchema.parse(await request.json());

  if (input.event === 'system:ping' || input.event === 'app:started') {
    await env.TOKENS.put(GATEWAY_LAST_SEEN_KEY, String(Date.now()));
    return jsonResponse({ success: true });
  }

  if (input.event === 'sms:received') {
    if (input.payload?.message && STOP_KEYWORD_PATTERN.test(input.payload.message)) {
      const phone = input.payload.phoneNumber ? normalizePhone(input.payload.phoneNumber) : null;
      if (phone) {
        await env.DB.prepare(
          `INSERT INTO sms_suppression (phone_normalized, reason, created_at)
           VALUES (?, 'STOP', ?) ON CONFLICT(phone_normalized) DO NOTHING`,
        )
          .bind(phone, new Date().toISOString())
          .run();
        const owner = await env.DB.prepare(
          `SELECT business_id FROM sms_message_log WHERE phone_normalized = ? ORDER BY created_at DESC LIMIT 1`,
        )
          .bind(phone)
          .first<{ business_id: string | null }>();
        if (owner?.business_id) {
          await writeAuditLog(env, {
            businessId: owner.business_id,
            userId: null,
            action: 'sms.suppression.stop',
            entityType: 'sms_suppression',
            entityId: phone,
            metadata: { reason: 'STOP' },
          });
        }
      }
    }
    return jsonResponse({ success: true });
  }

  const transition = LOG_EVENT_TRANSITIONS[input.event];
  if (!transition) return jsonResponse({ success: true, ignored: true });

  const now = new Date().toISOString();
  const messageId = input.payload?.messageId ?? null;
  const phoneNumber = input.payload?.phoneNumber ? normalizePhone(input.payload.phoneNumber) : null;

  // The webhook carries no campaign id: match by gateway id first, then fall
  // back to the newest un-acked row for that phone. Anything else is ignored.
  let logRow = messageId
    ? await env.DB.prepare(
        `SELECT id, campaign_id FROM sms_message_log WHERE gateway_message_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
        .bind(messageId)
        .first<{ id: string; campaign_id: string }>()
    : null;
  if (!logRow && phoneNumber) {
    logRow = await env.DB.prepare(
      `SELECT id, campaign_id FROM sms_message_log
       WHERE phone_normalized = ? AND status = 'PENDING'
       ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(phoneNumber)
      .first<{ id: string; campaign_id: string }>();
  }

  if (!logRow) return jsonResponse({ success: true, ignored: true });

  const campaign = await env.DB.prepare(`SELECT ${CAMPAIGN_COLUMNS} FROM sms_campaigns WHERE id = ? LIMIT 1`)
    .bind(logRow.campaign_id)
    .first<CampaignRow>();
  if (!campaign) return errorResponse('Broadcast not found.', 404);

  const active = campaign.status === 'QUEUED' || campaign.status === 'PROCESSING';
  if (!active) return jsonResponse({ success: true, ignored: true });

  await env.DB.prepare(
    `UPDATE sms_message_log SET status = ?, error = ?, updated_at = ?
     WHERE id = ? AND status IN (${transition.from.map(() => '?').join(', ')})`,
  )
    .bind(
      transition.next,
      transition.next === 'FAILED' ? 'Delivery failed.' : null,
      now,
      logRow.id,
      ...transition.from,
    )
    .run();

  await syncCampaignCounters(env, logRow.campaign_id);

  return jsonResponse({ success: true });
}

export async function handleSmsRoute(request: Request, env: Env): Promise<Response> {
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
    if (!businessId) return errorResponse('Create a business before using SMS broadcasts.', 404);

    const access = await getBusinessAccess(env, businessId);
    if (!access.canManage) {
      return errorResponse('This account is read-only. Activate a plan from Billing to send broadcasts.', 403);
    }

    // Operator-controlled kill switch: status stays readable so the UI can
    // explain the disabled state, everything that sends is rejected.
    const features = await getEffectiveFeatures(env, businessId);

    if (path === `${BASE_PATH}/status`) {
      if (request.method !== 'GET') return errorResponse('Method not allowed.', 405);
      return await handleStatus(env, businessId, features.smsEnabled);
    }

    if (!features.smsEnabled) throw new FeatureDisabledError('sms');

    if (path === WEBHOOK_SETUP_PATH) {
      if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
      return await handleWebhookSetup(request, env, user, businessId);
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
    if (error instanceof FeatureDisabledError) return errorResponse(error.message, 403);
    console.error('SMS route failed.', error);
    return errorResponse('SMS route failed.', 500);
  }
}
