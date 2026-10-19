import { hmacSha256Hex, secureRandomHex, timingSafeEqualString } from './crypto';

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      // A malformed percent-escape (stray '%') must not crash the route with
      // an uncaught URIError — treat it exactly like a missing cookie.
      try {
        return decodeURIComponent(part.slice(separator + 1).trim());
      } catch {
        return null;
      }
    }
  }

  return null;
}

/** Merchant session cookie: HttpOnly, also set by login/register for the SPA. */
export const SESSION_COOKIE = 'cf_session';

/** `__Host-` mandates Secure (HTTPS only) — same rule as the spin cookie. */
export function sessionCookieName(request: Request): string {
  return new URL(request.url).protocol === 'https:' ? `__Host-${SESSION_COOKIE}` : SESSION_COOKIE;
}

/**
 * Reads the current cookie name first, then the pre-`__Host-` name so
 * sessions issued before the rename keep working through their lifetime.
 */
export function readSessionCookie(request: Request): string | null {
  return readCookie(request, `__Host-${SESSION_COOKIE}`) ?? readCookie(request, SESSION_COOKIE);
}

/**
 * Single-use Google OAuth handoff state, round-tripped through a cookie and
 * the oauth_states row. The `__Host-` prefix mandates Secure (HTTPS only),
 * same rule as the session cookie; local HTTP dev keeps the plain name.
 */
export const OAUTH_STATE_COOKIE = 'cf_oauth_state';

export function oauthStateCookieName(request: Request): string {
  return new URL(request.url).protocol === 'https:' ? `__Host-${OAUTH_STATE_COOKIE}` : OAUTH_STATE_COOKIE;
}

/** Current name first, then the pre-`__Host-` name. */
export function readOauthStateCookie(request: Request): string | null {
  return readCookie(request, `__Host-${OAUTH_STATE_COOKIE}`) ?? readCookie(request, OAUTH_STATE_COOKIE);
}

/** Cookie strings that expire the OAuth state cookie under both names. */
export function clearedOauthStateCookies(request: Request): string[] {
  if (new URL(request.url).protocol !== 'https:') {
    return [buildCookie(request, OAUTH_STATE_COOKIE, '', 0)];
  }
  return [
    buildCookie(request, `__Host-${OAUTH_STATE_COOKIE}`, '', 0),
    buildCookie(request, OAUTH_STATE_COOKIE, '', 0),
  ];
}

export function buildCookie(request: Request, name: string, value: string, maxAgeSeconds: number): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

/**
 * Sticky visitor identity for the public spin page. The browser gets a random
 * server-set value it cannot read or rotate from JavaScript, so the backend
 * can anchor anti-fraud checks on something a farm cannot regenerate per spin.
 */
export const SPIN_VISITOR_COOKIE = 'cf_spin_visitor';

/** `__Host-` mandates the Secure attribute, which only HTTPS can honour —
 * local HTTP dev keeps the plain name so the cookie still lands. */
export function spinVisitorCookieName(request: Request): string {
  return new URL(request.url).protocol === 'https:' ? `__Host-${SPIN_VISITOR_COOKIE}` : SPIN_VISITOR_COOKIE;
}

export function readSpinVisitor(request: Request): string | null {
  return readCookie(request, `__Host-${SPIN_VISITOR_COOKIE}`) ?? readCookie(request, SPIN_VISITOR_COOKIE);
}

/**
 * Signed visitor values are `<random-id>.<hmac>`. The MAC binds the id to the
 * server-held `COOKIE_SIGNING_KEY`, so a client that forges or rewrites the
 * cookie fails verification and is treated exactly like a cookie-less visitor.
 */
const SPIN_VISITOR_ID = /^[0-9a-f]{64}$/;
const SPIN_VISITOR_MAC = /^[0-9a-f]{64}$/;

/** Mints `id.mac` for the cookie value. `rawId` exists for deterministic tests. */
export async function mintSpinVisitorValue(secret: string, rawId?: string): Promise<string> {
  const id = rawId ?? secureRandomHex(32);
  const mac = await hmacSha256Hex(secret, `spin:${id}`);
  return `${id}.${mac}`;
}

/** Returns the raw id only when the MAC verifies; anything else is `null`. */
export async function verifySpinVisitorValue(secret: string, value: string): Promise<string | null> {
  const separator = value.lastIndexOf('.');
  if (separator < 0) return null;

  const id = value.slice(0, separator);
  const mac = value.slice(separator + 1);
  if (!SPIN_VISITOR_ID.test(id) || !SPIN_VISITOR_MAC.test(mac)) return null;

  const expected = await hmacSha256Hex(secret, `spin:${id}`);
  return timingSafeEqualString(mac, expected) ? id : null;
}
