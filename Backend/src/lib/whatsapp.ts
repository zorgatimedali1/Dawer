import type { WhatsAppPacingGate } from '../durable/pacing-gate';
import type { Env } from '../types';

/**
 * Tunisia has no online payment, so every purchase is settled over WhatsApp
 * with the SaaS owner. The number lives here so the merchant Worker and the
 * operator Worker cannot drift apart.
 */
export const SUPPORT_WHATSAPP_NUMBER = '21699744593';

type SubscriptionWhatsAppDetails = {
  reference: string;
  planName: string;
  priceCents: number;
  interval: string;
  businessName: string;
};

const PERIOD_LABELS: Record<string, string> = {
  year: 'an',
  '2_years': '2 ans',
  '3_years': '3 ans',
  '3_months': '3 mois',
};

export function buildSubscriptionWhatsAppUrl(details: SubscriptionWhatsAppDetails): Response {
  const amount = (details.priceCents / 100).toFixed(details.priceCents % 100 === 0 ? 0 : 2);
  const period = PERIOD_LABELS[details.interval] ?? '3 mois';
  const message = [
    'Bonjour, je souhaite activer un abonnement CampaignFlow.',
    `Espace : ${details.businessName}`,
    `Plan : ${details.planName} (${amount} DT/${period})`,
    `Référence : ${details.reference}`,
    'Merci de me confirmer le règlement.',
  ].join('\n');

  return `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

/* ---------------------------------------------------------------------------
 * Meta WhatsApp Cloud API client for broadcast marketing.
 * ------------------------------------------------------------------------- */

const GRAPH_BASE = 'https://graph.facebook.com/v20.0';
const REQUEST_TIMEOUT_MS = 10_000;
/** 429/5xx/network failures are retried; client errors fail fast. */
const MAX_SEND_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [250, 500];

export type WhatsAppPace = 'fast' | 'standard' | 'relaxed';

/** Per-recipient pacing presets stored on the campaign (fast/standard/relaxed). */
export const PACE_DELAY_MS: Record<WhatsAppPace, number> = {
  fast: 150,
  standard: 900,
  relaxed: 3000,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type WhatsAppConfig = { token: string; phoneId: string };

export function getWhatsAppConfig(env: { WHATSAPP_TOKEN?: string; WHATSAPP_PHONE_ID?: string }): WhatsAppConfig | null {
  const token = env.WHATSAPP_TOKEN;
  const phoneId = env.WHATSAPP_PHONE_ID;
  return token && phoneId ? { token, phoneId } : null;
}

/**
 * Pacing + circuit breaker namespace for the configured sending number.
 * Namespacing by phone id keeps a future second WABA from sharing — or
 * resetting — another number's gate state; unconfigured envs fall back to
 * the legacy name.
 */
export function pacingGateFor(env: Env): DurableObjectStub<WhatsAppPacingGate> {
  const config = getWhatsAppConfig(env);
  return env.WHATSAPP_PACING.getByName(config ? `gate:${config.phoneId}` : 'platform');
}

/**
 * Best-effort E.164 digits with no symbols: strips separators and a leading
 * `00`, then maps local Tunisian forms (`22345678`, `022345678`) onto
 * `216XXXXXXXX`. Anything outside 8–15 digits is rejected.
 */
export function normalizePhone(raw: string): string | null {
  let digits = raw.replace(/[^0-9]/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0') && digits.length === 9) digits = digits.slice(1);
  if (digits.length === 8) digits = `216${digits}`;
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

export type TemplateMessageResult = {
  ok: boolean;
  status?: number;
  error?: string;
  /** Meta rejected the credentials — the whole broadcast should stop. */
  authFailed?: boolean;
  /** Meta's numeric error code when the body carried one. */
  errorCode?: number;
  /**
   * Meta rejected the message template itself (deleted/unapproved) — every
   * remaining recipient would fail the same way, so the broadcast stops.
   */
  templateBlocked?: boolean;
  /** Present on an exhausted 429: how long the platform circuit should hold. */
  retryAfterMs?: number;
  /** Meta's wamid — logged so webhook status callbacks can be matched back. */
  messageId?: string;
};

/** Error codes that mean the template is dead for every recipient. */
const TEMPLATE_BLOCKED_CODES = new Set([131026, 131047]);

function retryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function retryDelayMs(attempt: number, response: Response | null): number {
  const base = RETRY_BACKOFF_MS[attempt] ?? 500;
  const retryAfter = Number(response?.headers.get('retry-after') ?? 0);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(5_000, Math.max(base, retryAfter * 1000));
  }
  return base;
}

/**
 * Sends one template message, retrying up to two extra times on 429/5xx and
 * network failures (honouring Retry-After). Auth and validation errors fail
 * immediately — retrying them would only waste the campaign round.
 */
export async function sendTemplateMessage(
  env: { WHATSAPP_TOKEN?: string; WHATSAPP_PHONE_ID?: string },
  params: { to: string; templateName: string; language: string; variables: string[] },
): Promise<TemplateMessageResult> {
  const config = getWhatsAppConfig(env);
  if (!config) return { ok: false, error: 'WhatsApp is not configured.' };

  let lastStatus: number | undefined;
  let lastError = 'Send failed.';
  let lastResponse: Response | null = null;
  let lastRetryAfterMs: number | undefined;

  for (let attempt = 0; attempt < MAX_SEND_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await sleep(retryDelayMs(attempt - 1, lastResponse));

    try {
      const response = await fetch(`${GRAPH_BASE}/${config.phoneId}/messages`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          messaging_type: 'TEMPLATE',
          type: 'template',
          to: params.to,
          template: {
            name: params.templateName,
            language: { code: params.language },
            ...(params.variables.length > 0
              ? {
                  components: [
                    {
                      type: 'body',
                      parameters: params.variables.map((text) => ({ type: 'text', text })),
                    },
                  ],
                }
              : {}),
          },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.ok) {
        let messageId: string | undefined;
        try {
          const data = (await response.json()) as { messages?: Array<{ id?: string }> };
          messageId = data.messages?.[0]?.id;
        } catch {
          // Empty or non-JSON body — the send still succeeded.
        }
        return { ok: true, status: response.status, ...(messageId ? { messageId } : {}) };
      }

      lastStatus = response.status;
      lastResponse = response;
      lastError = `Meta API responded with ${response.status}.`;
      const retryAfter = Number(response.headers.get('retry-after') ?? 0);
      if (response.status === 429 && Number.isFinite(retryAfter) && retryAfter > 0) {
        lastRetryAfterMs = Math.min(120_000, retryAfter * 1000);
      }
      if (response.status === 401 || response.status === 403) {
        return { ok: false, status: response.status, authFailed: true, error: lastError };
      }
      if (!retryable(response.status)) {
        // Non-retryable client error: surface Meta's numeric error code so
        // callers can tell a dead template (stops the whole broadcast) from a
        // per-recipient problem (keep going).
        let errorCode: number | undefined;
        try {
          const body = (await response.json()) as { error?: { code?: number } };
          if (typeof body.error?.code === 'number') errorCode = body.error.code;
        } catch {
          // Empty or non-JSON body — the status alone has to do.
        }
        const templateBlocked = errorCode !== undefined && TEMPLATE_BLOCKED_CODES.has(errorCode);
        return {
          ok: false,
          status: response.status,
          ...(errorCode !== undefined
            ? { errorCode, error: `Meta API responded with ${response.status} (code ${errorCode}).` }
            : { error: lastError }),
          ...(templateBlocked ? { templateBlocked: true } : {}),
        };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Request failed.';
      lastResponse = null;
    }
  }

  return {
    ok: false,
    ...(lastStatus !== undefined ? { status: lastStatus } : {}),
    ...(lastStatus === 429 && lastRetryAfterMs !== undefined ? { retryAfterMs: lastRetryAfterMs } : {}),
    error: lastError,
  };
}

export type WhatsAppTemplate = { name: string; language: string; status: string; body?: string };

type TemplateCache = { at: number; phoneId: string; templates: WhatsAppTemplate[] };

const TEMPLATE_CACHE_MS = 5 * 60_000;
let templateCache: TemplateCache | null = null;

/** Tests reset the module-level template cache between cases. */
export function clearWhatsAppTemplateCache(): void {
  templateCache = null;
}

/** Approved templates from Meta, cached for five minutes per isolate. */
export async function fetchApprovedTemplates(
  env: { WHATSAPP_TOKEN?: string; WHATSAPP_PHONE_ID?: string },
): Promise<WhatsAppTemplate[]> {
  const config = getWhatsAppConfig(env);
  if (!config) throw new Error('WhatsApp is not configured.');

  const now = Date.now();
  if (templateCache && templateCache.phoneId === config.phoneId && now - templateCache.at < TEMPLATE_CACHE_MS) {
    return templateCache.templates;
  }

  const response = await fetch(
    `${GRAPH_BASE}/${config.phoneId}/message_templates?status=APPROVED&limit=100`,
    {
      headers: { authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );

  if (!response.ok) throw new Error(`Meta API responded with ${response.status}.`);

  const data = (await response.json()) as {
    data?: Array<{
      name?: string;
      language?: string;
      status?: string;
      components?: Array<{ type?: string; text?: string }>;
    }>;
  };
  const templates = (data.data ?? [])
    .filter((entry) => typeof entry.name === 'string' && typeof entry.language === 'string')
    .map((entry) => {
      const bodyText = (entry.components ?? []).find(
        (component) => component.type === 'BODY' && typeof component.text === 'string' && component.text.trim() !== '',
      )?.text;
      return {
        name: entry.name as string,
        language: entry.language as string,
        status: entry.status ?? 'APPROVED',
        ...(bodyText ? { body: bodyText } : {}),
      };
    });

  templateCache = { at: now, phoneId: config.phoneId, templates };
  return templates;
}
