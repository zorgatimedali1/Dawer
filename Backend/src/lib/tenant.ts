import { sha256Hex } from './crypto';
import type { Env } from '../types';

export type AuthenticatedUser = { id: string; email: string };

export async function getAuthenticatedUser(request: Request, env: Env): Promise<AuthenticatedUser | null> {
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
  google_place_id, facebook_url, instagram_url, created_at, updated_at`;

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
    action: string;
    entityType?: string;
    entityId?: string;
    metadata?: unknown;
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO audit_logs (id, business_id, user_id, action, entity_type, entity_id, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      entry.businessId,
      entry.userId,
      entry.action,
      entry.entityType ?? null,
      entry.entityId ?? null,
      entry.metadata === undefined ? null : JSON.stringify(entry.metadata),
      new Date().toISOString(),
    )
    .run()
    .catch(() => undefined);
}
