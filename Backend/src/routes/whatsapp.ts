import { z } from 'zod';
import { errorResponse, jsonResponse } from '../lib/http';
import { getAuthenticatedUser, getPrimaryBusinessId, writeAuditLog } from '../lib/tenant';
import { getBusinessAccess } from '../lib/subscription-access';
import { getWhatsAppBroadcastLimits } from '../lib/subscription-limits';
import { getEffectiveFeatures } from '../lib/feature-access';
import { whatsappBroadcastSchema } from '../lib/validation';
import { PACE_DELAY_MS, fetchApprovedTemplates, getWhatsAppConfig, normalizePhone, pacingGateFor } from '../lib/whatsapp';
import type { AuthenticatedUser } from '../lib/tenant';
import type { Env } from '../types';

const BASE_PATH = '/api/whatsapp';
const BROADCAST_PATH = `${BASE_PATH}/broadcast`;
const ITEM_PATTERN = /^\/api\/whatsapp\/broadcast\/([^/]+)$/;

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/** 403 copy; the Pro wording is the exact contract from the product spec. */
function limitMessage(limit: number): string {
  if (limit === 200) return 'PRO plan limit reached. Upgrade to Business for 1000 messages';
  if (limit >= 1000) return `BUSINESS plan limit reached (${limit} messages per month).`;
  return `Plan limit reached (${limit} messages per month).`;
}

/** 403 copy for the per-broadcast recipient cap (spec: Pro 100 / Business 250). */
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
  // A counter from another month reads as zero until the next write resets it.
  return row.month === currentMonth() ? Number(row.sent ?? 0) : 0;
}

/** Circuit-breaker snapshot; null when the pacing gate is unreachable. */
async function readCircuit(env: Env): Promise<{ blockedUntil: number; lastSentAt: number; opens24h: number } | null> {
  try {
    const stats = await pacingGateFor(env).stats();
    return { blockedUntil: stats.blockedUntil, lastSentAt: stats.lastSentAt, opens24h: stats.opens24h };
  } catch {
    return null;
  }
}

async function handleStatus(env: Env, businessId: string, enabled: boolean): Promise<Response> {
  const [access, limits, sent, circuit] = await Promise.all([
    getBusinessAccess(env, businessId),
    getWhatsAppBroadcastLimits(env, businessId),
    readUsage(env, businessId),
    readCircuit(env),
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
      configured: getWhatsAppConfig(env) !== null,
      circuit,
    },
  });
}

async function handleTemplates(env: Env): Promise<Response> {
  if (!getWhatsAppConfig(env)) {
    return jsonResponse({ success: false, error: 'WhatsApp is not configured.', configured: false }, 503);
  }

  try {
    const templates = await fetchApprovedTemplates(env);
    return jsonResponse({ success: true, templates, configured: true });
  } catch (error) {
    console.error('Unable to load WhatsApp templates.', error);
    return jsonResponse({ success: false, error: 'Unable to load templates from Meta.' }, 502);
  }
}

async function handleBroadcastCreate(
  request: Request,
  env: Env,
  user: AuthenticatedUser,
  businessId: string,
): Promise<Response> {
  const input = whatsappBroadcastSchema.parse(await request.json());

  if (!getWhatsAppConfig(env)) return errorResponse('WhatsApp is not configured.', 503);

  const limits = await getWhatsAppBroadcastLimits(env, businessId);
  if (limits.monthly <= 0) {
    return errorResponse('WhatsApp Broadcasts require a Pro or Business plan. Upgrade to unlock bulk messaging.', 403);
  }

  const recipients: Array<{ name?: string; phone: string }> = [];
  for (const [index, recipient] of input.recipients.entries()) {
    const phone = normalizePhone(recipient.phone);
    if (!phone) {
      return errorResponse(`Invalid phone number for recipient #${index + 1}: "${recipient.phone}".`, 400);
    }
    recipients.push({ ...(recipient.name ? { name: recipient.name } : {}), phone });
  }

  if (recipients.length > limits.batch) return errorResponse(batchLimitMessage(limits.batch), 403);
  if (recipients.length > limits.monthly) return errorResponse(limitMessage(limits.monthly), 403);

  const active = await env.DB.prepare(
    `SELECT id FROM whatsapp_campaigns WHERE business_id = ? AND status IN ('PENDING', 'PROCESSING') LIMIT 1`,
  )
    .bind(businessId)
    .first<{ id: string }>();

  if (active) return errorResponse('A broadcast is already in progress. Wait for it to finish.', 409);

  // Atomic monthly reserve: either the new total still fits the plan limit or
  // the row is untouched (changes = 0), so concurrent sends cannot overshoot.
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
  const delayMs = PACE_DELAY_MS[input.pace];

  const inserted = await env.DB.prepare(
    `INSERT INTO whatsapp_campaigns
       (id, business_id, user_id, template_name, template_language, variables, recipients,
        total_recipients, sent_count, failed_count, status, message_delay_ms, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'PENDING', ?, ?, ?)
     ON CONFLICT(business_id) WHERE status IN ('PENDING', 'PROCESSING') DO NOTHING`,
  )
    .bind(
      id,
      businessId,
      user.id,
      input.templateName,
      input.language,
      JSON.stringify(input.variables),
      JSON.stringify(recipients),
      recipients.length,
      delayMs,
      now,
      now,
    )
    .run();

  if (Number(inserted.meta.changes ?? 0) === 0) {
    // A concurrent request won the active-broadcast race — hand the
    // reservation back before reporting the conflict.
    await env.DB.prepare(
      `UPDATE subscriptions
       SET whatsapp_messages_sent_this_month = max(0, whatsapp_messages_sent_this_month - ?)
       WHERE business_id = ? AND whatsapp_usage_month = ?`,
    )
      .bind(count, businessId, month)
      .run();
    return errorResponse('A broadcast is already in progress. Wait for it to finish.', 409);
  }

  await writeAuditLog(env, {
    businessId,
    userId: user.id,
    action: 'whatsapp.broadcast.started',
    entityType: 'whatsapp_campaign',
    entityId: id,
    metadata: { recipients: recipients.length, templateName: input.templateName, language: input.language },
  });

  await env.WHATSAPP_SENDER.getByName(id).schedule(id);

  return jsonResponse(
    {
      success: true,
      campaign: {
        id,
        templateName: input.templateName,
        language: input.language,
        totalRecipients: recipients.length,
        status: 'PENDING',
        createdAt: now,
      },
    },
    202,
  );
}

