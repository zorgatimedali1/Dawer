import { z } from 'zod';
import { errorResponse, jsonResponse } from '../lib/http';
import { secureRandomHex } from '../lib/crypto';
import {
  campaignConfigSchema,
  campaignCreateSchema,
  campaignListQuerySchema,
  campaignUpdateSchema,
  type RewardInput,
} from '../lib/validation';
import {
  CAMPAIGN_COLUMNS,
  findCampaignForUser,
  getBusinessIds,
  getPrimaryBusinessId,
  writeAuditLog,
  type AuthenticatedUser,
} from '../lib/tenant';
import type { Env } from '../types';

const CONFIG_PATH = '/api/business/campaign-config';
const LIST_PATH = '/api/business/campaigns';
const ITEM_PATTERN = /^\/api\/business\/campaigns\/([^/]+)$/;
const DUPLICATE_PATTERN = /^\/api\/business\/campaigns\/([^/]+)\/duplicate$/;

/**
 * Rewards created without an explicit quantity are stocked at 100 so the
 * remaining-units loop works out of the box; an explicit 0 means unlimited.
 */
const DEFAULT_REWARD_STOCK = 100;

function actionToDb(action: string): string {
  return action === 'none' ? 'NONE' : action.toUpperCase().replace(/-/g, '_');
}

async function loadRewards(env: Env, campaignId: string) {
  const rows = await env.DB.prepare(
    `SELECT id, name, type, value, description, quantity, quantity_initial, weight, active, updated_at
     FROM rewards
     WHERE campaign_id = ?
     ORDER BY weight DESC, created_at ASC`,
  )
    .bind(campaignId)
    .all<{
      id: string;
      name: string;
      type: string;
      value: string | null;
      description: string | null;
      quantity: number;
      quantity_initial: number | null;
      weight: number;
      active: number;
      updated_at: string;
    }>();

  return rows.results ?? [];
}

/**
 * Replaces the reward set for a campaign while preserving ids that coupons already point at.
 */
