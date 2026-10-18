import { z } from 'zod';
import { errorResponse, jsonResponse } from '../lib/http';
import { getAuthenticatedUser, getPrimaryBusinessId, writeAuditLog } from '../lib/tenant';
import type { AuthenticatedUser } from '../lib/tenant';
import { getBusinessAccess } from '../lib/subscription-access';
import type { BusinessAccess } from '../lib/subscription-access';
import { getEmailLimitsForSlug } from '../lib/subscription-limits';
import { getEffectiveFeatures } from '../lib/feature-access';
import {
  emailAssetUploadSchema,
  emailBroadcastSchema,
  EMAIL_ASSET_MIME_TYPES,
  MAX_EMAIL_ASSET_BYTES,
} from '../lib/validation';
import {
  addSuppression,
  currentUtcDay,
  filterSuppressed,
  getEmailConfig,
  getEmailDailyLimit,
  getMarketingDailyCap,
  getMonthlySoftCap,
  readDailyEmailUsage,
  readDailyReserved,
  refundDailyEmailQuota,
  reserveDailyEmailQuota,
  verifyUnsubscribe,
} from '../lib/email';
import type { EmailRecipient } from '../lib/email';
import type { Env } from '../types';

const BASE_PATH = '/api/email';
const STATUS_PATH = `${BASE_PATH}/status`;
const BROADCAST_PATH = `${BASE_PATH}/broadcast`;
const ASSET_PATH = `${BASE_PATH}/asset`;
const UNSUBSCRIBE_PATH = `${BASE_PATH}/unsubscribe`;
const PUBLIC_ASSET_PATH = '/api/email-assets';

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

type UsageRow = { sent: number | null; resetDate: string | null };