async function handleBroadcastList(env: Env, businessId: string): Promise<Response> {
  const result = await env.DB.prepare(
    `SELECT id, template_name, template_language, total_recipients, sent_count, failed_count,
            delivered_count, read_count, status, created_at
     FROM whatsapp_campaigns WHERE business_id = ?
     ORDER BY created_at DESC LIMIT 20`,
  )
    .bind(businessId)
    .all<{
      id: string;
      template_name: string;
      template_language: string;
      total_recipients: number;
      sent_count: number;
      failed_count: number;
      delivered_count: number;
      read_count: number;
      status: string;
      created_at: string;
    }>();

  return jsonResponse({
    success: true,
    campaigns: (result.results ?? []).map((row) => ({
      id: row.id,
      templateName: row.template_name,
      language: row.template_language,
      totalRecipients: row.total_recipients,
      sent: row.sent_count,
      failed: row.failed_count,
      delivered: Number(row.delivered_count ?? 0),
      read: Number(row.read_count ?? 0),
      status: row.status,
      createdAt: row.created_at,
    })),
  });
}

async function handleBroadcastGet(env: Env, businessId: string, campaignId: string): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT id, template_name, template_language, total_recipients, sent_count, failed_count,
            delivered_count, read_count, status, last_error, created_at, updated_at
     FROM whatsapp_campaigns WHERE id = ? AND business_id = ? LIMIT 1`,
  )
    .bind(campaignId, businessId)
    .first<{
      id: string;
      template_name: string;
      template_language: string;
      total_recipients: number;
      sent_count: number;
      failed_count: number;
      delivered_count: number;
      read_count: number;
      status: string;
      last_error: string | null;
      created_at: string;
      updated_at: string;
    }>();

  if (!row) return errorResponse('Broadcast not found.', 404);

  return jsonResponse({
    success: true,
    campaign: {
      id: row.id,
      templateName: row.template_name,
      language: row.template_language,
      totalRecipients: row.total_recipients,
      sent: row.sent_count,
      failed: row.failed_count,
      delivered: Number(row.delivered_count ?? 0),
      read: Number(row.read_count ?? 0),
      status: row.status,
      lastError: row.last_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  });
}

export async function handleWhatsAppRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (!path.startsWith(BASE_PATH)) return errorResponse('Route not found.', 404);

  try {
    const user = await getAuthenticatedUser(request, env);
    if (!user) return errorResponse('Authentication required.', 401);

    const businessId = await getPrimaryBusinessId(user.id, env);
    if (!businessId) return errorResponse('Create a business before using WhatsApp broadcasts.', 404);

    // Same read-only gate as every other /api/business mutation.
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

    if (path === `${BASE_PATH}/templates`) {
      if (request.method !== 'GET') return errorResponse('Method not allowed.', 405);
      return await handleTemplates(env);
    }

    if (path === BROADCAST_PATH) {
      if (request.method === 'POST') return await handleBroadcastCreate(request, env, user, businessId);
      if (request.method === 'GET') return await handleBroadcastList(env, businessId);
      return errorResponse('Method not allowed.', 405);
    }

    const itemMatch = ITEM_PATTERN.exec(path);
    if (itemMatch?.[1]) {
      if (request.method !== 'GET') return errorResponse('Method not allowed.', 405);
      return await handleBroadcastGet(env, businessId, itemMatch[1]);
    }

    return errorResponse('Route not found.', 404);
  } catch (error) {
    if (error instanceof z.ZodError) return errorResponse('Validation failed.', 400, error.flatten());
    console.error('WhatsApp route failed.', error);
    return errorResponse('WhatsApp route failed.', 500);
  }
}