async function syncRewards(
  env: Env,
  campaign: { id: string; business_id: string },
  rewards: RewardInput[],
): Promise<void> {
  const existing = await env.DB.prepare(`SELECT id FROM rewards WHERE campaign_id = ?`)
    .bind(campaign.id)
    .all<{ id: string }>();

  const existingIds = (existing.results ?? []).map((row) => row.id);
  const existingSet = new Set(existingIds);
  const keptIds = new Set<string>();
  const now = new Date().toISOString();

  for (const reward of rewards) {
    const reuseId = reward.id && existingSet.has(reward.id) ? reward.id : null;
    const id = reuseId ?? crypto.randomUUID();
    keptIds.add(id);

    if (reuseId) {
      await env.DB.prepare(
        `UPDATE rewards
         SET name = ?, type = ?, value = ?, description = ?, weight = ?, quantity = ?,
             quantity_initial = ?, active = ?, updated_at = ?
         WHERE id = ? AND campaign_id = ?`,
      )
        .bind(
          reward.name,
          reward.type,
          String(reward.value),
          reward.description,
          reward.weight,
          reward.quantity ?? DEFAULT_REWARD_STOCK,
          reward.quantity ?? DEFAULT_REWARD_STOCK,
          reward.active ? 1 : 0,
          now,
          id,
          campaign.id,
        )
        .run();
    } else {
      await env.DB.prepare(
        `INSERT INTO rewards (id, business_id, campaign_id, name, type, value, description,
                              quantity, quantity_initial, weight, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          id,
          campaign.business_id,
          campaign.id,
          reward.name,
          reward.type,
          String(reward.value),
          reward.description,
          reward.quantity ?? DEFAULT_REWARD_STOCK,
          reward.quantity ?? DEFAULT_REWARD_STOCK,
          reward.weight,
          reward.active ? 1 : 0,
          now,
          now,
        )
        .run();
    }
  }

  const removed = existingIds.filter((id) => !keptIds.has(id));
  if (removed.length) {
    const placeholders = removed.map(() => '?').join(', ');
    await env.DB.prepare(
      `DELETE FROM rewards WHERE campaign_id = ? AND id IN (${placeholders})`,
    )
      .bind(campaign.id, ...removed)
      .run();
  }
}

async function handleConfigGet(request: Request, env: Env, user: AuthenticatedUser): Promise<Response> {
  const url = new URL(request.url);
  const businessIds = await getBusinessIds(user.id, env);

  if (businessIds.length === 0) {
    return jsonResponse({ success: true, campaign: null });
  }

  const requestedId = url.searchParams.get('campaignId');

  let campaign: { id: string } | null;

  if (requestedId) {
    campaign = await findCampaignForUser(requestedId, businessIds, env);
    if (!campaign) return errorResponse('Campaign not found.', 404);
  } else {
    const placeholders = businessIds.map(() => '?').join(', ');
    campaign = await env.DB.prepare(
      `SELECT id FROM campaigns
       WHERE business_id IN (${placeholders})
       ORDER BY updated_at DESC LIMIT 1`,
    )
      .bind(...businessIds)
      .first<{ id: string }>();
  }

  if (!campaign) {
    return jsonResponse({ success: true, campaign: null });
  }

  const record = await env.DB.prepare(
    `SELECT ${CAMPAIGN_COLUMNS} FROM campaigns WHERE id = ? LIMIT 1`,
  )
    .bind(campaign.id)
    .first<Record<string, unknown>>();

  const rewards = await loadRewards(env, campaign.id);

  return jsonResponse({
    success: true,
    campaign: record ?? null,
    rewards,
  });
}

async function handleConfigPut(request: Request, env: Env, user: AuthenticatedUser): Promise<Response> {
  const config = campaignConfigSchema.parse(await request.json());
  const businessIds = await getBusinessIds(user.id, env);

  if (businessIds.length === 0) {
    return errorResponse('Create a business before saving a campaign.', 404);
  }

  const businessId = businessIds[0] as string;

  let target: { id: string; public_code: string; business_id: string } | null;

  if (config.campaignId) {
    const found = await findCampaignForUser(config.campaignId, businessIds, env);
    if (!found) return errorResponse('Campaign not found.', 404);
    target = { id: found.id, public_code: found.public_code, business_id: found.business_id };
  } else {
    const placeholders = businessIds.map(() => '?').join(', ');
    target = await env.DB.prepare(
      `SELECT id, public_code, business_id FROM campaigns
       WHERE business_id IN (${placeholders})
       ORDER BY updated_at DESC LIMIT 1`,
    )
      .bind(...businessIds)
      .first<{ id: string; public_code: string; business_id: string }>();
  }

  const now = new Date().toISOString();
  const startAt = config.startAt ? config.startAt : null;
  const endAt = config.endAt ? config.endAt : null;

  let campaignId: string;
  let publicCode: string;

  if (target) {
    campaignId = target.id;
    publicCode = target.public_code;

    await env.DB.prepare(
      `UPDATE campaigns
       SET name = ?, description = ?, require_action = ?,
           google_maps_name = ?, google_maps_url = ?, google_place_id = ?,
           facebook_url = ?, instagram_url = ?,
           status = COALESCE(?, status),
           start_at = ?, end_at = ?, updated_at = ?
       WHERE id = ? AND business_id = ?`,
    )
      .bind(
        config.title,
        config.description,
        actionToDb(config.action),
        config.googleMapsName || null,
        config.googleMapsUrl || null,
        config.googlePlaceId || null,
        config.facebookUrl || null,
        config.instagramUrl || null,
        config.status ?? null,
        startAt,
        endAt,
        now,
        campaignId,
        target.business_id,
      )
      .run();
  } else {
    campaignId = crypto.randomUUID();
    publicCode = secureRandomHex(6).toUpperCase();

    await env.DB.prepare(
      `INSERT INTO campaigns (
        id, business_id, name, description, public_code, status, start_at, end_at,
        require_action, google_maps_name, google_maps_url, google_place_id,
        facebook_url, instagram_url, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        campaignId,
        businessId,
        config.title,
        config.description,
        publicCode,
        config.status ?? 'ACTIVE',
        startAt,
        endAt,
        actionToDb(config.action),
        config.googleMapsName || null,
        config.googleMapsUrl || null,
        config.googlePlaceId || null,
        config.facebookUrl || null,
        config.instagramUrl || null,
        now,
        now,
      )
      .run();
  }

  if (config.rewards) {
    await syncRewards(env, { id: campaignId, business_id: businessId }, config.rewards);
  }

  await writeAuditLog(env, {
    businessId,
    userId: user.id,
    action: 'campaign.config.updated',
    entityType: 'campaign',
    entityId: campaignId,
  });

  return jsonResponse({ success: true, campaign: { id: campaignId, publicCode } });
}

async function handleCampaignList(request: Request, env: Env, user: AuthenticatedUser): Promise<Response> {
  const url = new URL(request.url);
  const query = campaignListQuerySchema.parse({
    status: url.searchParams.get('status') ?? undefined,
    search: url.searchParams.get('search') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });

  const businessIds = await getBusinessIds(user.id, env);
  if (businessIds.length === 0) {
    return jsonResponse({ success: true, campaigns: [], total: 0 });
  }

  const params: unknown[] = [...businessIds];
  const clauses = [`business_id IN (${businessIds.map(() => '?').join(', ')})`];

  if (query.status) {
    const statuses = query.status
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);
    if (statuses.length) {
      clauses.push(`UPPER(status) IN (${statuses.map(() => '?').join(', ')})`);
      params.push(...statuses);
    }
  }

  if (query.search) {
    clauses.push(`(LOWER(name) LIKE ? OR LOWER(COALESCE(description, '')) LIKE ?)`);
    const like = `%${query.search.toLowerCase()}%`;
    params.push(like, like);
  }

  const where = clauses.join(' AND ');

  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) AS total FROM campaigns WHERE ${where}`,
  )
    .bind(...params)
    .first<{ total: number }>();

  const rows = await env.DB.prepare(
    `SELECT c.id, c.name, c.description, c.public_code, c.status, c.start_at, c.end_at,
            c.game_type, c.created_at, c.updated_at,
            (SELECT COUNT(*) FROM participations p WHERE p.campaign_id = c.id) AS participant_count,
            (SELECT COUNT(*) FROM rewards r WHERE r.campaign_id = c.id) AS reward_count,
            (SELECT COUNT(*) FROM coupons cp WHERE cp.campaign_id = c.id) AS redemption_count
     FROM campaigns c
     WHERE ${where}
     ORDER BY c.updated_at DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(...params, query.limit, (query.page - 1) * query.limit)
    .all();

  return jsonResponse({
    success: true,
    campaigns: rows.results ?? [],
    total: totalRow?.total ?? 0,
    page: query.page,
    limit: query.limit,
  });
}

