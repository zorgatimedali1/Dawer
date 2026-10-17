import { z } from 'zod';
import { hashPassword, sha256Hex, secureRandomHex, verifyPassword } from '../lib/crypto';
import { buildCookie, readCookie, readSessionCookie, sessionCookieName, SESSION_COOKIE } from '../lib/cookie';
import { errorResponse, jsonResponse } from '../lib/http';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  googleCallbackSchema,
} from '../lib/validation';
import { getEmailConfig, sendPasswordResetEmail } from '../lib/email';
import { getPlatformFeatures } from '../lib/feature-access';
import { getUserByToken } from '../lib/tenant';
import { isCrossSitePost } from '../lib/security';
import {
  createBusinessForUser,
  ensureStarterTrialForUser,
  starterTrialStatement,
  uniqueBusinessSlug,
  userHasBusiness,
} from '../lib/business';
import type { Env } from '../types';

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

const OAUTH_STATE_COOKIE = 'cf_oauth_state';
/** Merchant sessions last 3 days; after that the user must sign in again. */
const SESSION_MAX_AGE = 60 * 60 * 24 * 3;
const OAUTH_STATE_MAX_AGE = 60 * 15;
const PASSWORD_RESET_TTL_MS = 15 * 60_000;
const RESET_LINK_MESSAGE = 'If that email is registered, a password reset link has been sent.';

/**
 * The OAuth callback is a top-level browser navigation (Google redirects the
 * user here), so a JSON body would be shown raw in the tab. Send the user
 * back to the login page with the message instead, and expire the state
 * cookie on every failure path.
 */
function oauthError(request: Request, message: string): Response {
  const response = new Response(null, {
    status: 302,
    headers: { location: `/auth/login?error=${encodeURIComponent(message)}` },
  });
  response.headers.append('set-cookie', buildCookie(request, OAUTH_STATE_COOKIE, '', 0));
  return response;
}

/**
 * Fixed stand-in credential (well-formed salt + hash). Unknown-account
 * logins run the same 100k-iteration PBKDF2 as real ones so response
 * timing cannot be used to enumerate registered emails (P1-7b).
 */
const DUMMY_PASSWORD_SALT = 'f'.repeat(64);
const DUMMY_PASSWORD_HASH = '0'.repeat(64);

/** Expires the current session cookie name and its pre-`__Host-` predecessor. */
function clearSessionCookies(request: Request, response: Response): void {
  response.headers.append('set-cookie', buildCookie(request, sessionCookieName(request), '', 0));
  if (sessionCookieName(request) !== SESSION_COOKIE) {
    response.headers.append('set-cookie', buildCookie(request, SESSION_COOKIE, '', 0));
  }
}

