import { z } from 'zod';
import { hashPassword, sha256Hex, secureRandomHex, verifyPassword } from '../lib/crypto';
import { errorResponse, jsonResponse } from '../lib/http';
import { loginSchema, registerSchema, googleCallbackSchema } from '../lib/validation';
import { getUserByToken } from '../lib/tenant';
import type { Env } from '../types';

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

const SESSION_COOKIE = 'cf_session';
const OAUTH_STATE_COOKIE = 'cf_oauth_state';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;
const OAUTH_STATE_MAX_AGE = 60 * 15;

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }

  return null;
}

function buildCookie(request: Request, name: string, value: string, maxAgeSeconds: number): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

/** Error response for the OAuth handoff that also expires the state cookie. */
function oauthError(request: Request, message: string, status: number, details?: unknown): Response {
  const response = errorResponse(message, status, details);
  response.headers.append('set-cookie', buildCookie(request, OAUTH_STATE_COOKIE, '', 0));
  return response;
}

/**
 * Business slugs are globally unique, so a friendly name can collide with an
 * existing one. Deterministically suffix with random bytes until it is free.
 */
async function uniqueBusinessSlug(name: string, env: Env): Promise<string> {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'business';
  let slug = base;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const clash = await env.DB.prepare('SELECT 1 AS taken FROM businesses WHERE slug = ? LIMIT 1')
      .bind(slug)
      .first();
    if (!clash) return slug;
    slug = `${base}-${secureRandomHex(3)}`;
  }

  return `${base}-${secureRandomHex(6)}`;
}

