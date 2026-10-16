import { sha256Hex } from './crypto';
import { readSessionCookie } from './cookie';
import type { Env } from '../types';

export type AuthenticatedUser = { id: string; email: string };

/**
 * Resolves a raw session token (bearer header value, or the value of an HttpOnly
 * cookie) to the owning user. Returns null for expired or unknown tokens, and
 * for suspended accounts — suspension has to cut off existing sessions, not just
 * new sign-ins.
 */
export async function getUserByToken(token: string, env: Env): Promise<AuthenticatedUser | null> {
  if (!token) return null;

  const tokenHash = await sha256Hex(token);
  const now = new Date().toISOString();

  const session = await env.DB.prepare(
    `SELECT u.id, u.email
     FROM sessions s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'ACTIVE'`,
  )
    .bind(tokenHash, now)
    .first<{ id: string; email: string }>();

  if (!session) return null;

  return { id: session.id, email: session.email };
}

export async function getAuthenticatedUser(request: Request, env: Env): Promise<AuthenticatedUser | null> {
  const authorizationHeader = request.headers.get('authorization');

  if (authorizationHeader?.startsWith('Bearer ')) {
    const token = authorizationHeader.slice('Bearer '.length).trim();
    return getUserByToken(token, env);
  }

  // Same-origin fallback: the HttpOnly cookie minted at login (or by the
  // OAuth handoff), under the current `__Host-` name or its predecessor.
  // Bearer always wins when both are present.
  const cookieToken = readSessionCookie(request);
  return cookieToken ? getUserByToken(cookieToken, env) : null;
}

export async function getBusinessIds(userId: string, env: Env): Promise<string[]> {
  const rows = await env.DB.prepare(
    `SELECT business_id FROM business_members WHERE user_id = ? ORDER BY created_at ASC`,
  )
    .bind(userId)
    .all<{ business_id: string }>();

  return (rows.results ?? []).map((row) => row.business_id);
}

export async function getPrimaryBusinessId(userId: string, env: Env): Promise<string | null> {
  const business = await env.DB.prepare(
    `SELECT business_id FROM business_members WHERE user_id = ? ORDER BY created_at ASC LIMIT 1`,
  )
    .bind(userId)
    .first<{ business_id: string }>();

  return business?.business_id ?? null;
}

export const CAMPAIGN_COLUMNS = `id, business_id, name, description, public_code, status, start_at, end_at,
  game_type, require_customer_information, require_action, google_maps_name, google_maps_url,
  google_place_id, facebook_url, instagram_url, created_at, updated_at, play_rules, latitude, longitude,
  radius_meters`;

export type CampaignRecord = {
  id: string;
  business_id: string;
  name: string;
  description: string | null;
  public_code: string;
  status: string;
  start_at: string | null;
  end_at: string | null;
  game_type: string;
  require_customer_information: number;
  require_action: string | null;
  google_maps_name: string | null;
  google_maps_url: string | null;
  google_place_id: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  created_at: string;
  updated_at: string;
  play_rules: string | null;
  latitude: number | null;
  longitude: number | null;
  radius_meters: number | null;
};

/**
 * Loads a campaign only when it belongs to one of the caller's businesses.
 * Returns null for both "missing" and "not yours" so callers cannot leak existence.
 */
export async function findCampaignForUser(
  campaignId: string,
  businessIds: string[],
  env: Env,
): Promise<CampaignRecord | null> {
  if (businessIds.length === 0) return null;

  const placeholders = businessIds.map(() => '?').join(', ');
  const campaign = await env.DB.prepare(
    `SELECT ${CAMPAIGN_COLUMNS}
     FROM campaigns
     WHERE id = ? AND business_id IN (${placeholders})
     LIMIT 1`,
  )
    .bind(campaignId, ...businessIds)
    .first<CampaignRecord>();

  return campaign ?? null;
}

export async function writeAuditLog(
  env: Env,
  entry: {
    businessId: string | null;
    userId: string | null;
    platformOperatorId?: string | null;
    action: string;
    entityType?: string;
    entityId?: string;
    metadata?: unknown;
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO audit_logs (id, business_id, user_id, platform_operator_id, action, entity_type, entity_id, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      entry.businessId,
      entry.userId,
      entry.platformOperatorId ?? null,
      entry.action,
      entry.entityType ?? null,
      entry.entityId ?? null,
      entry.metadata === undefined ? null : JSON.stringify(entry.metadata),
      new Date().toISOString(),
    )
    .run()
    .catch(() => undefined);
}