export async function registerUser(request: Request, env: Env): Promise<Response> {
  try {
    const body = registerSchema.parse(await request.json());
    const email = normalizeEmail(body.email);
    const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ? LIMIT 1').bind(email).first();

    if (existing) {
      // Equalise work with a fresh registration: a fast 409 would leak that
      // the address is taken via response timing.
      await hashPassword(body.password);
      return errorResponse('This email is already registered.', 409);
    }

    const userId = crypto.randomUUID();
    const passwordHash = await hashPassword(body.password);
    const now = new Date().toISOString();
    const token = `cf_${secureRandomHex(16)}.${secureRandomHex(16)}`;
    const tokenHash = await sha256Hex(token);
    const expiresAt = new Date(Date.now() + 1000 * SESSION_MAX_AGE).toISOString();

    const statements = [
      env.DB.prepare(
        `INSERT INTO users (id, email, password_hash, salt, first_name, last_name, email_verified, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      ).bind(userId, email, passwordHash.hash, passwordHash.salt, body.firstName, body.lastName, now, now),
    ];

    if (body.businessName) {
      const businessId = crypto.randomUUID();
      const slug = await uniqueBusinessSlug(body.businessName, env);
      // Seed the channel switches from the platform-wide controls so a new
      // business starts in sync with the operator's current intent.
      const platform = await getPlatformFeatures(env);

      statements.push(
        env.DB.prepare(
          `INSERT INTO businesses (id, name, slug, whatsapp_enabled, email_enabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          businessId,
          body.businessName,
          slug,
          platform.whatsappEnabled ? 1 : 0,
          platform.emailEnabled ? 1 : 0,
          now,
          now,
        ),
        env.DB.prepare(
          `INSERT INTO business_members (id, business_id, user_id, role, created_at) VALUES (?, ?, ?, 'OWNER', ?)`,
        ).bind(crypto.randomUUID(), businessId, userId, now),
        starterTrialStatement(env, businessId, now),
      );
    }

    statements.push(
      env.DB.prepare(
        `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), userId, tokenHash, now, expiresAt),
    );

    await env.DB.batch(statements);

    // P1-1: the session token travels only in the HttpOnly cookie — it is
    // never part of the JSON body JavaScript can read.
    const response = jsonResponse({
      success: true,
      message: 'User registered successfully.',
      user: {
        id: userId,
        email,
        firstName: body.firstName,
        lastName: body.lastName,
        role: 'merchant',
      },
    });
    response.headers.append('set-cookie', buildCookie(request, sessionCookieName(request), token, SESSION_MAX_AGE));
    return response;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse('Validation failed.', 400, error.flatten());
    }

    console.error('Registration failed.', error);
    return errorResponse('Unable to register user.', 500);
  }
}

/** Wrong passwords tolerated before the account is frozen, and for how long. */
const MAX_FAILED_LOGINS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60_000;

export async function loginUser(request: Request, env: Env): Promise<Response> {
  try {
    const body = loginSchema.parse(await request.json());
    const email = normalizeEmail(body.email);
    const existing = await env.DB.prepare(
      `SELECT id, email, password_hash, salt, first_name, last_name, status,
              failed_login_attempts, locked_until
       FROM users WHERE email = ? LIMIT 1`,
    )
      .bind(email)
      .first<{
        id: string;
        email: string;
        password_hash: string;
        salt: string;
        first_name: string;
        last_name: string;
        status: string;
        failed_login_attempts: number;
        locked_until: string | null;
      }>();

    if (!existing) {
      await verifyPassword(body.password, DUMMY_PASSWORD_SALT, DUMMY_PASSWORD_HASH);
      return errorResponse('Invalid email or password.', 401);
    }

    const now = new Date();
    if (existing.locked_until && existing.locked_until > now.toISOString()) {
      return errorResponse('Too many failed attempts. Try again later.', 429);
    }

    const isValidPassword = await verifyPassword(body.password, existing.salt, existing.password_hash);

    if (!isValidPassword) {
      const attempts = Number(existing.failed_login_attempts ?? 0) + 1;
      const lockedUntil =
        attempts >= MAX_FAILED_LOGINS ? new Date(now.getTime() + LOGIN_LOCKOUT_MS).toISOString() : null;
      await env.DB.prepare(
        `UPDATE users SET failed_login_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?`,
      )
        .bind(attempts, lockedUntil, now.toISOString(), existing.id)
        .run();
      return errorResponse('Invalid email or password.', 401);
    }

    // The credential was correct: hand the counter back whatever else fails.
    await env.DB.prepare(
      `UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?`,
    )
      .bind(existing.id)
      .run();

    if (existing.status !== 'ACTIVE') {
      return errorResponse('This account has been suspended.', 403);
    }

    await ensureStarterTrialForUser(existing.id, env);

    const token = `cf_${secureRandomHex(16)}.${secureRandomHex(16)}`;
    const tokenHash = await sha256Hex(token);
    const expiresAt = new Date(Date.now() + 1000 * SESSION_MAX_AGE).toISOString();

    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), existing.id, tokenHash, new Date().toISOString(), expiresAt)
      .run();

    const response = jsonResponse({
      success: true,
      user: {
        id: existing.id,
        email: existing.email,
        firstName: existing.first_name,
        lastName: existing.last_name,
        role: 'merchant',
      },
    });
    response.headers.append('set-cookie', buildCookie(request, sessionCookieName(request), token, SESSION_MAX_AGE));
    return response;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse('Validation failed.', 400, error.flatten());
    }

    return errorResponse('Unable to log in.', 500);
  }
}

export async function logoutUser(request: Request, env: Env): Promise<Response> {
  const authorizationHeader = request.headers.get('authorization');
  const bearerToken = authorizationHeader?.startsWith('Bearer ')
    ? authorizationHeader.slice('Bearer '.length).trim()
    : '';
  // Cookie-only sessions (SPA) revoke through the session cookie; the bearer
  // path stays supported so an old client still kills its own session.
  const token = bearerToken || readSessionCookie(request);

  if (token) {
    const tokenHash = await sha256Hex(token);
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
  }

  const response = jsonResponse({ success: true, message: 'Logged out.' });
  clearSessionCookies(request, response);
  return response;
}

export async function googleAuthStart(request: Request, env: Env): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    return errorResponse('Google OAuth is not configured.', 501);
  }

  const state = secureRandomHex(16);
  await env.DB.prepare('INSERT INTO oauth_states (state, created_at) VALUES (?, ?)')
    .bind(state, new Date().toISOString())
    .run();

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    prompt: 'consent',
  });

  const response = new Response(null, {
    status: 302,
    headers: { location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` },
  });
  response.headers.append('set-cookie', buildCookie(request, OAUTH_STATE_COOKIE, state, OAUTH_STATE_MAX_AGE));
  return response;
}