async function handleCampaignCreate(request: Request, env: Env, user: AuthenticatedUser): Promise<Response> {
  const input = campaignCreateSchema.parse(await request.json());
  const businessId = await getPrimaryBusinessId(user.id, env);

  if (!businessId) {
    return errorResponse('Create a business before adding campaigns.', 404);
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const publicCode = secureRandomHex(6).toUpperCase();

  await env.DB.prepare(
    `INSERT INTO campaigns (id, business_id, name, description, public_code, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?)`,
  )
    .bind(id, businessId, input.name, input.description, publicCode, now, now)
    .run();

  await writeAuditLog(env, {
    businessId,
    userId: user.id,
    action: 'campaign.created',
    entityType: 'campaign',
    entityId: id,
  });

  return jsonResponse({ success: true, campaign: { id, publicCode } }, 201);
}

async function handleCampaignPatch(
  request: Request,
  env: Env,
  user: AuthenticatedUser,
  campaignId: string,
): Promise<Response> {
  const input = campaignUpdateSchema.parse(await request.json());
  const businessIds = await getBusinessIds(user.id, env);
  const campaign = await findCampaignForUser(campaignId, businessIds, env);

  if (!campaign) return errorResponse('Campaign not found.', 404);

  const updates: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) {
    updates.push('name = ?');
    params.push(input.name);
  }
  if (input.description !== undefined) {
    updates.push('description = ?');
    params.push(input.description);
  }
  if (input.status !== undefined) {
    updates.push('status = ?');
    params.push(input.status);
  }
  if (input.startAt !== undefined) {
    updates.push('start_at = ?');
    params.push(input.startAt || null);
  }
  if (input.endAt !== undefined) {
    updates.push('end_at = ?');
    params.push(input.endAt || null);
  }

  updates.push('updated_at = ?');
  params.push(new Date().toISOString());

  await env.DB.prepare(
    `UPDATE campaigns SET ${updates.join(', ')} WHERE id = ? AND business_id = ?`,
  )
    .bind(...params, campaign.id, campaign.business_id)
    .run();

  await writeAuditLog(env, {
    businessId: campaign.business_id,
    userId: user.id,
    action: 'campaign.updated',
    entityType: 'campaign',
    entityId: campaign.id,
    metadata: input,
  });

  return jsonResponse({
    success: true,
    campaign: { id: campaign.id, publicCode: campaign.public_code },
  });
}

async function handleCampaignDuplicate(
  request: Request,
  env: Env,
  user: AuthenticatedUser,
  campaignId: string,
): Promise<Response> {
  const businessIds = await getBusinessIds(user.id, env);
  const source = await findCampaignForUser(campaignId, businessIds, env);

  if (!source) return errorResponse('Campaign not found.', 404);

  const now = new Date().toISOString();
  const newId = crypto.randomUUID();
  const publicCode = secureRandomHex(6).toUpperCase();

  await env.DB.prepare(
    `INSERT INTO campaigns (${CAMPAIGN_COLUMNS})
     VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      newId,
      source.business_id,
      `${source.name} (copy)`,
      source.description,
      publicCode,
      source.start_at,
      source.end_at,
      source.game_type,
      source.require_customer_information,
      source.require_action,
      source.google_maps_name,
      source.google_maps_url,
      source.google_place_id,
      source.facebook_url,
      source.instagram_url,
      now,
      now,
    )
    .run();

  const rewards = await loadRewards(env, source.id);
  if (rewards.length) {
    for (const reward of rewards) {
      await env.DB.prepare(
        `INSERT INTO rewards (id, business_id, campaign_id, name, type, value, description,
                              quantity, quantity_initial, weight, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          source.business_id,
          newId,
          reward.name,
          reward.type,
          reward.value,
          reward.description,
          reward.quantity,
          reward.quantity_initial ?? reward.quantity,
          reward.weight,
          reward.active,
          now,
          now,
        )
        .run();
    }
  }

  await writeAuditLog(env, {
    businessId: source.business_id,
    userId: user.id,
    action: 'campaign.duplicated',
    entityType: 'campaign',
    entityId: newId,
    metadata: { from: source.id },
  });

  return jsonResponse({ success: true, campaign: { id: newId, publicCode } }, 201);
}

