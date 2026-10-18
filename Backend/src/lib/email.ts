/**
 * Email provider clients for email broadcast marketing.
 *
 * Active provider: Mailjet (`EMAIL_PROVIDER`, default 'mailjet'). Free tier:
 * 200 emails/day, 6,000/month (UTC reset) — plan quotas in
 * `subscription-limits.ts` are capped to that ceiling, a global monthly soft
 * cap protects the account across tenants, and a daily marketing reserve
 * (default 190) keeps headroom for transactional mail (password resets).
 * Each recipient is one provider POST (up to EMAIL_BATCH_SIZE per alarm
 * round, SEND_CONCURRENCY in flight), so a rejected address costs only
 * itself. Mailjet queues silently past the daily limit instead of erroring,
 * so the reservation caps are the real guardrail; the quota classification
 * below is the defensive path for providers that do reject.
 *
 * Dormant providers kept for later use: 'brevo' (BREVO_API_KEY) and
 * 'resend' (RESEND_API_KEY, needs a verified domain) — selected through
 * EMAIL_PROVIDER.
 *
 * Delivery runs one chunk per Durable Object alarm round
 * (`processEmailBatch`), never inside the HTTP request that accepts the
 * campaign: a 1,000-recipient broadcast would otherwise hold the request
 * open for minutes, and a client disconnect would strand the campaign row.
 *
 * Quota handling: a daily-limit response PAUSES the campaign — the
 * already-processed prefix is checkpointed in the same statement (those
 * sends really happened) and the Durable Object re-arms the alarm for the
 * next UTC midnight, leaving the rest of the chunk untouched. Auth failures
 * (401/403) settle the campaign and refund everything unsent.
 */
import type { Env } from '../types';

const MAILJET_SEND_URL = 'https://api.mailjet.com/v3.1/send';
const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';
const RESEND_SEND_URL = 'https://api.resend.com/emails';
const BATCH_SIZE = 100;
const SEND_CONCURRENCY = 5;
const RETRY_DELAY_MS = 1500;
const REQUEST_TIMEOUT_MS = 15_000;

/** Recipients handled per alarm round — one provider round-trip wave. */
export const EMAIL_BATCH_SIZE = BATCH_SIZE;
/** Alarm re-arm delay between rounds (delivery is asynchronous by design). */
export const EMAIL_PACE_MS = 600;

const DEFAULT_MARKETING_DAILY_CAP = 190;
const DEFAULT_MONTHLY_SOFT_CAP = 5800;
const DEFAULT_DAILY_LIMIT = 200;

export type EmailProvider = 'mailjet' | 'brevo' | 'resend';

export type EmailConfig = {
  provider: EmailProvider;
  apiKey: string;
  /** Mailjet authenticates with a key pair (Basic auth). */
  apiSecret?: string;
  fromEmail: string;
};

/** Missing provider keys → null: there is no sandbox sender to fall back to. */
export function getEmailConfig(env: {
  EMAIL_PROVIDER?: string;
  MAILJET_API_KEY?: string;
  MAILJET_API_SECRET?: string;
  BREVO_API_KEY?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
}): EmailConfig | null {
  const fromEmail = env.EMAIL_FROM;
  if (!fromEmail) return null;
  const provider: EmailProvider =
    env.EMAIL_PROVIDER === 'brevo' || env.EMAIL_PROVIDER === 'resend' ? env.EMAIL_PROVIDER : 'mailjet';
  if (provider === 'mailjet') {
    const apiKey = env.MAILJET_API_KEY;
    const apiSecret = env.MAILJET_API_SECRET;
    return apiKey && apiSecret ? { provider, apiKey, apiSecret, fromEmail } : null;
  }
  if (provider === 'brevo') {
    const apiKey = env.BREVO_API_KEY;
    return apiKey ? { provider, apiKey, fromEmail } : null;
  }
  const apiKey = env.RESEND_API_KEY;
  return apiKey ? { provider, apiKey, fromEmail } : null;
}

/** Marketing recipients allowed per UTC day; keeps ~10 slots for resets. */
export function getMarketingDailyCap(env: { EMAIL_MARKETING_DAILY_CAP?: string }): number {
  const parsed = Number(env.EMAIL_MARKETING_DAILY_CAP ?? DEFAULT_MARKETING_DAILY_CAP);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : DEFAULT_MARKETING_DAILY_CAP;
}