async function readUsage(env: Env, userId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT email_messages_sent_this_month AS sent, email_reset_date AS resetDate
     FROM users WHERE id = ?`,
  )
    .bind(userId)
    .first<UsageRow>();
  if (!row) return 0;
  // A counter stamped in another month reads as zero until the next reserve.
  const resetMonth = (row.resetDate ?? '').slice(0, 7);
  return resetMonth === currentMonth() ? Number(row.sent ?? 0) : 0;
}

function quotaMessage(monthly: number): string {
  if (monthly >= 3000) return `BUSINESS plan limit reached (${monthly} emails per month).`;
  if (monthly === 1000) return 'PRO plan limit reached (1000 emails per month). Upgrade to Business for 3000.';
  return `Plan limit reached (${monthly} emails per month).`;
}

function batchMessage(batch: number): string {
  if (batch === 200) return 'PRO plan allows 200 emails per broadcast.';
  if (batch >= 1000) return 'BUSINESS plan allows 1000 emails per broadcast.';
  return `Plan allows ${batch} emails per broadcast.`;
}

async function handleStatus(env: Env, access: BusinessAccess, user: AuthenticatedUser, enabled: boolean): Promise<Response> {
  const day = currentUtcDay();
  const [usage, dailyUsed, dailyReserved, suppressedRow] = await Promise.all([
    readUsage(env, user.id),
    readDailyEmailUsage(env, day),
    readDailyReserved(env, day),
    env.DB.prepare('SELECT COUNT(*) AS c FROM email_suppression').first<{ c: number }>(),
  ]);
  const limits = getEmailLimitsForSlug(access.plan.slug, access.plan.features.limits);

  return jsonResponse({
    success: true,
    status: {
      allowed: enabled && access.canManage && limits.monthly > 0,
      enabled,
      planSlug: access.plan.slug,
      planName: access.plan.name,
      monthlyLimit: limits.monthly,
      batchLimit: limits.batch,
      sentThisMonth: usage,
      remaining: Math.max(0, limits.monthly - usage),
      configured: getEmailConfig(env) !== null,
      quota: {
        dailyUsed,
        dailyLimit: getEmailDailyLimit(env),
      },
      dailyReserved,
      dailyCap: getMarketingDailyCap(env),
      suppressed: Number(suppressedRow?.c ?? 0),
    },
  });
}

async function handleBroadcastCreate(
  request: Request,
  env: Env,
  user: AuthenticatedUser,
  businessId: string,
  access: BusinessAccess,
): Promise<Response> {
  const input = emailBroadcastSchema.parse(await request.json());

  if (!getEmailConfig(env)) return errorResponse('Email is not configured.', 503);

  // Resolve the attachment from R2: name/mime are whatever the upload
  // stored — the client only supplies the id it got back.
  let asset: { id: string; name: string; mime: string } | null = null;
  if (input.asset) {
    const stored = await env.CAMPAIGN_ASSETS.head(`email-assets/${input.asset.id}`);
    if (!stored || stored.customMetadata?.businessId !== businessId) {
      return errorResponse('Attached file not found. Upload it again.', 404);
    }
    const mime = stored.httpMetadata?.contentType ?? '';
    if (!(EMAIL_ASSET_MIME_TYPES as readonly string[]).includes(mime)) {
      return errorResponse('Unsupported attachment type.', 400);
    }
    let storedName: string;
    try {
      storedName = decodeURIComponent(stored.customMetadata?.name ?? '');
    } catch {
      storedName = '';
    }
    asset = {
      id: input.asset.id,
      name: storedName || (mime === 'application/pdf' ? 'attachment.pdf' : 'image'),
      mime,
    };
  }

  const limits = getEmailLimitsForSlug(access.plan.slug, access.plan.features.limits);
  if (limits.monthly <= 0) {
    return errorResponse('Email Campaigns require a Pro or Business plan. Upgrade to unlock email broadcasts.', 403);
  }

  // Dedupe on the normalized address so the reserve matches what is sent.
  const seen = new Set<string>();
  const recipients: EmailRecipient[] = [];
  for (const recipient of input.recipients) {
    const key = recipient.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    recipients.push({ email: recipient.email, ...(recipient.name ? { name: recipient.name } : {}) });
  }

  // Drop suppressed addresses (unsubscribes, bounces, complaints) before any
  // quota is reserved, so users see honest counts and Resend never sees them.
  const sendable = await filterSuppressed(env, recipients);
  const suppressed = recipients.length - sendable.length;
  if (sendable.length === 0) {
    return errorResponse('Every recipient on this list has unsubscribed or bounced. Nothing to send.', 403);
  }

  if (sendable.length > limits.batch) return errorResponse(batchMessage(limits.batch), 403);

  const active = await env.DB.prepare(
    `SELECT id FROM email_campaigns WHERE business_id = ? AND status IN ('PENDING', 'PROCESSING', 'PAUSED') LIMIT 1`,
  )
    .bind(businessId)
    .first<{ id: string }>();
  if (active) return errorResponse('An email campaign is already in progress. Wait for it to finish.', 409);

  const month = currentMonth();
  const day = currentUtcDay();
  const count = sendable.length;
  const now = new Date().toISOString();

  // Account-wide monthly ceiling (all tenants share the Resend account).
  const softCap = getMonthlySoftCap(env);
  const summed = await env.DB.prepare(
    `SELECT COALESCE(SUM(email_messages_sent_this_month), 0) AS total
     FROM users WHERE substr(COALESCE(email_reset_date, ''), 1, 7) = ?`,
  )
    .bind(month)
    .first<{ total: number }>();
  if (Number(summed?.total ?? 0) + count > softCap) {
    return errorResponse(
      `Account-wide monthly email limit reached (${softCap} emails across all workspaces). Try again next month.`,
      403,
    );
  }

  const reserve = await env.DB.prepare(
    `UPDATE users
     SET email_messages_sent_this_month = CASE
           WHEN substr(COALESCE(email_reset_date, ''), 1, 7) = ? THEN email_messages_sent_this_month + ?
           ELSE ? END,
         email_reset_date = CASE
           WHEN substr(COALESCE(email_reset_date, ''), 1, 7) = ? THEN email_reset_date
           ELSE ? END
     WHERE id = ?
       AND (substr(COALESCE(email_reset_date, ''), 1, 7) <> ?
            OR email_messages_sent_this_month + ? <= ?)`,
  )
    .bind(month, count, count, month, now, user.id, month, count, limits.monthly)
    .run();
  if ((reserve.meta.changes ?? 0) === 0) return errorResponse(quotaMessage(limits.monthly), 403);

  // Daily marketing reserve: guarantees headroom for transactional mail
  // (password resets) against the free tier's 100/day cap.
  const dailyCap = getMarketingDailyCap(env);
  if (!(await reserveDailyEmailQuota(env, day, count, dailyCap))) {
    await env.DB.prepare(
      `UPDATE users
       SET email_messages_sent_this_month = max(0, email_messages_sent_this_month - ?)
       WHERE id = ? AND substr(COALESCE(email_reset_date, ''), 1, 7) = ?`,
    )
      .bind(count, user.id, month)
      .run();
    return errorResponse(
      `Daily marketing email cap reached (${dailyCap}/day). Campaigns resume automatically at midnight UTC.`,
      403,
    );
  }

  const refundReservations = async () => {
    await env.DB.prepare(
      `UPDATE users
       SET email_messages_sent_this_month = max(0, email_messages_sent_this_month - ?)
       WHERE id = ? AND substr(COALESCE(email_reset_date, ''), 1, 7) = ?`,
    )
      .bind(count, user.id, month)
      .run();
    await refundDailyEmailQuota(env, day, count);
  };

  const id = crypto.randomUUID();
  // From stays on the platform's verified domain; the merchant's own email
  // goes to Reply-To so answers land in their inbox.
  const replyTo = input.replyTo?.trim() || user.email;
  const inserted = await env.DB.prepare(
    `INSERT INTO email_campaigns
       (id, business_id, user_id, subject, sender_name, reply_to, recipients, content, link,
        asset_id, asset_name, asset_mime,
        total_recipients, sent_count, failed_count, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'PENDING', ?, ?)
     ON CONFLICT(business_id) WHERE status IN ('PENDING', 'PROCESSING', 'PAUSED') DO NOTHING`,
  )
    .bind(
      id,
      businessId,
      user.id,
      input.subject,
      input.senderName,
      replyTo,
      JSON.stringify(sendable),
      input.content,
      input.link ?? null,
      asset?.id ?? null,
      asset?.name ?? null,
      asset?.mime ?? null,
      count,
      now,
      now,
    )
    .run();

  if (Number(inserted.meta.changes ?? 0) === 0) {
    // A concurrent request won the active-campaign race — hand the
    // reservations back before reporting the conflict.
    await refundReservations();
    return errorResponse('An email campaign is already in progress. Wait for it to finish.', 409);
  }

  await writeAuditLog(env, {
    businessId,
    userId: user.id,
    action: 'email.broadcast.started',
    entityType: 'email_campaign',
    entityId: id,
    metadata: { recipients: count, suppressed, subject: input.subject },
  });

  // Delivery runs in a Durable Object alarm round: the request answers 202
  // immediately instead of holding the connection open for the whole send.
  await env.EMAIL_SENDER.getByName(id).schedule(id);

  const sentThisMonth = await readUsage(env, user.id);

  return jsonResponse(
    {
      success: true,
      campaign: {
        id,
        subject: input.subject,
        senderName: input.senderName,
        replyTo,
        totalRecipients: count,
        sent: 0,
        failed: 0,
        status: 'PENDING',
        lastError: null,
        createdAt: now,
      },
      usage: {
        sentThisMonth,
        monthlyLimit: limits.monthly,
        remaining: Math.max(0, limits.monthly - sentThisMonth),
        suppressed,
      },
    },
    202,
  );
}

type CampaignRow = {
  id: string;
  subject: string;
  sender_name: string | null;
  asset_name: string | null;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  status: string;
  last_error: string | null;
  created_at: string;
};

/**
 * Public one-click unsubscribe: the HMAC in `s` proves the address came from
 * one of our emails, so the endpoint needs no session. Always idempotent —
 * clicking twice just re-confirms the suppression row.
 */
async function handleUnsubscribe(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const email = (url.searchParams.get('e') ?? '').trim().toLowerCase();
  const signature = url.searchParams.get('s') ?? '';

  const valid = email.includes('@') && (await verifyUnsubscribe(env, email, signature));
  if (!valid) {
    return new Response('Lien de désabonnement invalide.', {
      status: 400,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  await addSuppression(env, email, 'unsubscribe');

  const escaped = email
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  return new Response(
    '<!doctype html><html lang="fr"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Désabonnement</title></head>' +
      '<body style="font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#f9fafb">' +
      '<div style="text-align:center;padding:24px"><h1 style="font-size:20px">Vous êtes désabonné</h1>' +
      `<p style="color:#6b7280">${escaped} ne recevra plus d'e-mails marketing de notre part.</p>` +
      '</div></body></html>',
    { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

/** Magic-byte check so an HTML/EXE renamed to .png/.pdf is rejected at upload. */
function matchesDeclaredMime(bytes: Uint8Array, declared: string): boolean {
  if (declared === 'image/jpeg') return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (declared === 'image/png') {
    return bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  }
  if (declared === 'image/gif') {
    return bytes.length > 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38;
  }
  if (declared === 'application/pdf') {
    return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  }
  return false;
}

/**
 * Stores one campaign attachment in R2 and hands back the id the broadcast
 * references. Ownership lives in customMetadata so a later broadcast can
 * prove the object belongs to this business without a database row.
 */
async function handleAssetUpload(request: Request, env: Env, businessId: string): Promise<Response> {
  const input = emailAssetUploadSchema.parse(await request.json());

  const bytes = Buffer.from(input.dataBase64, 'base64');
  if (bytes.length === 0) return errorResponse('The attachment is empty.', 400);
  if (bytes.length > MAX_EMAIL_ASSET_BYTES) {
    return errorResponse('The attachment must be 8 MB or smaller.', 400);
  }
  if (!matchesDeclaredMime(bytes, input.mimeType)) {
    return errorResponse('The file content does not match its declared type.', 400);
  }

  const id = crypto.randomUUID();
  await env.CAMPAIGN_ASSETS.put(`email-assets/${id}`, bytes, {
    httpMetadata: { contentType: input.mimeType },
    customMetadata: { businessId, name: encodeURIComponent(input.name) },
  });

  return jsonResponse(
    { success: true, asset: { id, name: input.name, mime: input.mimeType, url: `${PUBLIC_ASSET_PATH}/${id}` } },
    201,
  );
}

async function handleBroadcastList(env: Env, businessId: string): Promise<Response> {
  const result = await env.DB.prepare(
    `SELECT id, subject, sender_name, asset_name, total_recipients, sent_count, failed_count, status, last_error, created_at
     FROM email_campaigns WHERE business_id = ? ORDER BY created_at DESC LIMIT 20`,
  )
    .bind(businessId)
    .all<CampaignRow>();

  const campaigns = (result.results ?? []).map((row) => ({
    id: row.id,
    subject: row.subject,
    senderName: row.sender_name ?? '',
    assetName: row.asset_name,
    totalRecipients: Number(row.total_recipients),
    sent: Number(row.sent_count),
    failed: Number(row.failed_count),
    status: row.status,
    lastError: row.last_error,
    createdAt: row.created_at,
  }));

  return jsonResponse({ success: true, campaigns });
}

/**
 * Serves attachment bytes back to mail scanners worldwide — fetched by
 * Gmail/Outlook proxies from inside the email itself, so it deliberately
 * lives outside both the auth layer and the TN geofence. Ids are random
 * UUIDs (unguessable), and the edge cache absorbs scanner refetches.
 */
export async function handleEmailAssetRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const match = /^\/api\/email-assets\/([0-9a-fA-F]{8}-[0-9a-fA-F-]{27})$/.exec(url.pathname);
  if (!match || request.method !== 'GET') return errorResponse('Route not found.', 404);

  const stored = await env.CAMPAIGN_ASSETS.get(`email-assets/${match[1].toLowerCase()}`);
  if (!stored) return errorResponse('Not found.', 404);

  return new Response(stored.body, {
    status: 200,
    headers: {
      'content-type': stored.httpMetadata?.contentType ?? 'application/octet-stream',
      'cache-control': 'public, max-age=3600',
    },
  });
}

export async function handleEmailRoute(request: Request, env: Env): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith(BASE_PATH)) return errorResponse('Route not found.', 404);

  try {
    // Unsubscribe is intentionally public (signed link, no session needed).
    if (path === UNSUBSCRIBE_PATH) {
      if (request.method !== 'GET') return errorResponse('Method not allowed.', 405);
      return await handleUnsubscribe(request, env);
    }

    const user = await getAuthenticatedUser(request, env);
    if (!user) return errorResponse('Authentication required.', 401);

    const businessId = await getPrimaryBusinessId(user.id, env);
    if (!businessId) return errorResponse('Create a business before using email campaigns.', 404);

    const access = await getBusinessAccess(env, businessId);
    if (!access.canManage) {
      return errorResponse('This account is read-only. Activate a plan from Billing to send broadcasts.', 403);
    }

    // Operator-controlled kill switch: status stays readable so the UI can
    // explain the disabled state, sends are rejected.
    const features = await getEffectiveFeatures(env, businessId);

    if (path === STATUS_PATH) {
      if (request.method !== 'GET') return errorResponse('Method not allowed.', 405);
      return await handleStatus(env, access, user, features.emailEnabled);
    }

    if (!features.emailEnabled) {
      return errorResponse('Email marketing is currently disabled by the platform administrator.', 403);
    }

    if (path === ASSET_PATH) {
      if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
      return await handleAssetUpload(request, env, businessId);
    }

    if (path === BROADCAST_PATH) {
      if (request.method === 'POST') return await handleBroadcastCreate(request, env, user, businessId, access);
      if (request.method === 'GET') return await handleBroadcastList(env, businessId);
      return errorResponse('Method not allowed.', 405);
    }

    return errorResponse('Route not found.', 404);
  } catch (error) {
    if (error instanceof z.ZodError) return errorResponse('Validation failed.', 400, error.flatten());
    console.error('Email route failed.', error);
    return errorResponse('Email route failed.', 500);
  }
}
