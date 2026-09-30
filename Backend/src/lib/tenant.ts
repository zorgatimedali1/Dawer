import { sha256Hex } from './crypto';
import type { Env } from '../types';

export async function getAuthenticatedUser(request: Request, env: Env): Promise<{ id: string; email: string } | null> {
  const authorizationHeader = request.headers.get('authorization');

  if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authorizationHeader.slice('Bearer '.length).trim();
  if (!token) {
    return null;
  }

  const tokenHash = await sha256Hex(token);
  const now = new Date().toISOString();

  const session = await env.DB.prepare(
    `SELECT u.id, u.email
     FROM sessions s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(tokenHash, now)
    .first<{ id: string; email: string }>();

  return session ?? null;
}

export async function requireAuthenticatedUser(request: Request, env: Env): Promise<{ id: string; email: string } | null> {
  return getAuthenticatedUser(request, env);
}
