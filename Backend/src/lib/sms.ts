import type { Env } from '../types';
import { normalizePhone } from './whatsapp';

export { normalizePhone };

/* ---------------------------------------------------------------------------
 * SMS-Gate 3rd-party API client for broadcast marketing.
 * ------------------------------------------------------------------------- */

/** Default cloud endpoint of the SMS-Gate 3rd-party API. */
export const DEFAULT_SMS_GATEWAY_BASE_URL = 'https://api.sms-gate.app/3rdparty/v1';

/** Per-recipient default copy; `{name}` / `{prize}` are replaced per send. */
export const DEFAULT_SMS_MESSAGE = 'Bonjour {name} ! Votre récompense vous attend : {prize}. Rendez-vous chez nous. Merci !';

/** Hard ceiling for composed campaign messages (concatenated-segment budget). */
export const SMS_MAX_MESSAGE_CHARS = 320;

/** Events registered on the gateway so callbacks hit our webhook endpoint. */
export const SMS_WEBHOOK_EVENTS = [
  'sms:sent',
  'sms:delivered',
  'sms:failed',
  'sms:cancelled',
  'sms:received',
  'system:ping',
] as const;

export type SmsWebhookEvent = (typeof SMS_WEBHOOK_EVENTS)[number];

const REQUEST_TIMEOUT_MS = 15_000;
/** 429/5xx/network failures are retried; client errors fail fast. */
const MAX_SEND_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [250, 500];
const RETRY_AFTER_CAP_MS = 30_000;

export interface SmsGatewayConfig {
  baseUrl: string;
  user: string;
  password: string;
  configured: boolean;
}

export function getSmsGatewayConfig(env: Env): SmsGatewayConfig {
  const baseUrl = (env.SMS_GATEWAY_URL?.trim() || DEFAULT_SMS_GATEWAY_BASE_URL).replace(/\/+$/, '');
  const user = env.SMS_GATEWAY_USER?.trim() ?? '';
  const password = env.SMS_GATEWAY_PASSWORD?.trim() ?? '';
  return { baseUrl, user, password, configured: Boolean(baseUrl && user && password) };
}

export function authHeader(config: SmsGatewayConfig): string {
  return `Basic ${btoa(`${config.user}:${config.password}`)}`;
}

export type SmsSendResult = {
  ok: boolean;
  status?: number;
  /** Gateway error code when the body carried one. */
  errorCode?: string | number;
  retryable?: boolean;
  /** Gateway rejected the credentials — the whole broadcast should stop. */
  authFailed?: boolean;
  /** Gateway message id — logged so webhook status callbacks can be matched back. */
  messageId?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function retryDelayMs(attempt: number, response: Response | null): number {
  const base = RETRY_BACKOFF_MS[attempt] ?? 500;
  const retryAfter = Number(response?.headers.get('retry-after') ?? 0);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(RETRY_AFTER_CAP_MS, Math.max(base, retryAfter * 1000));
  }
  return base;
}

/**
 * Sends one SMS, retrying up to two extra times on 429/5xx and network
 * failures (honouring Retry-After, capped at 30 s). Auth and validation
 * errors fail immediately — retrying them would only waste the campaign
 * round. Never throws.
 */
export async function sendSmsMessage(
  env: Env,
  config: SmsGatewayConfig,
  text: string,
  phone: string,
): Promise<SmsSendResult> {
  let lastStatus: number | undefined;
  let lastErrorCode: string | number | undefined;
  let lastRetryable: boolean | undefined;
  let delayMs = 0;

  for (let attempt = 0; attempt < MAX_SEND_ATTEMPTS; attempt += 1) {
    if (delayMs > 0) await sleep(delayMs);
    try {
      const response = await fetch(`${config.baseUrl}/message`, {
        method: 'POST',
        headers: { Authorization: authHeader(config), 'Content-Type': 'application/json' },
        body: JSON.stringify({ textMessage: { text }, phoneNumbers: [phone] }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      const body = (await response.json().catch(() => null)) as {
        id?: unknown;
        code?: unknown;
        errorCode?: unknown;
      } | null;

      if (response.ok) {
        return { ok: true, messageId: typeof body?.id === 'string' ? body.id : undefined };
      }

      if (typeof body?.code === 'string' || typeof body?.code === 'number') lastErrorCode = body.code;
      else if (typeof body?.errorCode === 'string' || typeof body?.errorCode === 'number') lastErrorCode = body.errorCode;

      if (response.status === 401 || response.status === 403) {
        return { ok: false, status: response.status, errorCode: lastErrorCode, retryable: false, authFailed: true };
      }
      if (retryable(response.status)) {
        lastStatus = response.status;
        lastRetryable = true;
        delayMs = retryDelayMs(attempt, response);
        continue;
      }
      return { ok: false, status: response.status, errorCode: lastErrorCode, retryable: false };
    } catch {
      // Network failure / timeout — back off and try again.
      lastRetryable = true;
      delayMs = RETRY_BACKOFF_MS[attempt] ?? 500;
    }
  }

  return { ok: false, status: lastStatus, errorCode: lastErrorCode, retryable: lastRetryable };
}

/**
 * Registers one upstream webhook per event (the API upserts by event).
 * Best effort — a failure only means the gateway keeps its previous
 * subscriptions, so this logs and never throws. Returns the count of
 * registrations the gateway accepted.
 */
export async function registerGatewayWebhooks(
  env: Env,
  config: SmsGatewayConfig,
  webhookUrl: string,
): Promise<number> {
  let registered = 0;
  for (const event of SMS_WEBHOOK_EVENTS) {
    try {
      const response = await fetch(`${config.baseUrl}/webhook`, {
        method: 'POST',
        headers: { Authorization: authHeader(config), 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: webhookUrl, event }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.ok) {
        registered += 1;
      } else {
        console.error('sms_webhook_register_failed', { event, status: response.status });
      }
    } catch (error) {
      console.error('sms_webhook_register_failed', { event, error });
    }
  }
  return registered;
}

/**
 * Extra health signal from the gateway (`GET /health`); a 200 means the
 * gateway app is online and a device is attached. Never throws.
 */
export async function readGatewayHealth(env: Env, config: SmsGatewayConfig): Promise<{ reachable: boolean }> {
  try {
    const response = await fetch(`${config.baseUrl}/health`, {
      headers: { Authorization: authHeader(config) },
      signal: AbortSignal.timeout(5_000),
    });
    return { reachable: response.ok };
  } catch {
    return { reachable: false };
  }
}
