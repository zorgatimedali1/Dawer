import { buildCookie, readCookie } from '../../lib/cookie';
import { secureRandomHex, sha256Hex } from '../../lib/crypto';
import type { Env } from '../../types';

export const OPERATOR_SESSION_COOKIE = 'cf_op_session';
export const OPERATOR_SESSION_MAX_AGE = 60 * 60 * 24 * 7;

export type Operator = { id: string; email: string };

export type OperatorProfile = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
};

/** `__Host-` mandates Secure (HTTPS only) — same rule as the merchant cookie. */
export function operatorSessionCookieName(request: Request): string {
  return new URL(request.url).protocol === 'https:'
    ? `__Host-${OPERATOR_SESSION_COOKIE}`
    : OPERATOR_SESSION_COOKIE;
}

export function operatorSessionCookie(request: Request, token: string): string {
  return buildCookie(request, operatorSessionCookieName(request), token, OPERATOR_SESSION_MAX_AGE);
}

export function clearedOperatorSessionCookie(request: Request): string {
  return buildCookie(request, operatorSessionCookieName(request), '', 0);
}

export function mintOperatorToken(): string {
  return `op_${secureRandomHex(16)}.${secureRandomHex(16)}`;
}

/**
 * Operator sessions are a separate table from merchant sessions, so a token
 * minted here can never resolve on the merchant Worker and vice versa.
 */
export async function getOperator(request: Request, env: Env): Promise<Operator | null> {
  // Prefer the `__Host-` name, then the pre-rename name so sessions issued
  // before the change keep working through their lifetime.
  const token =
    readCookie(request, `__Host-${OPERATOR_SESSION_COOKIE}`) ?? readCookie(request, OPERATOR_SESSION_COOKIE);
  if (!token) return null;

  const tokenHash = await sha256Hex(token);

  const row = await env.DB.prepare(
    `SELECT o.id, o.email
     FROM platform_sessions s
     INNER JOIN platform_operators o ON o.id = s.operator_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND o.status = 'ACTIVE'`,
  )
    .bind(tokenHash, new Date().toISOString())
    .first<{ id: string; email: string }>();

  if (!row) return null;
  return { id: row.id, email: row.email };
}

export async function getOperatorProfile(operatorId: string, env: Env): Promise<OperatorProfile | null> {
  const row = await env.DB.prepare(
    'SELECT id, email, first_name, last_name FROM platform_operators WHERE id = ? LIMIT 1',
  )
    .bind(operatorId)
    .first<{ id: string; email: string; first_name: string | null; last_name: string | null }>();

  if (!row) return null;
  return { id: row.id, email: row.email, firstName: row.first_name, lastName: row.last_name };
}

export async function currentOperatorToken(request: Request): Promise<string | null> {
  return readCookie(request, `__Host-${OPERATOR_SESSION_COOKIE}`) ?? readCookie(request, OPERATOR_SESSION_COOKIE);
}