/** Account-wide monthly ceiling across all tenants (set very high to disable). */
export function getMonthlySoftCap(env: { EMAIL_MONTHLY_SOFT_CAP?: string }): number {
  const parsed = Number(env.EMAIL_MONTHLY_SOFT_CAP ?? DEFAULT_MONTHLY_SOFT_CAP);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : DEFAULT_MONTHLY_SOFT_CAP;
}

/** Daily quota ceiling shown in the dashboard (Mailjet free tier, env-overridable). */
export function getEmailDailyLimit(env: { EMAIL_DAILY_LIMIT?: string }): number {
  const parsed = Number(env.EMAIL_DAILY_LIMIT ?? DEFAULT_DAILY_LIMIT);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_DAILY_LIMIT;
}

/** `{ email, name }` for the provider `sender` field; hostile characters stripped. */
export function buildSender(fromEmail: string, senderName: string): { email: string; name: string } {
  const safeName = senderName.replace(/["\r\n<>\\]/g, '').trim();
  return { email: fromEmail, name: safeName || 'CampaignFlow' };
}

/** Replaces `{{name}}`, `{{email}}`, `{{link}}` and `{{unsubscribe}}` per recipient.
 * Recipient-derived values are HTML-escaped so a hostile row in a merchant's
 * contact list can't inject markup into every recipient's email (M3). The
 * merchant-authored `template` and the server-built `link`/`unsubscribe` URLs
 * are trusted and passed through verbatim. */
export function renderTemplate(
  template: string,
  values: { name?: string; email: string; link?: string; unsubscribe?: string },
): string {
  const esc = (value: string): string =>
    value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
  return template
    .replace(/\{\{\s*name\s*\}\}/g, esc(values.name ?? ''))
    .replace(/\{\{\s*email\s*\}\}/g, esc(values.email))
    .replace(/\{\{\s*link\s*\}\}/g, values.link ?? '')
    .replace(/\{\{\s*unsubscribe\s*\}\}/g, values.unsubscribe ?? '');
}

export type EmailRecipient = { email: string; name?: string };

/** Per-address HMAC proving an unsubscribe click came from one of our emails.
 * Fails closed (H1): a missing `GATEWAY_SECRET` yields no signature at all
 * rather than a publicly-known constant that anyone could forge. */
function hmacSecret(env: { GATEWAY_SECRET?: string }): string | null {
  return env.GATEWAY_SECRET || null;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Per-address HMAC proving an unsubscribe click came from one of our emails.
 * Returns `null` when `GATEWAY_SECRET` is unset (fail-closed — no forgeable default). */
export async function unsubscribeSignature(
  env: { GATEWAY_SECRET?: string },
  email: string,
): Promise<string | null> {
  const secret = hmacSecret(env);
  if (!secret) return null;
  return hmacHex(secret, `unsubscribe:${email.toLowerCase()}`);
}

export async function unsubscribeUrl(
  env: { GATEWAY_SECRET?: string; APP_ORIGIN?: string },
  email: string,
): Promise<string | null> {
  const normalized = email.toLowerCase();
  const signature = await unsubscribeSignature(env, normalized);
  if (!signature) return null;
  return `${env.APP_ORIGIN ?? ''}/api/email/unsubscribe?e=${encodeURIComponent(normalized)}&s=${signature}`;
}

export async function verifyUnsubscribe(
  env: { GATEWAY_SECRET?: string },
  email: string,
  signature: string,
): Promise<boolean> {
  if (!email || !signature) return false;
  const expected = await unsubscribeSignature(env, email);
  if (!expected) return false;
  return constantTimeEqual(expected, signature);
}

/** Footer appended to broadcasts that don't place `{{unsubscribe}}` themselves. */
export function unsubscribeFooter(url: string): string {
  return (
    '<div style="margin-top:20px;padding-top:12px;border-top:1px solid #e5e7eb;' +
    'font-size:12px;line-height:16px;color:#6b7280;text-align:center">' +
    `Vous recevez cet e-mail en tant que client de cet établissement. ` +
    `<a href="${url}" style="color:#6b7280;text-decoration:underline">Se désabonner</a></div>`
  );
}

function escapeHtml(value: string): string {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return value.replace(/[&<>"']/g, (char) => entities[char] ?? char);
}

/** Attachment filename stripped of path separators and control characters. */
function safeAssetName(name: string | null): string {
  const cleaned = [...(name ?? '')]
    .filter((char) => char.charCodeAt(0) >= 0x20 && !'<>:"/\\|?*'.includes(char))
    .join('')
    .trim();
  return cleaned.slice(0, 100) || 'attachment.pdf';
}

/** Removes recipients present in the suppression list (unsubscribes, bounces, complaints). */
export async function filterSuppressed(env: Env, recipients: EmailRecipient[]): Promise<EmailRecipient[]> {
  if (recipients.length === 0) return [];
  const kept: EmailRecipient[] = [];
  const CHUNK = 80;
  for (let i = 0; i < recipients.length; i += CHUNK) {
    const slice = recipients.slice(i, i + CHUNK);
    const placeholders = slice.map(() => '?').join(',');
    const rows = await env.DB.prepare(
      `SELECT email FROM email_suppression WHERE LOWER(email) IN (${placeholders})`,
    )
      .bind(...slice.map((recipient) => recipient.email.toLowerCase()))
      .all<{ email: string }>();
    const blocked = new Set((rows.results ?? []).map((row) => row.email.toLowerCase()));
    kept.push(...slice.filter((recipient) => !blocked.has(recipient.email.toLowerCase())));
  }
  return kept;
}

/** Adds the suppression row (idempotent). Returns true when newly inserted. */
export async function addSuppression(
  env: Env,
  email: string,
  reason: string,
  businessId?: string | null,
): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  const result = await env.DB.prepare(
    `INSERT INTO email_suppression (email, reason, business_id, created_at)
     VALUES (?, ?, ?, ?) ON CONFLICT(email) DO NOTHING`,
  )
    .bind(normalized, reason, businessId ?? null, new Date().toISOString())
    .run();
  return Number(result.meta.changes ?? 0) > 0;
}

/** Reserves `count` marketing recipients against today's cap. False = cap hit. */
export async function reserveDailyEmailQuota(
  env: Env,
  day: string,
  count: number,
  cap: number,
): Promise<boolean> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO email_daily_usage (day, reserved, updated_at) VALUES (?, 0, ?)
     ON CONFLICT(day) DO NOTHING`,
  )
    .bind(day, now)
    .run();
  const result = await env.DB.prepare(
    `UPDATE email_daily_usage SET reserved = reserved + ?, updated_at = ?
     WHERE day = ? AND reserved + ? <= ?`,
  )
    .bind(count, now, day, count, cap)
    .run();
  return Number(result.meta.changes ?? 0) > 0;
}

/** Hands back unsent reservations (settle paths) so tomorrow's cap is honest. */
export async function refundDailyEmailQuota(env: Env, day: string, amount: number): Promise<void> {
  if (amount <= 0) return;
  await env.DB.prepare(
    `UPDATE email_daily_usage SET reserved = max(0, reserved - ?), updated_at = ? WHERE day = ?`,
  )
    .bind(amount, new Date().toISOString(), day)
    .run();
}

/** Today's marketing reservation total (dashboard display). */
export async function readDailyReserved(env: Env, day: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT reserved FROM email_daily_usage WHERE day = ?`)
    .bind(day)
    .first<{ reserved: number }>();
  return Number(row?.reserved ?? 0);
}

export function currentUtcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Milliseconds until the next UTC midnight — the daily quota reset. */
export function msUntilUtcMidnight(): number {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(0, next - now.getTime());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function parseRecipients(json: string | null): EmailRecipient[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? (parsed as EmailRecipient[]) : [];
  } catch {
    return [];
  }
}

/** Emails already delivered today across all campaigns (dashboard quota display). */
export async function readDailyEmailUsage(env: Env, day: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(sent_count), 0) AS total FROM email_campaigns
     WHERE substr(created_at, 1, 10) = ?`,
  )
    .bind(day)
    .first<{ total: number }>();
  return Number(row?.total ?? 0);
}

/**
 * One-off transactional email (password reset, P1-6). Returns false when
 * the provider rejects the request or the call fails — callers treat that as a
 * hard failure and discard any state tied to the send.
 */
export async function sendPasswordResetEmail(
  config: EmailConfig,
  options: { to: string; resetUrl: string },
): Promise<boolean> {
  const text = [
    'Bonjour,',
    '',
    'Vous avez demandé la réinitialisation de votre mot de passe.',
    `Ouvrez ce lien pour choisir un nouveau mot de passe (valable 15 minutes) :`,
    options.resetUrl,
    '',
    "Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.",
  ].join('\n');

  const html = [
    '<p>Bonjour,</p>',
    '<p>Vous avez demandé la réinitialisation de votre mot de passe.</p>',
    `<p><a href="${options.resetUrl}">Réinitialiser mon mot de passe</a> (lien valable 15 minutes)</p>`,
    "<p>Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.</p>",
  ].join('');

  try {
    const result = await postEmail(config, {
      sender: { email: config.fromEmail, name: 'CampaignFlow' },
      to: { email: options.to },
      subject: 'Réinitialisez votre mot de passe',
      html,
      text,
    });
    return result.ok;
  } catch {
    return false;
  }
}

type PostResult =
  | { ok: true }
  | { ok: false; error: string; quota?: boolean; fatal?: boolean; retryable?: boolean };

/** Neutral wire format; each provider client maps it to its own payload. */
type OutboundEmail = {
  sender: { email: string; name?: string };
  to: { email: string; name?: string };
  subject: string;
  html: string;
  text?: string;
  attachment?: { name: string; content: string; mime: string } | null;
  /** Merchant address on the Reply-To header; empty state = header absent. */
  replyTo?: string;
  /** Brevo idempotency key / Mailjet CustomID (tracing only — not deduped). */
  customId?: string;
};

/** 401/403 fatal, limit-ish 400/429 = quota, 408/425/429/5xx retryable. */
function classifyHttpFailure(status: number, message: string): PostResult {
  if (status === 401 || status === 403) return { ok: false, error: message, fatal: true };
  // A free plan's daily limit surfaces as a 400/429 mentioning the limit.
  if ((status === 400 || status === 429) && /limit|quota|credit|exceed/i.test(message)) {
    return { ok: false, error: message, quota: true };
  }
  const retryable = status === 408 || status === 425 || status === 429 || status >= 500;
  return { ok: false, error: message, retryable };
}

/** Routes one outbound message through the configured provider. */
async function postEmail(config: EmailConfig, email: OutboundEmail): Promise<PostResult> {
  if (config.provider === 'mailjet') return postMailjetEmail(config, email);
  if (config.provider === 'brevo') return postBrevoEmail(config, email);
  return postResendEmail(config, email);
}

/** Best-effort error text from a Mailjet error body (shape varies by status). */
function mailjetErrorText(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const body = data as {
    Messages?: Array<{ Errors?: Array<{ ErrorMessage?: unknown }> }>;
    ErrorMessage?: unknown;
    errorMessage?: unknown;
    message?: unknown;
  };
  const nested = body.Messages?.[0]?.Errors?.[0]?.ErrorMessage;
  if (typeof nested === 'string' && nested) return nested;
  for (const value of [body.ErrorMessage, body.errorMessage, body.message]) {
    if (typeof value === 'string' && value) return value;
  }
  return null;
}

/**
 * Mailjet Send API v3.1 — one POST per recipient, Basic auth (key:secret).
 * Success is HTTP 200 with Messages[0].Status 'success'. The free plan's
 * daily limit never errors: Mailjet queues the excess (dropped after 3
 * days), so the reservation caps do the real limiting. 429 is the
 * per-minute API rate limit — retryable, not a quota.
 */
async function postMailjetEmail(config: EmailConfig, email: OutboundEmail): Promise<PostResult> {
  const message: Record<string, unknown> = {
    From: { Email: email.sender.email, ...(email.sender.name ? { Name: email.sender.name } : {}) },
    ...(email.replyTo ? { ReplyTo: email.replyTo } : {}),
    To: [email.to.name ? { Email: email.to.email, Name: email.to.name } : { Email: email.to.email }],
    Subject: email.subject,
    HTMLPart: email.html,
    ...(email.text ? { TextPart: email.text } : {}),
    ...(email.customId ? { CustomID: email.customId } : {}),
    ...(email.attachment
      ? {
          Attachments: [
            {
              ContentType: email.attachment.mime,
              Filename: email.attachment.name,
              Base64Content: email.attachment.content,
            },
          ],
        }
      : {}),
  };

  try {
    const auth = Buffer.from(`${config.apiKey}:${config.apiSecret ?? ''}`).toString('base64');
    const response = await fetch(MAILJET_SEND_URL, {
      method: 'POST',
      headers: {
        authorization: `Basic ${auth}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ Messages: [message] }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      // Non-JSON body — fall through to the status-only handling.
    }

    if (response.ok) {
      const status = (data as { Messages?: Array<{ Status?: string }> } | null)?.Messages?.[0]?.Status;
      // Mailjet can report a per-message rejection inside a 2xx as well.
      if (status && status !== 'success' && status !== 'sent') {
        return classifyHttpFailure(response.status, mailjetErrorText(data) ?? 'Mailjet rejected the message.');
      }
      return { ok: true };
    }

    return classifyHttpFailure(
      response.status,
      mailjetErrorText(data) ?? `Mailjet API responded with ${response.status}.`,
    );
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : 'Request failed.', retryable: true };
  }
}

