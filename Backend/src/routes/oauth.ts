import {
  sha256Hex,
  secureRandomHex,
  verifyPassword,
  DUMMY_PASSWORD_HASH,
  DUMMY_PASSWORD_SALT,
} from '../lib/crypto';
import { jsonResponse, errorResponse } from '../lib/http';
import { ensureStarterTrialForUser } from '../lib/business';
import type { Env } from '../types';

/** Same serving origin as the SPA/API (see AGENTS.md: dawer.tn). */
const SITE_URL = 'https://dawer.tn';
/** Merchant sessions last 3 days (mirrors routes/auth.ts; keep in sync). */
const SESSION_MAX_AGE = 60 * 60 * 24 * 3;
/** Wrong passwords tolerated before the account freezes (mirrors routes/auth.ts). */
const MAX_FAILED_LOGINS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60_000;
/** The only grant type this server implements today. */
const SUPPORTED_GRANT_TYPE = 'password';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  salt: string;
  first_name: string;
  last_name: string;
  status: string;
  failed_login_attempts: number;
  locked_until: string | null;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * RFC 6749 §5.2 token-endpoint errors use the `error` code shape — not the
 * internal `{ success, message }` wrapper — so generic OAuth clients can read
 * them.
 */
function tokenError(error: string, error_description: string, status = 400): Response {
  return jsonResponse({ error, error_description }, status);
}

/**
 * Reads form-encoded request bodies with two accepted shapes:
 *  1. `application/x-www-form-urlencoded` — the RFC 6749 §4.3.2 wire format;
 *  2. straight text (production artifact: the express urlencoded middleware
 *     hands the adapter a parsed object that `toWorkerRequest` re-serializes
 *     as JSON while the original content-type header survives).
 */
async function readFormPayload(
  request: Request,
): Promise<{ form: FormData; parseError: false } | { form: null; parseError: true }> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { form: null, parseError: true };
  }
  if (raw === '') return { form: null, parseError: true };

  const form = new FormData();
  try {
    if (raw.trim().startsWith('{')) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string') form.append(key, value);
      }
    } else {
      for (const [key, value] of new URLSearchParams(raw)) form.append(key, value);
    }
  } catch {
    return { form: null, parseError: true };
  }
  return [...form.keys()].length === 0
    ? { form: null, parseError: true }
    : { form, parseError: false };
}

/**
 * RFC 8414 authorization-server discovery document.
 *
 * Deliberately honest about what this server does:
 *  - authorization_endpoint is the Google-proxied authorization flow in
 *    routes/auth.ts (GET /api/auth/google): it mints single-use state plus a
 *    PKCE verifier, sends the user's browser to Google, and issues a Dawer
 *    session on the callback.
 *  - token_endpoint implements `grant_type=password` (RFC 6749 §4.3) over the
 *    existing merchant email+password credentials, so automated clients can
 *    obtain a Bearer token without a browser.
 *  - tokens are OPAQUE (`cf_…`, SHA-256-hashed in D1) — there are no signed
 *    JWTs, so no jwks_uri is published and any asymmetric-key field would be
 *    a lie.
 *  - scope gating does not exist inside the API yet: a granted token carries
 *    the operator's full merchant access, advertised as the single `api`
 *    scope (see llms.txt).
 */
export async function handleOauthDiscoveryRoute(request: Request, _env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== '/.well-known/oauth-authorization-server') {
    return errorResponse('Route not found.', 404);
  }
  if (request.method !== 'GET') return errorResponse('Method not allowed.', 405);

  return jsonResponse({
    issuer: SITE_URL,
    service_documentation: `${SITE_URL}/llms.txt`,
    authorization_endpoint: `${SITE_URL}/api/auth/google`,
    token_endpoint: `${SITE_URL}/api/oauth/token`,
    token_endpoint_auth_methods_supported: ['none'],
    grant_types_supported: [SUPPORTED_GRANT_TYPE],
    response_types_supported: ['code'],
    scopes_supported: ['api'],
    token_expiry: SESSION_MAX_AGE,
  });
}

