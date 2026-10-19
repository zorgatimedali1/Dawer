import { z } from 'zod';
import { hashPassword, sha256Hex, verifyPassword, DUMMY_PASSWORD_HASH, DUMMY_PASSWORD_SALT } from '../../lib/crypto';
import { errorResponse, jsonResponse } from '../../lib/http';
import { isCrossSitePost } from '../../lib/security';
import { loginSchema, passwordChangeSchema } from '../../lib/validation';
import { buildCookie } from '../../lib/cookie';
import { rotateSession } from '../../lib/sessions';
import {
  clearedOperatorSessionCookie,
  currentOperatorToken,
  getOperator,
  getOperatorProfile,
  mintOperatorToken,
  operatorSessionCookie,
  OPERATOR_SESSION_COOKIE,
  OPERATOR_SESSION_MAX_AGE,
} from '../lib/auth';
import type { Env } from '../../types';

const AUTH_PREFIX = '/api/auth';

/** Wrong passwords tolerated before the operator account is frozen. */
const MAX_FAILED_LOGINS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60_000;

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

async function loginOperator(request: Request, env: Env): Promise<Response> {
  try {
    const body = loginSchema.parse(await request.json());
    const email = normalizeEmail(body.email);

    const operator = await env.DB.prepare(
      `SELECT id, email, password_hash, salt, status, first_name, last_name,
              failed_login_attempts, locked_until
       FROM platform_operators WHERE email = ? LIMIT 1`,
    )
      .bind(email)
      .first<{
        id: string;
        email: string;
        password_hash: string;
        salt: string;
        status: string;
        first_name: string | null;
        last_name: string | null;
        failed_login_attempts: number;
        locked_until: string | null;
      }>();

    if (!operator) {
      // Equalise work with a real-password attempt (same dummy PBKDF2 as the
      // merchant flow) so response timing cannot be used to enumerate
      // operator addresses.
      await verifyPassword(body.password, DUMMY_PASSWORD_SALT, DUMMY_PASSWORD_HASH);
      return errorResponse('Invalid email or password.', 401);
    }

    const attemptAt = new Date();
    if (operator.locked_until && operator.locked_until > attemptAt.toISOString()) {
      return errorResponse('Too many failed attempts. Try again later.', 429);
    }

    // The lock expired: clear the stale counter first, otherwise the very next
    // wrong password would compute attempts = MAX + 1 and instantly re-lock
    // the operator for another full window.
    if (operator.locked_until) {
      await env.DB.prepare(
        `UPDATE platform_operators SET failed_login_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?`,
      )
        .bind(attemptAt.toISOString(), operator.id)
        .run();
      operator.failed_login_attempts = 0;
    }

    const isValidPassword = await verifyPassword(body.password, operator.salt, operator.password_hash);

    if (!isValidPassword) {
      const attempts = Number(operator.failed_login_attempts ?? 0) + 1;
      const lockedUntil =
        attempts >= MAX_FAILED_LOGINS ? new Date(attemptAt.getTime() + LOGIN_LOCKOUT_MS).toISOString() : null;
      await env.DB.prepare(
        `UPDATE platform_operators SET failed_login_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?`,
      )
        .bind(attempts, lockedUntil, attemptAt.toISOString(), operator.id)
        .run();
      return errorResponse('Invalid email or password.', 401);
    }

    // The credential was correct: hand the counter back whatever else fails.
    await env.DB.prepare(
      `UPDATE platform_operators SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?`,
    )
      .bind(operator.id)
      .run();

    if (operator.status !== 'ACTIVE') {
      return errorResponse('This operator account has been disabled.', 403);
    }

    const token = mintOperatorToken();
    const tokenHash = await sha256Hex(token);
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();

    await env.DB.prepare(
      'INSERT INTO platform_sessions (id, operator_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(crypto.randomUUID(), operator.id, tokenHash, now, expiresAt)
      .run();

    const response = jsonResponse({
      success: true,
      operator: {
        id: operator.id,
        email: operator.email,
        firstName: operator.first_name,
        lastName: operator.last_name,
      },
    });
    response.headers.append('set-cookie', operatorSessionCookie(request, token));
    return response;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse('Validation failed.', 400, error.flatten());
    }

    console.error('Operator login failed.', error);
    return errorResponse('Unable to log in.', 500);
  }
}