/** Dormant (EMAIL_PROVIDER='brevo'). One Brevo POST per recipient. */
async function postBrevoEmail(config: EmailConfig, email: OutboundEmail): Promise<PostResult> {
  try {
    const response = await fetch(BREVO_SEND_URL, {
      method: 'POST',
      headers: {
        'api-key': config.apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: { email: email.sender.email, name: email.sender.name ?? '' },
        ...(email.replyTo ? { replyTo: { email: email.replyTo } } : {}),
        to: [{ email: email.to.email, ...(email.to.name ? { name: email.to.name } : {}) }],
        subject: email.subject,
        htmlContent: email.html,
        ...(email.text ? { textContent: email.text } : {}),
        ...(email.customId ? { headers: { idempotencyKey: email.customId } } : {}),
        ...(email.attachment
          ? { attachment: [{ name: email.attachment.name, content: email.attachment.content }] }
          : {}),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.ok) return { ok: true };

    let errorText = `Brevo API responded with ${response.status}.`;
    try {
      const data = (await response.json()) as { message?: unknown };
      if (typeof data.message === 'string' && data.message) errorText = data.message;
    } catch {
      // Non-JSON error body — keep the status message.
    }
    return classifyHttpFailure(response.status, errorText);
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : 'Request failed.', retryable: true };
  }
}

/**
 * Dormant (EMAIL_PROVIDER='resend'). The free tier only accepts verified
 * senders, so this activates later with RESEND_API_KEY; kept for the day a
 * domain exists and Brevo/Mailjet are no longer wanted.
 */
async function postResendEmail(config: EmailConfig, email: OutboundEmail): Promise<PostResult> {
  try {
    const response = await fetch(RESEND_SEND_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: `${email.sender.name || 'CampaignFlow'} <${email.sender.email}>`,
        ...(email.replyTo ? { reply_to: email.replyTo } : {}),
        to: [email.to.email],
        subject: email.subject,
        html: email.html,
        ...(email.text ? { text: email.text } : {}),
        ...(email.attachment
          ? {
              attachments: [
                {
                  filename: email.attachment.name,
                  content: email.attachment.content,
                  content_type: email.attachment.mime,
                },
              ],
            }
          : {}),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.ok) return { ok: true };

    let errorText = `Resend API responded with ${response.status}.`;
    try {
      const data = (await response.json()) as { message?: unknown };
      if (typeof data.message === 'string' && data.message) errorText = data.message;
    } catch {
      // Non-JSON error body — keep the status message.
    }
    return classifyHttpFailure(response.status, errorText);
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : 'Request failed.', retryable: true };
  }
}