export async function registerUser(request: Request, env: Env): Promise<Response> {
  try {
    const body = registerSchema.parse(await request.json());
    const email = normalizeEmail(body.email);
    const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ? LIMIT 1').bind(email).first();

    if (existing) {
      return errorResponse('This email is already registered.', 409);
    }

    const userId = crypto.randomUUID();
    const passwordHash = await hashPassword(body.password);
    const now = new Date().toISOString();
    const token = `cf_${secureRandomHex(16)}.${secureRandomHex(16)}`;
    const tokenHash = await sha256Hex(token);
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();

    const statements = [
      env.DB.prepare(
        `INSERT INTO users (id, email, password_hash, salt, first_name, last_name, email_verified, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      ).bind(userId, email, passwordHash.hash, passwordHash.salt, body.firstName, body.lastName, now, now),
    ];

    if (body.businessName) {
      const businessId = crypto.randomUUID();
      const slug = await uniqueBusinessSlug(body.businessName, env);

      statements.push(
        env.DB.prepare(
          `INSERT INTO businesses (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
        ).bind(businessId, body.businessName, slug, now, now),
        env.DB.prepare(
          `INSERT INTO business_members (id, business_id, user_id, role, created_at) VALUES (?, ?, ?, 'OWNER', ?)`,
        ).bind(crypto.randomUUID(), businessId, userId, now),
      );
    }

    statements.push(
      env.DB.prepare(
        `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), userId, tokenHash, now, expiresAt),
    );

    await env.DB.batch(statements);

    return jsonResponse({
      success: true,
      message: 'User registered successfully.',
      token,
      user: {
        id: userId,
        email,
        firstName: body.firstName,
        lastName: body.lastName,
        role: 'merchant',
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse('Validation failed.', 400, error.flatten());
    }

    console.error('Registration failed.', error);
    return errorResponse('Unable to register user.', 500);
  }
}

export async function loginUser(request: Request, env: Env): Promise<Response> {
  try {
    const body = loginSchema.parse(await request.json());
    const email = normalizeEmail(body.email);
    const existing = await env.DB.prepare(
      'SELECT id, email, password_hash, salt, first_name, last_name FROM users WHERE email = ? LIMIT 1',
    )
      .bind(email)
      .first<{ id: string; email: string; password_hash: string; salt: string; first_name: string; last_name: string }>();

    if (!existing) {
      return errorResponse('Invalid email or password.', 401);
    }

    const isValidPassword = await verifyPassword(body.password, existing.salt, existing.password_hash);

    if (!isValidPassword) {
      return errorResponse('Invalid email or password.', 401);
    }

    const token = `cf_${secureRandomHex(16)}.${secureRandomHex(16)}`;
    const tokenHash = await sha256Hex(token);
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();

    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), existing.id, tokenHash, new Date().toISOString(), expiresAt)
      .run();

    return jsonResponse({
      success: true,
      token,
      user: {
        id: existing.id,
        email: existing.email,
        firstName: existing.first_name,
        lastName: existing.last_name,
        role: 'merchant',
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse('Validation failed.', 400, error.flatten());
    }

    return errorResponse('Unable to log in.', 500);
  }
}

export async function logoutUser(request: Request, env: Env): Promise<Response> {
  const authorizationHeader = request.headers.get('authorization');

  if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
    return errorResponse('Missing bearer token.', 401);
  }

  const token = authorizationHeader.slice('Bearer '.length).trim();
  const tokenHash = await sha256Hex(token);

  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();

  const response = jsonResponse({ success: true, message: 'Logged out.' });
  response.headers.append('set-cookie', buildCookie(request, SESSION_COOKIE, '', 0));
  return response;
}

export async function googleAuthStart(request: Request, env: Env): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    return errorResponse('Google OAuth is not configured.', 501);
  }

  const url = new URL(request.url);
  const state = secureRandomHex(16);
  await env.TOKENS.put(`google:oauth:${state}`, JSON.stringify({ createdAt: Date.now() }), { expirationTtl: 900 });

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
      return oauthError(request, 'Invalid or expired OAuth state.', 400);
    }

    const savedState = await env.TOKENS.get(`google:oauth:${payload.state}`);

    if (!savedState) {
      return oauthError(request, 'Invalid or expired OAuth state.', 400);
    }

    // Single use: a replayed callback must not be able to mint a second session.
    await env.TOKENS.delete(`google:oauth:${payload.state}`);

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
    });

    if (!tokenResponse.ok) {
      return oauthError(request, 'Unable to exchange Google authorization code.', 400);
    }

    const tokenData = (await tokenResponse.json()) as { access_token?: string };

    if (!tokenData.access_token) {
      return oauthError(request, 'Google token exchange returned no access token.', 400);
    }

    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });

    if (!profileResponse.ok) {
      return oauthError(request, 'Google profile lookup failed.', 400);
    }

    const googleUser = (await profileResponse.json()) as {
      sub: string;
      email?: string;
      name?: string;
      picture?: string;
    };

    const email = normalizeEmail(googleUser.email ?? '');

    if (!email) {
      return oauthError(request, 'Google email is required.', 400);
    }

    const existingUser = await env.DB.prepare('SELECT id FROM users WHERE email = ? LIMIT 1').bind(email).first<{ id: string }>();

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
      headers: { location: `${new URL(request.url).origin}/auth/callback` },
    });
    response.headers.append('set-cookie', buildCookie(request, SESSION_COOKIE, accessToken, SESSION_MAX_AGE));
    response.headers.append('set-cookie', buildCookie(request, OAUTH_STATE_COOKIE, '', 0));
    return response;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return oauthError(request, 'Invalid OAuth payload.', 400, error.flatten());
    }

    console.error('Google OAuth failed.', error);
    return oauthError(request, 'Google OAuth failed.', 500);
  }
}

/**
 * Exchanges the HttpOnly session cookie for a token the SPA can persist.
 * The cookie itself is never exposed to JavaScript.
 */
export async function sessionFromCookie(request: Request, env: Env): Promise<Response> {
  const token = readCookie(request, SESSION_COOKIE);
  const user = token ? await getUserByToken(token, env) : null;

  if (!user) {
    const response = errorResponse('Your session has expired. Sign in again.', 401);
    response.headers.append('set-cookie', buildCookie(request, SESSION_COOKIE, '', 0));
    return response;
  }

  const profile = await env.DB.prepare(
    'SELECT id, email, first_name, last_name FROM users WHERE id = ? LIMIT 1',
  )
    .bind(user.id)
    .first<{ id: string; email: string; first_name: string; last_name: string }>();

  return jsonResponse({
    success: true,
    token,
    user: {
      id: user.id,
      email: user.email,
      firstName: profile?.first_name ?? '',
      lastName: profile?.last_name ?? '',
      role: 'merchant',
    },
  });
}

export async function handleAuthRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === 'POST' && url.pathname === '/api/auth/register') {
    return registerUser(request, env);
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/login') {
    return loginUser(request, env);
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