export async function googleAuthCallback(request: Request, env: Env): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    return errorResponse('Google OAuth is not configured.', 501);
  }

  try {
    const payload = googleCallbackSchema.parse(Object.fromEntries(new URL(request.url).searchParams.entries()));

    // The state must round-trip through an HttpOnly cookie so a third party
    // cannot complete the handoff with a state value it minted itself.
    const stateCookie = readCookie(request, OAUTH_STATE_COOKIE);
    if (!stateCookie || stateCookie !== payload.state) {
      return oauthError(request, 'Invalid or expired OAuth state.');
    }

    // Single use: only one callback can consume the row (D1 serialises the
    // write), so a replayed callback cannot mint a second session.
    const consumed = await env.DB.prepare('DELETE FROM oauth_states WHERE state = ?')
      .bind(payload.state)
      .run();

    if (Number(consumed.meta.changes ?? 0) !== 1) {
      return oauthError(request, 'Invalid or expired OAuth state.');
    }

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code: payload.code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: env.GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!tokenResponse.ok) {
      return oauthError(request, 'Unable to exchange Google authorization code.');
    }

    const tokenData = (await tokenResponse.json()) as { access_token?: string };

    if (!tokenData.access_token) {
      return oauthError(request, 'Google token exchange returned no access token.');
    }

    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!profileResponse.ok) {
      return oauthError(request, 'Google profile lookup failed.');
    }

    const googleUser = (await profileResponse.json()) as {
      sub: string;
      email?: string;
      name?: string;
      picture?: string;
    };

    const email = normalizeEmail(googleUser.email ?? '');

    if (!email) {
      return oauthError(request, 'Google email is required.');
    }

    const existingUser = await env.DB.prepare('SELECT id, status, email_verified FROM users WHERE email = ? LIMIT 1')
      .bind(email)
      .first<{ id: string; status: string; email_verified: number }>();

    if (existingUser && existingUser.status !== 'ACTIVE') {
      return oauthError(request, 'This account has been suspended.');
    }

    // Account-takeover guard: password registration never verifies the email
    // (email_verified = 0), so a Google sign-in with the same address must not
    // silently absorb that account — otherwise anyone can pre-register a
    // victim's address and later walk in through Google. Only a verified
    // email, or an identity whose Google row is already linked, may pass.
    if (existingUser && !existingUser.email_verified) {
      const alreadyLinked = await env.DB.prepare(
        'SELECT 1 AS hit FROM accounts WHERE provider = ? AND provider_account_id = ? LIMIT 1',
      )
        .bind('google', googleUser.sub)
        .first<{ hit: number }>();

      if (!alreadyLinked) {
        return oauthError(
          request,
          'This email is already registered with a password. Sign in with your password instead.',
        );
      }
    }

    const userId = existingUser?.id ?? crypto.randomUUID();

    if (!existingUser) {
      await env.DB.prepare(
        `INSERT INTO users (id, email, first_name, last_name, email_verified, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
        .bind(userId, email, googleUser.name?.split(' ')[0] ?? 'Google', googleUser.name?.split(' ').slice(1).join(' ') ?? 'User', new Date().toISOString(), new Date().toISOString())
        .run();
    }

    await env.DB.prepare(
      `INSERT OR IGNORE INTO accounts (id, user_id, provider, provider_account_id, email, name, avatar_url, created_at)
       VALUES (?, ?, 'google', ?, ?, ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), userId, googleUser.sub, email, googleUser.name ?? 'Google User', googleUser.picture ?? '', new Date().toISOString())
      .run();

    // Google sign-in has no businessName step, so a fresh account would land on
    // a dashboard with no business and no endpoint to create one. Seed one from
    // the profile so the account is usable immediately; Settings can rename it.
    if (!(await userHasBusiness(userId, env))) {
      const displayName = googleUser.name?.trim() || email.split('@')[0] || 'My Business';
      await createBusinessForUser(userId, displayName, env);
    }

    await ensureStarterTrialForUser(userId, env);

    const accessToken = `cf_${secureRandomHex(16)}.${secureRandomHex(16)}`;
    const tokenHash = await sha256Hex(accessToken);
    const expiresAt = new Date(Date.now() + 1000 * SESSION_MAX_AGE).toISOString();

    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), userId, tokenHash, new Date().toISOString(), expiresAt)
      .run();

    // The token travels in an HttpOnly cookie, never in the URL.
    const response = new Response(null, {
      status: 302,
      headers: { location: '/auth/callback' },
    });
    response.headers.append('set-cookie', buildCookie(request, sessionCookieName(request), accessToken, SESSION_MAX_AGE));
    response.headers.append('set-cookie', buildCookie(request, OAUTH_STATE_COOKIE, '', 0));
    return response;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return oauthError(request, 'Invalid OAuth payload.');
    }

    console.error('Google OAuth failed.', error);
    return oauthError(request, 'Google OAuth failed.');
  }
}