type EmailCampaignRow = {
  id: string;
  user_id: string;
  subject: string;
  sender_name: string | null;
  recipients: string | null;
  content: string | null;
  link: string | null;
  asset_id: string | null;
  asset_name: string | null;
  asset_mime: string | null;
  reply_to: string | null;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  status: string;
  created_at: string;
};

/** Refunds the monthly reservation; skipped when the month rolled over. */
async function refundEmailQuota(env: Env, userId: string, refund: number): Promise<void> {
  if (refund <= 0) return;
  await env.DB.prepare(
    `UPDATE users
     SET email_messages_sent_this_month = max(0, email_messages_sent_this_month - ?)
     WHERE id = ? AND substr(COALESCE(email_reset_date, ''), 1, 7) = ?`,
  )
    .bind(refund, userId, currentMonth())
    .run();
}

/**
 * One guarded status transition so the quota refunds (monthly per-user +
 * daily per-campaign-day) can only fire once.
 */
async function settleEmailCampaign(
  env: Env,
  campaign: EmailCampaignRow,
  status: 'COMPLETED' | 'FAILED',
  sent: number,
  failed: number,
  error: string | null,
  refund: number,
): Promise<void> {
  const result = await env.DB.prepare(
    `UPDATE email_campaigns
     SET status = ?, sent_count = ?, failed_count = ?, last_error = ?, updated_at = ?
     WHERE id = ? AND status NOT IN ('COMPLETED', 'FAILED')`,
  )
    .bind(status, sent, failed, error, new Date().toISOString(), campaign.id)
    .run();

  if (Number(result.meta.changes ?? 0) > 0) {
    await refundEmailQuota(env, campaign.user_id, refund);
    await refundDailyEmailQuota(env, campaign.created_at.slice(0, 10), refund);
  }
}