async function handleCampaignDelete(
  env: Env,
  user: AuthenticatedUser,
  campaignId: string,
): Promise<Response> {
  const businessIds = await getBusinessIds(user.id, env);
  const campaign = await findCampaignForUser(campaignId, businessIds, env);

  if (!campaign) return errorResponse('Campaign not found.', 404);

  const participations = await env.DB.prepare(
    `SELECT COUNT(*) AS total FROM participations WHERE campaign_id = ?`,
  )
    .bind(campaign.id)
    .first<{ total: number }>();

  const now = new Date().toISOString();

  if ((participations?.total ?? 0) > 0) {
    await env.DB.prepare(
      `UPDATE campaigns SET status = 'ARCHIVED', updated_at = ? WHERE id = ? AND business_id = ?`,
    )
      .bind(now, campaign.id, campaign.business_id)
      .run();
  } else {
    await env.DB.prepare(
      `DELETE FROM rewards WHERE campaign_id = ?`,
    )
      .bind(campaign.id)
      .run();
    await env.DB.prepare(
      `DELETE FROM campaigns WHERE id = ? AND business_id = ?`,
    )
      .bind(campaign.id, campaign.business_id)
      .run();
  }

  await writeAuditLog(env, {
    businessId: campaign.business_id,
    userId: user.id,
    action: 'campaign.deleted',
    entityType: 'campaign',
    entityId: campaign.id,
  });

  return jsonResponse({ success: true, archived: (participations?.total ?? 0) > 0 });
}

async function handleCampaignDetail(
  request: Request,
  env: Env,
  user: AuthenticatedUser,
  campaignId: string,
): Promise<Response> {
  const businessIds = await getBusinessIds(user.id, env);
  const campaign = await findCampaignForUser(campaignId, businessIds, env);

  if (!campaign) return errorResponse('Campaign not found.', 404);

  const [participants, coupons, rewards] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS total FROM participations WHERE campaign_id = ?`)
      .bind(campaignId)
      .first<{ total: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS total FROM coupons WHERE campaign_id = ?`)
      .bind(campaignId)
      .first<{ total: number }>(),
    loadRewards(env, campaignId),
  ]);

  return jsonResponse({
    success: true,
    campaign: {
      ...campaign,
      participant_count: participants?.total ?? 0,
      reward_count: rewards.length,
      redemption_count: coupons?.total ?? 0,
      rewards,
    },
  });
}

export async function handleCampaignRoute(
  request: Request,
  env: Env,
  user: AuthenticatedUser,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  try {
    if (path === CONFIG_PATH) {
      if (request.method === 'GET') return await handleConfigGet(request, env, user);
      if (request.method === 'PUT') return await handleConfigPut(request, env, user);
      return errorResponse('Method not allowed.', 405);
    }

    if (path === LIST_PATH) {
      if (request.method === 'GET') return await handleCampaignList(request, env, user);
      if (request.method === 'POST') return await handleCampaignCreate(request, env, user);
      return errorResponse('Method not allowed.', 405);
    }

    const duplicateMatch = DUPLICATE_PATTERN.exec(path);
    if (duplicateMatch?.[1]) {
      if (request.method === 'POST') return await handleCampaignDuplicate(request, env, user, duplicateMatch[1]);
      return errorResponse('Method not allowed.', 405);
    }

    const itemMatch = ITEM_PATTERN.exec(path);
    if (itemMatch?.[1]) {
      if (request.method === 'GET') return await handleCampaignDetail(request, env, user, itemMatch[1]);
      if (request.method === 'PATCH') return await handleCampaignPatch(request, env, user, itemMatch[1]);
      if (request.method === 'DELETE') return await handleCampaignDelete(env, user, itemMatch[1]);
      return errorResponse('Method not allowed.', 405);
    }

    return errorResponse('Route not found.', 404);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse('Validation failed.', 400, error.flatten());
    }

    console.error('Campaign route failed.', error);
    return errorResponse('Unable to process the campaign request.', 500);
  }
}