/**
 * RFC 6749 §4.3 resource-owner password-credentials grant.
 *
 * Security stance (user-approved when this shipped):
 *  - This endpoint deliberately REVERSES the P1-1 rule in routes/auth.ts —
 *    the session token goes in the JSON body so non-browser API clients can
 *    pick it up without a cookie jar.
 *  - No Turnstile: the purpose is programmatic access, and a CAPTCHA would
 *    make every agent fail. Brute force is absorbed by the dedicated
 *    AUTH_RATE_LIMITER mount (ipOnly + fail-closed) plus the account lockout
 *    counter shared with the interactive login.
 */
export async function handleOauthTokenRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/oauth/token') {
    return errorResponse('Route not found.', 404);
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);

  const { form, parseError } = await readFormPayload(request);
  if (parseError || form === null) {
    return tokenError('invalid_request', 'Token requests use application/x-www-form-urlencoded.');
  }

  const grantType = form.get('grant_type');
  if (typeof grantType !== 'string') {
    return tokenError('invalid_request', 'Missing grant_type.');
  }
  if (grantType !== SUPPORTED_GRANT_TYPE) {
    return tokenError('unsupported_grant_type', `Supported grant types: ${SUPPORTED_GRANT_TYPE}.`);
  }

  const username = form.get('username');
  const password = form.get('password');
  if (typeof username !== 'string' || username.trim() === '') {
    return tokenError('invalid_request', 'Missing username.');
  }
  if (typeof password !== 'string' || password === '') {
    return tokenError('invalid_request', 'Missing password.');
  }

  const email = normalizeEmail(username);
  const existing = await env.DB.prepare(
    `SELECT id, email, password_hash, salt, first_name, last_name, status,
            failed_login_attempts, locked_until
     FROM users WHERE email = ? LIMIT 1`,
  )
    .bind(email)
    .first<UserRow>();

  if (!existing) {
    await verifyPassword(password, DUMMY_PASSWORD_SALT, DUMMY_PASSWORD_HASH);
    return tokenError('invalid_grant', 'Invalid email or password.');
  }

  const now = new Date();
  if (existing.locked_until && existing.locked_until > now.toISOString()) {
    return tokenError('invalid_grant', 'Too many failed attempts. Try again later.', 429);
  }

  // Lock expired: clear the stale counter first (mirrors the interactive flow,
  // otherwise the very next wrong password instantly re-locks for a full window).
  if (existing.locked_until) {
    await env.DB.prepare(
      `UPDATE users SET failed_login_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?`,
    )
      .bind(now.toISOString(), existing.id)
      .run();
    existing.failed_login_attempts = 0;
  }

  const isValidPassword = await verifyPassword(password, existing.salt, existing.password_hash);

  if (!isValidPassword) {
    const attempts = Number(existing.failed_login_attempts ?? 0) + 1;
    const lockedUntil =
      attempts >= MAX_FAILED_LOGINS ? new Date(now.getTime() + LOGIN_LOCKOUT_MS).toISOString() : null;
    await env.DB.prepare(
      `UPDATE users SET failed_login_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(attempts, lockedUntil, now.toISOString(), existing.id)
      .run();
    return tokenError('invalid_grant', 'Invalid email or password.');
  }

  // Correct credential: hand the counter back whatever fails next.
  await env.DB.prepare(
    `UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?`,
  )
    .bind(existing.id)
    .run();

  if (existing.status !== 'ACTIVE') {
    return tokenError('invalid_grant', 'This account has been suspended.', 403);
  }

  await ensureStarterTrialForUser(existing.id, env);

  const token = `cf_${secureRandomHex(16)}.${secureRandomHex(16)}`;
  const tokenHash = await sha256Hex(token);
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 1000 * SESSION_MAX_AGE).toISOString();

  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), existing.id, tokenHash, nowIso, expiresAt)
    .run();

  const response = jsonResponse({
    access_token: token,
    token_type: 'Bearer',
    expires_in: SESSION_MAX_AGE,
    scope: 'api',
  });
  // RFC 6749 §5.1: caches must never share token responses across consumers.
  response.headers.set('cache-control', 'no-store');
  response.headers.set('pragma', 'no-cache');
  return response;
}