/**
 * Settles a campaign whose sender died mid-flight (alarm exhausted its
 * retries, worker restarted). Delivered emails keep their reservation,
 * everything unsent is refunded, at most once.
 */
export async function settleInterruptedEmailCampaign(env: Env, campaignId: string, reason: string): Promise<void> {
  const campaign = await env.DB.prepare(
    `SELECT id, user_id, subject, sender_name, recipients, content, link,
            asset_id, asset_name, asset_mime, reply_to,
            total_recipients, sent_count, failed_count, status, created_at
     FROM email_campaigns WHERE id = ? LIMIT 1`,
  )
    .bind(campaignId)
    .first<EmailCampaignRow>();

  if (!campaign) return;
  if (campaign.status === 'COMPLETED' || campaign.status === 'FAILED') return;

  await settleEmailCampaign(
    env,
    campaign,
    'FAILED',
    campaign.sent_count,
    campaign.failed_count,
    reason,
    Math.max(0, campaign.total_recipients - campaign.sent_count),
  );
}

export type EmailBatchOutcome = 'continue' | 'completed' | 'failed' | 'paused';

const DAILY_PAUSE_ERROR = 'Daily email quota reached — paused until 00:00 UTC.';

/**
 * Processes the next chunk of a campaign: sends up to EMAIL_BATCH_SIZE
 * emails (suppressed addresses dropped first), one provider POST per recipient
 * with SEND_CONCURRENCY in flight, checkpoints progress, then either asks
 * for another alarm round ('continue'), pauses until the next UTC midnight
 * ('paused' — the processed prefix is persisted first, the rest of the chunk
 * stays untouched), or settles the campaign (COMPLETED when at least one
 * email landed, refunding failed sends; FAILED on fatal errors, refunding
 * everything unsent). Exported so tests can drive rounds without a
 * Durable Object alarm.
 */