async function operatorSession(request: Request, env: Env): Promise<Response> {
  const operator = await getOperator(request, env);

  if (!operator) {
    const response = errorResponse('Your session has expired. Sign in again.', 401);
    response.headers.append('set-cookie', clearedOperatorSessionCookie(request));
    return response;
  }

  const profile = await getOperatorProfile(operator.id, env);

  if (!profile) {
    const response = errorResponse('Your session has expired. Sign in again.', 401);
    response.headers.append('set-cookie', clearedOperatorSessionCookie(request));
    return response;
  }

  const response = jsonResponse({ success: true, operator: profile });

  // Session rotation (mirrors the merchant flow): aged tokens get replaced by
  // a fresh one on their next session check; the old row keeps working only
  // for the two-minute grace so in-flight requests can never fail.
  const token = await currentOperatorToken(request);
  if (token) {
    const rotated = await rotateSession(env, token, {
      table: 'platform_sessions',
      ownerColumn: 'operator_id',
      tokenPrefix: 'op_',
      maxAgeSeconds: OPERATOR_SESSION_MAX_AGE,
    });
    if (rotated) {
      response.headers.append('set-cookie', operatorSessionCookie(request, rotated));
    }
  }

  return response;
}

async function logoutOperator(request: Request, env: Env): Promise<Response> {
  const token = await currentOperatorToken(request);

  if (token) {
    const tokenHash = await sha256Hex(token);
    // Resolve the operator first so a logout revokes every live session for
    // that account (other devices), not just the one that clicked the button.
    const operator = await getOperator(request, env);
    if (operator) {
      await env.DB.prepare('DELETE FROM platform_sessions WHERE operator_id = ?').bind(operator.id).run();
    } else {
      await env.DB.prepare('DELETE FROM platform_sessions WHERE token_hash = ?').bind(tokenHash).run();
    }
  }

  const response = jsonResponse({ success: true, message: 'Logged out.' });
  // Expire both cookie names (current `__Host-` and the bare pre-rename one),
  // mirroring the merchant-side logout.
  response.headers.append('set-cookie', clearedOperatorSessionCookie(request));
  response.headers.append('set-cookie', buildCookie(request, OPERATOR_SESSION_COOKIE, '', 0));
  return response;
}

async function changeOperatorPassword(request: Request, env: Env): Promise<Response> {
  try {
    const operator = await getOperator(request, env);

    if (!operator) {
      return errorResponse('Authentication required.', 401);
    }

    const body = passwordChangeSchema.parse(await request.json());

    const stored = await env.DB.prepare(
      'SELECT id, password_hash, salt FROM platform_operators WHERE id = ? LIMIT 1',
    )
      .bind(operator.id)
      .first<{ id: string; password_hash: string; salt: string }>();

    if (!stored) {
      return errorResponse('Authentication required.', 401);
    }

    const matches = await verifyPassword(body.currentPassword, stored.salt, stored.password_hash);

    if (!matches) {
      return errorResponse('Your current password is incorrect.', 400);
    }

    if (body.currentPassword === body.newPassword) {
      return errorResponse('Choose a password you have not used before.', 400);
    }

    const next = await hashPassword(body.newPassword);
    const now = new Date().toISOString();

    await env.DB.prepare(
      'UPDATE platform_operators SET password_hash = ?, salt = ?, updated_at = ? WHERE id = ?',
    )
      .bind(next.hash, next.salt, now, operator.id)
      .run();

    const currentToken = await currentOperatorToken(request);
    const currentHash = currentToken ? await sha256Hex(currentToken) : null;

    if (currentHash) {
      await env.DB.prepare(
        'DELETE FROM platform_sessions WHERE operator_id = ? AND token_hash != ?',
      )
        .bind(operator.id, currentHash)
        .run();
    }

    return jsonResponse({ success: true, message: 'Password updated.' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse('Validation failed.', 400, error.flatten());
    }

    console.error('Operator password change failed.', error);
    return errorResponse('Unable to update the password.', 500);
  }
}

export async function handleOperatorAuthRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // Login CSRF: mirrors the merchant auth route — a cross-site page must not
  // be able to POST credentials to sign the operator into an attacker session.
  if (
    request.method === 'POST'
    && (path === `${AUTH_PREFIX}/login` || path === `${AUTH_PREFIX}/password`)
    && isCrossSitePost(request)
  ) {
    return errorResponse('Cross-site request rejected.', 403);
  }

  if (request.method === 'POST' && path === `${AUTH_PREFIX}/login`) {
    return loginOperator(request, env);
  }

  if (request.method === 'POST' && path === `${AUTH_PREFIX}/logout`) {
    return logoutOperator(request, env);
  }

  if (request.method === 'POST' && path === `${AUTH_PREFIX}/password`) {
    return changeOperatorPassword(request, env);
  }

  if (request.method === 'GET' && path === `${AUTH_PREFIX}/session`) {
    return operatorSession(request, env);
  }

  return errorResponse('Route not found.', 404);
}