/**
 * Reads the HttpOnly session cookie and returns the owning profile. The
 * cookie value itself stays server-side — JavaScript never sees a token.
 */
export async function sessionFromCookie(request: Request, env: Env): Promise<Response> {
  const token = readSessionCookie(request);
  const user = token ? await getUserByToken(token, env) : null;

  if (!user) {
    const response = errorResponse('Your session has expired. Sign in again.', 401);
    clearSessionCookies(request, response);
    return response;
  }

  const profile = await env.DB.prepare(
    'SELECT id, email, first_name, last_name FROM users WHERE id = ? LIMIT 1',
  )
    .bind(user.id)
    .first<{ id: string; email: string; first_name: string; last_name: string }>();

  return jsonResponse({
    success: true,
    user: {
      id: user.id,
      email: user.email,
      firstName: profile?.first_name ?? '',
      lastName: profile?.last_name ?? '',
      role: 'merchant',
    },
  });
}

/**
 * P1-6, step 1: start a password reset. The response never reveals whether
 * the email exists (generic message both ways) and the mail config is checked
 * before the account lookup so that path is identical too. The raw token only
 * ever lives in the emailed link — the database stores its SHA-256.
 */
export async function forgotPassword(request: Request, env: Env): Promise<Response> {
  try {
    const body = forgotPasswordSchema.parse(await request.json());

    const emailConfig = getEmailConfig(env);
    if (!emailConfig) {
      return errorResponse('Password reset is not available right now. Please contact support.', 503);
    }

    const email = normalizeEmail(body.email);
    const user = await env.DB.prepare('SELECT id FROM users WHERE email = ? LIMIT 1')
      .bind(email)
      .first<{ id: string }>();

    if (!user) {
      return jsonResponse({ success: true, message: RESET_LINK_MESSAGE });
    }

    // Cooldown: one send per minute and at most five per hour per address.
    // The response stays generic so the limiter never reveals registrations;
    // this caps email-bombing of a victim and quota-burn of the daily cap.
    const cooldownKey = `pwreset:${email.toLowerCase()}`;
    const nowMs = Date.now();
    const rawCooldown = await env.TOKENS.get(cooldownKey);
    if (rawCooldown) {
      try {
        const state = JSON.parse(rawCooldown) as { count: number; since: number };
        const withinHour = nowMs - state.since < 60 * 60 * 1000;
        if (nowMs - state.since < 60_000 || (withinHour && state.count >= 5)) {
          return jsonResponse({ success: true, message: RESET_LINK_MESSAGE });
        }
      } catch {
        // Corrupt entry — treat as no cooldown and continue.
      }
    }

    const requestedAt = new Date();
    const rawToken = `cfr_${secureRandomHex(32)}`;
    const tokenHash = await sha256Hex(rawToken);
    const expiresAt = new Date(requestedAt.getTime() + PASSWORD_RESET_TTL_MS).toISOString();

    // One live token per account: older requests die when a new one lands.
    await env.DB.prepare('DELETE FROM password_resets WHERE user_id = ?').bind(user.id).run();
    await env.DB.prepare(
      `INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), user.id, tokenHash, expiresAt, requestedAt.toISOString())
      .run();

    // L1: never fall back to the request's Host for the reset link — an
    // attacker who can present an arbitrary Host would get the victim's reset
    // token mailed under an attacker-controlled origin. APP_ORIGIN is required.
    if (!env.APP_ORIGIN) {
      return errorResponse('Password reset is not configured.', 503);
    }
    const resetUrl = `${env.APP_ORIGIN}/auth/reset-password?token=${encodeURIComponent(rawToken)}`;

    const sent = await sendPasswordResetEmail(emailConfig, { to: email, resetUrl });
    if (!sent) {
      await env.DB.prepare('DELETE FROM password_resets WHERE token_hash = ?').bind(tokenHash).run();
      return errorResponse('Unable to send the reset email right now. Please try again.', 503);
    }

    // Count this send against the cooldown only after it actually went out.
    const cooldownState = rawCooldown
      ? (() => {
          try {
            const state = JSON.parse(rawCooldown) as { count: number; since: number };
            const withinHour = nowMs - state.since < 60 * 60 * 1000;
            return { count: withinHour ? state.count + 1 : 1, since: withinHour ? state.since : nowMs };
          } catch {
            return { count: 1, since: nowMs };
          }
        })()
      : { count: 1, since: nowMs };
    await env.TOKENS.put(cooldownKey, JSON.stringify(cooldownState), { expirationTtl: 3600 });

    return jsonResponse({ success: true, message: RESET_LINK_MESSAGE });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse('Validation failed.', 400, error.flatten());
    }

    return errorResponse('Unable to start the password reset.', 500);
  }
}

/**
 * P1-6, step 2: redeem the emailed token. Consumption is a guarded DELETE
 * (`changes === 1`), so concurrent redemptions cannot both win. Success
 * rewrites the password hash, clears any lockout counters, and revokes every
 * existing session for the account.
 */
export async function resetPassword(request: Request, env: Env): Promise<Response> {
  try {
    const body = resetPasswordSchema.parse(await request.json());
    const tokenHash = await sha256Hex(body.token);
    const now = new Date().toISOString();

    const record = await env.DB.prepare(
      `SELECT id, user_id FROM password_resets
       WHERE token_hash = ? AND expires_at > ? AND used_at IS NULL
       LIMIT 1`,
    )
      .bind(tokenHash, now)
      .first<{ id: string; user_id: string }>();

    if (!record) {
      return errorResponse('This reset link is invalid or has expired. Request a new one.', 400);
    }

    const consumed = await env.DB.prepare(
      `DELETE FROM password_resets WHERE id = ? AND used_at IS NULL AND expires_at > ?`,
    )
      .bind(record.id, now)
      .run();

    if (Number(consumed.meta.changes ?? 0) !== 1) {
      return errorResponse('This reset link is invalid or has expired. Request a new one.', 400);
    }

    const { salt, hash } = await hashPassword(body.password);

    await env.DB.prepare(
      `UPDATE users
       SET password_hash = ?, salt = ?, failed_login_attempts = 0, locked_until = NULL, updated_at = ?
       WHERE id = ?`,
    )
      .bind(hash, salt, now, record.user_id)
      .run();

    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(record.user_id).run();

    return jsonResponse({ success: true, message: 'Password updated. You can now sign in.' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse('Validation failed.', 400, error.flatten());
    }

    return errorResponse('Unable to reset the password.', 500);
  }
}

export async function handleAuthRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (
    request.method === 'POST'
    && (url.pathname === '/api/auth/login'
      || url.pathname === '/api/auth/register'
      || url.pathname === '/api/auth/forgot-password'
      || url.pathname === '/api/auth/reset-password')
    && isCrossSitePost(request)
  ) {
    return errorResponse('Cross-site request rejected.', 403);
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/register') {
    return registerUser(request, env);
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/login') {
    return loginUser(request, env);
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/forgot-password') {
    return forgotPassword(request, env);
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/reset-password') {
    return resetPassword(request, env);
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
    return logoutUser(request, env);
  }

  if (request.method === 'GET' && url.pathname === '/api/auth/session') {
    return sessionFromCookie(request, env);
  }

  if (request.method === 'GET' && url.pathname === '/api/auth/google') {
    return googleAuthStart(request, env);
  }

  if (request.method === 'GET' && url.pathname === '/api/auth/google/callback') {
    return googleAuthCallback(request, env);
  }

  return errorResponse('Route not found.', 404);
}