export async function processEmailBatch(env: Env, campaignId: string): Promise<EmailBatchOutcome> {
  const campaign = await env.DB.prepare(
    `SELECT id, user_id, subject, sender_name, recipients, content, link,
            asset_id, asset_name, asset_mime, reply_to,
            total_recipients, sent_count, failed_count, status, created_at
     FROM email_campaigns WHERE id = ? LIMIT 1`,
  )
    .bind(campaignId)
    .first<EmailCampaignRow>();

  if (!campaign) return 'failed';
  if (campaign.status === 'COMPLETED' || campaign.status === 'FAILED') return 'failed';

  if (campaign.status === 'PENDING' || campaign.status === 'PAUSED') {
    await env.DB.prepare(
      `UPDATE email_campaigns SET status = 'PROCESSING', updated_at = ?
       WHERE id = ? AND status IN ('PENDING', 'PAUSED')`,
    )
      .bind(new Date().toISOString(), campaignId)
    .run();
  }

  const recipients = parseRecipients(campaign.recipients);
  let sent = campaign.sent_count;
  let failed = campaign.failed_count;
  const cursor = sent + failed;

  if (recipients.length === 0 || cursor >= recipients.length) {
    // Nothing left to send — refund any reservation still held for undelivered
    // messages (also covers a corrupt recipients payload).
    await settleEmailCampaign(
      env,
      campaign,
      sent > 0 ? 'COMPLETED' : 'FAILED',
      sent,
      failed,
      sent > 0 ? null : 'No recipients to send to.',
      Math.max(0, campaign.total_recipients - sent),
    );
    return 'completed';
  }

  const config = getEmailConfig(env);
  if (!config) {
    await settleEmailCampaign(
      env,
      campaign,
      'FAILED',
      sent,
      failed,
      'Email is not configured.',
      Math.max(0, campaign.total_recipients - sent),
    );
    return 'failed';
  }

  const chunk = recipients.slice(cursor, cursor + EMAIL_BATCH_SIZE);
  const chunkIndex = Math.floor(cursor / EMAIL_BATCH_SIZE);
  const sender = buildSender(config.fromEmail, campaign.sender_name ?? '');

  // Attachment bytes (PDF) are read once per round; images are referenced by
  // absolute URL so each mail client fetches them directly from R2.
  const isImageAsset = Boolean(campaign.asset_id) && (campaign.asset_mime ?? '').startsWith('image/');
  const imageHtml =
    isImageAsset && campaign.asset_id
      ? `<p style="margin:16px 0"><img src="${env.APP_ORIGIN ?? ''}/api/email-assets/${campaign.asset_id}"` +
        ` alt="${escapeHtml(campaign.asset_name ?? '')}" style="max-width:100%;height:auto;border-radius:8px"></p>`
      : '';

  let attachment: { name: string; content: string; mime: string } | null = null;
  if (campaign.asset_id && campaign.asset_mime === 'application/pdf') {
    try {
      const stored = await env.CAMPAIGN_ASSETS.get(`email-assets/${campaign.asset_id}`);
      if (stored) {
        const bytes = Buffer.from(await stored.arrayBuffer());
        attachment = {
          name: safeAssetName(campaign.asset_name),
          content: bytes.toString('base64'),
          mime: campaign.asset_mime,
        };
      }
    } catch (error) {
      // Degrade to a text-only send rather than stranding the campaign on R2.
      console.error('Email campaign asset could not be read.', error);
    }
  }

  // Suppression wins over everything: unsubscribes/bounces never reach the provider.
  const allowed = await filterSuppressed(env, chunk);
  const allowedSet = new Set(allowed.map((recipient) => recipient.email.toLowerCase()));

  type Slot =
    | { kind: 'sent' }
    | { kind: 'failed'; error: string }
    | { kind: 'suppressed' }
    | { kind: 'quota'; error: string }
    | { kind: 'fatal'; error: string }
    | null;
  const slots: Slot[] = chunk.map((recipient) =>
    allowedSet.has(recipient.email.toLowerCase()) ? null : { kind: 'suppressed' },
  );

  const sendSlot = async (index: number): Promise<void> => {
    const recipient = chunk[index];
    const unsubscribe = await unsubscribeUrl(env, recipient.email);
    if (!unsubscribe) {
      // Fail closed (H1): without GATEWAY_SECRET we cannot mint a verifiable
      // unsubscribe link, so the send is refused rather than shipping a
      // non-compliant email with a forgeable/absent opt-out.
      slots[index] = { kind: 'fatal', error: 'Unsubscribe links are not configured.' };
      return;
    }
    const values = {
      name: recipient.name,
      email: recipient.email,
      link: campaign.link ?? undefined,
      unsubscribe,
    };
    let html = renderTemplate(campaign.content ?? '', values);
    if (imageHtml) html += imageHtml;
    if (!(campaign.content ?? '').includes('{{unsubscribe}}')) html += unsubscribeFooter(unsubscribe);

    const outbound: OutboundEmail = {
      sender,
      to: { email: recipient.email, ...(recipient.name ? { name: recipient.name } : {}) },
      subject: renderTemplate(campaign.subject, values),
      html,
      attachment,
      ...(campaign.reply_to ? { replyTo: campaign.reply_to } : {}),
      customId: `${campaign.id}/${chunkIndex}/${recipient.email}`,
    };

    let result = await postEmail(config, outbound);
    if (!result.ok && result.retryable) {
      await sleep(RETRY_DELAY_MS);
      result = await postEmail(config, outbound);
    }
    if (result.ok) slots[index] = { kind: 'sent' };
    else if (result.quota) slots[index] = { kind: 'quota', error: result.error };
    else if (result.fatal) slots[index] = { kind: 'fatal', error: result.error };
    else slots[index] = { kind: 'failed', error: result.error };
  };

  const pending: number[] = [];
  for (let index = 0; index < slots.length; index += 1) if (slots[index] === null) pending.push(index);

  let nextJob = 0;
  let stopDispatch = false;
  const runWorker = async (): Promise<void> => {
    while (!stopDispatch && nextJob < pending.length) {
      const index = pending[nextJob];
      nextJob += 1;
      try {
        await sendSlot(index);
      } catch (error) {
        slots[index] = { kind: 'failed', error: error instanceof Error ? error.message : 'Request failed.' };
      }
      const slot = slots[index];
      if (slot?.kind === 'quota' || slot?.kind === 'fatal') stopDispatch = true;
    }
  };
  await Promise.all(Array.from({ length: Math.min(SEND_CONCURRENCY, pending.length) }, () => runWorker()));

  // Consume the longest processed prefix. Anything past a quota/fatal slot
  // (or never dispatched) stays unsent — recipients after it may have been
  // sent already, but the per-recipient customId traces (Brevo: dedupes) a
  // replay, and Mailjet at worst duplicates only that recipient.
  let roundSent = 0;
  let roundFailed = 0;
  let processed = 0;
  let roundError: string | null = null;
  let quotaError: string | null = null;
  let fatalError: string | null = null;
  for (const slot of slots) {
    if (slot?.kind === 'sent') {
      roundSent += 1;
      processed += 1;
      continue;
    }
    if (slot?.kind === 'failed') {
      roundFailed += 1;
      processed += 1;
      roundError = slot.error;
      continue;
    }
    if (slot?.kind === 'suppressed') {
      roundFailed += 1;
      processed += 1;
      continue;
    }
    if (slot?.kind === 'quota') {
      quotaError = slot.error;
      break;
    }
    if (slot?.kind === 'fatal') {
      fatalError = slot.error;
      break;
    }
    break;
  }

  sent += roundSent;
  failed += roundFailed;

  let lastError: string | null = roundError;
  if (!lastError && roundSent === 0 && roundFailed > 0) {
    lastError = 'All recipients in this batch are suppressed (unsubscribed or bounced).';
  }

  // Daily quota: checkpoint the prefix and pause in ONE statement — the
  // sends above really happened, a resume after midnight must not replay
  // them, and the rest of the chunk must stay untouched.
  if (quotaError !== null) {
    await env.DB.prepare(
      `UPDATE email_campaigns
       SET status = 'PAUSED', sent_count = ?, failed_count = ?, last_error = ?, updated_at = ?
       WHERE id = ? AND status NOT IN ('COMPLETED', 'FAILED')`,
    )
      .bind(sent, failed, DAILY_PAUSE_ERROR, new Date().toISOString(), campaignId)
      .run();
    return 'paused';
  }

  if (fatalError !== null) {
    // The rest of the list can never be delivered either.
    failed += chunk.length - processed;
    failed += Math.max(0, recipients.length - cursor - chunk.length);
    lastError = fatalError;
  }

  // Checkpoint after every round: a crash replays at most the current chunk
  // (per-recipient customId marks the replay), and refreshed updated_at keeps
  // the cron reconciler away from live campaigns.
  await env.DB.prepare(
    `UPDATE email_campaigns
     SET sent_count = ?, failed_count = ?, last_error = ?, updated_at = ?
     WHERE id = ? AND status NOT IN ('COMPLETED', 'FAILED')`,
  )
    .bind(sent, failed, lastError, new Date().toISOString(), campaignId)
    .run();

  const refund = Math.max(0, campaign.total_recipients - sent);

  if (fatalError !== null) {
    await settleEmailCampaign(env, campaign, sent > 0 ? 'COMPLETED' : 'FAILED', sent, failed, lastError, refund);
    return 'failed';
  }

  if (sent + failed >= recipients.length) {
    await settleEmailCampaign(env, campaign, sent > 0 ? 'COMPLETED' : 'FAILED', sent, failed, lastError, refund);
    return 'completed';
  }

  return 'continue';
}
