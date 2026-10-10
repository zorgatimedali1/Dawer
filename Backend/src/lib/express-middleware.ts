import type { RequestHandler } from 'express';
import type { RateLimit } from '@cloudflare/workers-types';

/**
 * CSRF backstop for every mutating request (POST/PUT/PATCH/DELETE): browsers
 * attach `Origin` to cross-origin writes, so a mismatching host is an attack.
 * Requests without an Origin header (server-to-server: webhook providers,
 * the WhatsApp bridge, curl) pass — they hold no victim cookie jar, and
 * SameSite=Lax already covers the browser case. GETs are skipped so top-level
 * navigations (OAuth callback, one-click unsubscribe) keep working.
 */
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Server-to-server callback paths: signed/token-authenticated, never browser-POSTed. */
const CROSS_ORIGIN_SKIP_PATHS = ['/api/webhooks'];

export function createCrossOriginGuard(): RequestHandler {
  return (request, response, next) => {
    if (!UNSAFE_METHODS.has(request.method)) {
      next();
      return;
    }

    const fullPath = (request.originalUrl || request.url || '').split('?')[0] ?? '';
    if (CROSS_ORIGIN_SKIP_PATHS.some((skip) => fullPath === skip || fullPath.startsWith(`${skip}/`))) {
      next();
      return;
    }

    const origin = request.get('origin');
    if (!origin) {
      next();
      return;
    }

    const host = request.get('host');
    let matches: boolean;
    try {
      matches = Boolean(host) && new URL(origin).host === host;
    } catch {
      matches = false;
    }

    if (matches) {
      next();
      return;
    }

    response.status(403).json({ success: false, error: 'Cross-site request rejected.' });
  };
}

/**
 * Dynamic path segments collapse to placeholders so rotating ids/codes cannot
 * mint a fresh bucket per request (path-rotation bypass).
 */
function normalizePath(path: string): string {
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/[0-9]{6,}/g, '/:n')
    .replace(/\/[A-Za-z0-9_-]{10,}/g, '/:code');
}

/**
 * Default is fail-open: a rate-limiter outage (or a request without a client
 * IP) must never turn into a 5xx or a shared-bucket lockout — signature checks
 * and per-user quotas still carry the load. Mounts where the limiter itself is
 * the primary control (login brute force) opt into `failClosed` and reject
 * instead of letting traffic through unprotected (P1-5).
 */
export function createRateLimitMiddleware(
  limiter: RateLimit,
  options: { ipOnly?: boolean; skipPaths?: readonly string[]; failClosed?: boolean } = {},
): RequestHandler {
  return async (request, response, next) => {
    // Checked against the full path so behaviour does not depend on where the
    // middleware is mounted (Express strips the mount prefix from request.path).
    const fullPath = (request.originalUrl || request.url || '').split('?')[0] ?? '';
    if (options.skipPaths?.some((skip) => fullPath === skip || fullPath.startsWith(`${skip}/`))) {
      next();
      return;
    }

    const clientIp = request.get('cf-connecting-ip') ?? request.ip;
    if (!clientIp) {
      // Never key on a shared 'unknown' bucket: one noisy client would spend
      // it for everyone. Cloudflare always sets cf-connecting-ip in production.
      console.error('rate_limiter_missing_ip', JSON.stringify({ path: fullPath, method: request.method }));
      if (options.failClosed) {
        response.status(403).json({ success: false, error: 'Unable to verify your network.' });
        return;
      }
      next();
      return;
    }

    try {
      const key = options.ipOnly
        ? clientIp
        : `${clientIp}:${request.method}:${normalizePath(request.path ?? fullPath)}`;
      const { success } = await limiter.limit({ key });

      if (!success) {
        response.set('Retry-After', '60');
        response.status(429).json({ success: false, error: 'Too many requests.' });
        return;
      }

      next();
    } catch (error) {
      console.error('rate_limiter_error', JSON.stringify({ path: fullPath, error: String(error) }));
      if (options.failClosed) {
        response.status(503).json({ success: false, error: 'Service temporarily unavailable.' });
        return;
      }
      next();
    }
  };
}

/**
 * Country allowlist for the public campaign routes (campaign links circulate
 * outside our control, so they get gated at the edge country level).
 *
 * The authoritative signal is the edge-populated `cf` object — a client that
 * forges the `cf-ipcountry` header cannot touch it. The header stays as a
 * fallback for environments that do not populate `cf` (local dev, tests).
 * A missing signal passes unless `strict` is on: Cloudflare always sets it in
 * production, but hard-failing every request the moment a proxy strips it
 * would take the campaign pages down with it.
 */
export function createGeofenceMiddleware(
  allowed: ReadonlySet<string>,
  options: { strict?: boolean } = {},
): RequestHandler {
  return (request, response, next) => {
    const cfCountry = (request as { cf?: { country?: string } }).cf?.country;
    const country = (cfCountry ?? request.get('cf-ipcountry') ?? '').toUpperCase().trim();

    if (country ? !allowed.has(country) : options.strict) {
      response.status(403).json({ success: false, error: 'Unavailable in your region.' });
      return;
    }
    next();
  };
}
