import type { Env } from '../types';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Verifies a Cloudflare Turnstile token via the server-side Siteverify API (M7).
 *
 * Opt-in and fail-open on configuration: the check only runs when
 * `TURNSTILE_SECRET_KEY` is set. When it is unset the function returns `true`
 * immediately, so existing deployments, local dev and the test suite keep
 * working until the operator provisions a widget and sets the secret. Once the
 * secret IS set, a missing/invalid/replayed token fails closed (returns false).
 *
 * The token is always verified here in the Worker — never in the browser.
 */
export async function verifyTurnstile(
  request: Request,
  env: Env,
  token: string | undefined,
  expectedAction: string,
): Promise<boolean> {
  const secret = env.TURNSTILE_SECRET_KEY;
  // Opt-in: no secret configured -> no enforcement (fail-open on config).
  if (!secret) return true;

  // Tokens are single-use and short; bound the size before sending.
  if (!token || token.length < 1 || token.length > 2048) return false;

  const remoteip = request.headers.get('cf-connecting-ip') ?? undefined;

  let result: { success?: boolean; action?: string; hostname?: string };
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({
        secret,
        response: token,
        ...(remoteip ? { remoteip } : {}),
      }),
    });
    if (!response.ok) return false;
    result = (await response.json()) as { success?: boolean; action?: string; hostname?: string };
  } catch {
    // Network error / timeout / non-JSON: fail closed (we ARE enforcing).
    return false;
  }

  if (!result.success) return false;
  if (result.action !== expectedAction) return false;

  // Optional hostname allowlist (deployment-specific frontend origins).
  const allowed = (env.TURNSTILE_HOSTNAMES ?? '')
    .split(',')
    .map((hostname) => hostname.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length > 0) {
    const hostname = (result.hostname ?? '').toLowerCase();
    if (!allowed.includes(hostname)) return false;
  }

  return true;
}
