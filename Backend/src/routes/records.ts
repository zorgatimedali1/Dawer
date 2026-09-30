import { z } from 'zod';
import { errorResponse, jsonResponse } from '../lib/http';
import { secureRandomHex } from '../lib/crypto';
import {
  couponListQuerySchema,
  customerListQuerySchema,
  qrCodeCreateSchema,
  qrCodePatchSchema,
  rewardPatchSchema,
} from '../lib/validation';
import {
  findCampaignForUser,
  getBusinessIds,
  writeAuditLog,
  type AuthenticatedUser,
} from '../lib/tenant';
import type { Env } from '../types';

const CUSTOMERS_PATH = '/api/business/customers';
const COUPONS_PATH = '/api/business/coupons';
const REWARDS_PATH = '/api/business/rewards';
const QR_PATH = '/api/business/qr-codes';

const CUSTOMER_ITEM = /^\/api\/business\/customers\/([^/]+)$/;
const COUPON_ITEM = /^\/api\/business\/coupons\/([^/]+)$/;
const COUPON_REDEEM = /^\/api\/business\/coupons\/([^/]+)\/redeem$/;
const REWARD_ITEM = /^\/api\/business\/rewards\/([^/]+)$/;
const QR_ITEM = /^\/api\/business\/qr-codes\/([^/]+)$/;

function placeholders(count: number): string {
  return new Array(count).fill('?').join(', ');
}

async function handleCustomerList(request: Request, env: Env, user: AuthenticatedUser): Promise<Response> {
  const url = new URL(request.url);
  const query = customerListQuerySchema.parse({
    search: url.searchParams.get('search') ?? undefined,
    campaignId: url.searchParams.get('campaignId') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });

  const businessIds = await getBusinessIds(user.id, env);
  if (businessIds.length === 0) {
    return jsonResponse({ success: true, customers: [], total: 0, page: query.page, limit: query.limit });
  }

  const params: unknown[] = [...businessIds];
  const clauses = [`c.business_id IN (${placeholders(businessIds.length)})`];

  if (query.search) {
    clauses.push(`(
      LOWER(COALESCE(c.first_name, '')) LIKE ? OR LOWER(COALESCE(c.last_name, '')) LIKE ?
      OR LOWER(COALESCE(c.email, '')) LIKE ? OR LOWER(COALESCE(c.phone, '')) LIKE ?
    )`);
    const like = `%${query.search.toLowerCase()}%`;
    params.push(like, like, like, like);
  }

  if (query.campaignId) {
    clauses.push(
      `EXISTS (SELECT 1 FROM participations p WHERE p.customer_id = c.id AND p.campaign_id = ?)`,
    );
    params.push(query.campaignId);
  }

  const where = clauses.join(' AND ');

  const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS total FROM customers c WHERE ${where}`)
    .bind(...params)
    .first<{ total: number }>();

  const rows = await env.DB.prepare(
    `SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.birthday,
            c.marketing_consent, c.created_at, c.updated_at, c.last_activity_at,
            (SELECT COUNT(*) FROM participations p WHERE p.customer_id = c.id) AS participation_count,
            (SELECT COUNT(*) FROM coupons cp WHERE cp.customer_id = c.id) AS coupon_count,
            (SELECT COUNT(*) FROM coupons cp WHERE cp.customer_id = c.id AND cp.status = 'REDEEMED') AS redeemed_count
     FROM customers c
     WHERE ${where}
     ORDER BY COALESCE(c.last_activity_at, c.created_at) DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(...params, query.limit, (query.page - 1) * query.limit)
    .all();

  return jsonResponse({
    success: true,
    customers: rows.results ?? [],
    total: totalRow?.total ?? 0,
    page: query.page,
    limit: query.limit,
  });
}

async function handleCustomerDetail(request: Request, env: Env, user: AuthenticatedUser, customerId: string): Promise<Response> {
  const businessIds = await getBusinessIds(user.id, env);
  if (businessIds.length === 0) return errorResponse('Customer not found.', 404);

  const customer = await env.DB.prepare(
    `SELECT id, first_name, last_name, email, phone, birthday, marketing_consent,
            created_at, updated_at, last_activity_at
     FROM customers
     WHERE id = ? AND business_id IN (${placeholders(businessIds.length)})
     LIMIT 1`,
  )
    .bind(customerId, ...businessIds)
    .first();

  if (!customer) return errorResponse('Customer not found.', 404);

  const [participations, coupons] = await Promise.all([
    env.DB.prepare(
      `SELECT p.id, p.campaign_id, c.name AS campaign_name, p.reward_id, r.name AS reward_name,
              p.result, p.created_at
       FROM participations p
       LEFT JOIN campaigns c ON c.id = p.campaign_id
       LEFT JOIN rewards r ON r.id = p.reward_id
       WHERE p.customer_id = ?
       ORDER BY p.created_at DESC
       LIMIT 50`,
    )
      .bind(customerId)
      .all(),
    env.DB.prepare(
      `SELECT id, campaign_id, reward_id, code, status, issued_at, expires_at, redeemed_at
       FROM coupons
       WHERE customer_id = ?
       ORDER BY issued_at DESC
       LIMIT 50`,
    )
      .bind(customerId)
      .all(),
  ]);

  return jsonResponse({
    success: true,
    customer,
    participations: participations.results ?? [],
    coupons: coupons.results ?? [],
  });
}

async function handleCouponList(request: Request, env: Env, user: AuthenticatedUser): Promise<Response> {
  const url = new URL(request.url);
  const query = couponListQuerySchema.parse({
    status: url.searchParams.get('status') ?? undefined,
    search: url.searchParams.get('search') ?? undefined,
    campaignId: url.searchParams.get('campaignId') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });

  const businessIds = await getBusinessIds(user.id, env);
  if (businessIds.length === 0) {
    return jsonResponse({ success: true, coupons: [], total: 0, page: query.page, limit: query.limit });
  }

  const now = new Date().toISOString();
  const params: unknown[] = [...businessIds];
  const clauses = [`cp.business_id IN (${placeholders(businessIds.length)})`];

  if (query.status === 'EXPIRED') {
    clauses.push(`cp.status = 'ISSUED' AND cp.expires_at IS NOT NULL AND cp.expires_at < ?`);
    params.push(now);
  } else if (query.status !== 'ALL') {
    clauses.push(`cp.status = ?`);
    params.push(query.status);
  }

  if (query.search) {
    clauses.push(`(
      LOWER(cp.code) LIKE ? OR LOWER(COALESCE(cu.first_name, '')) LIKE ?
      OR LOWER(COALESCE(cu.last_name, '')) LIKE ? OR LOWER(COALESCE(cu.email, '')) LIKE ?
    )`);
    const like = `%${query.search.toLowerCase()}%`;
    params.push(like, like, like, like);
  }

  if (query.campaignId) {
    clauses.push(`cp.campaign_id = ?`);
    params.push(query.campaignId);
  }

  const where = clauses.join(' AND ');

  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) AS total
     FROM coupons cp
     LEFT JOIN customers cu ON cu.id = cp.customer_id
     WHERE ${where}`,
  )
    .bind(...params)
    .first<{ total: number }>();

  const rows = await env.DB.prepare(
    `SELECT cp.id, cp.code, cp.status, cp.issued_at, cp.expires_at, cp.redeemed_at,
            cp.campaign_id, ca.name AS campaign_name,
            cp.reward_id, r.name AS reward_name, r.type AS reward_type, r.value AS reward_value,
            cp.customer_id, cu.first_name, cu.last_name, cu.email
     FROM coupons cp
     LEFT JOIN campaigns ca ON ca.id = cp.campaign_id
     LEFT JOIN rewards r ON r.id = cp.reward_id
     LEFT JOIN customers cu ON cu.id = cp.customer_id
     WHERE ${where}
     ORDER BY cp.issued_at DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(...params, query.limit, (query.page - 1) * query.limit)
    .all();

  return jsonResponse({
    success: true,
    coupons: rows.results ?? [],
    total: totalRow?.total ?? 0,
    page: query.page,
    limit: query.limit,
  });
}

async function handleCouponRedeem(request: Request, env: Env, user: AuthenticatedUser, couponId: string): Promise<Response> {
  const businessIds = await getBusinessIds(user.id, env);
  if (businessIds.length === 0) return errorResponse('Coupon not found.', 404);

  const coupon = await env.DB.prepare(
    `SELECT id, status, expires_at, business_id, campaign_id, reward_id, code, customer_id,
            issued_at, redeemed_at
     FROM coupons
     WHERE id = ? AND business_id IN (${placeholders(businessIds.length)})
     LIMIT 1`,
  )
    .bind(couponId, ...businessIds)
    .first<Record<string, unknown>>();

  if (!coupon) return errorResponse('Coupon not found.', 404);
  if (coupon.status === 'REDEEMED') {
    return errorResponse('This coupon has already been redeemed.', 409);
  }
  if (coupon.expires_at && String(coupon.expires_at) < new Date().toISOString()) {
    return errorResponse('This coupon has expired.', 410);
  }

  const now = new Date().toISOString();
  await env.DB.prepare(`UPDATE coupons SET status = 'REDEEMED', redeemed_at = ? WHERE id = ?`)
    .bind(now, couponId)
    .run();

  await env.DB.prepare(
    `INSERT INTO analytics_events (id, business_id, campaign_id, event_type, event_data, created_at)
     VALUES (?, ?, ?, 'COUPON_REDEEMED', ?, ?)`,
  )
    .bind(crypto.randomUUID(), coupon.business_id, coupon.campaign_id, JSON.stringify({ couponId }), now)
    .run();

  await writeAuditLog(env, {
    businessId: String(coupon.business_id),
    userId: user.id,
    action: 'coupon.redeemed',
    entityType: 'coupon',
    entityId: couponId,
  });

  return jsonResponse({
    success: true,
    coupon: { ...coupon, status: 'REDEEMED', redeemed_at: now },
  });
}

async function handleRewardList(request: Request, env: Env, user: AuthenticatedUser): Promise<Response> {
  const url = new URL(request.url);
  const campaignId = url.searchParams.get('campaignId') ?? undefined;
  const search = url.searchParams.get('search') ?? undefined;
  const active = url.searchParams.get('active');

  const businessIds = await getBusinessIds(user.id, env);
  if (businessIds.length === 0) {
    return jsonResponse({ success: true, rewards: [] });
  }

  const params: unknown[] = [...businessIds];
  const clauses = [`r.business_id IN (${placeholders(businessIds.length)})`];

  if (campaignId) {
    clauses.push('r.campaign_id = ?');
    params.push(campaignId);
  }
  if (search) {
    clauses.push(`(LOWER(r.name) LIKE ? OR LOWER(COALESCE(r.description, '')) LIKE ?)`);
    const like = `%${search.toLowerCase()}%`;
    params.push(like, like);
  }
  if (active === 'true' || active === 'false') {
    clauses.push('r.active = ?');
    params.push(active === 'true' ? 1 : 0);
  }

  const rows = await env.DB.prepare(
    `SELECT r.id, r.campaign_id, ca.name AS campaign_name, r.name, r.type, r.value, r.description,
            r.quantity, r.quantity_initial, r.weight, r.active, r.created_at, r.updated_at,
            (SELECT COUNT(*) FROM coupons cp WHERE cp.reward_id = r.id) AS issued_count
     FROM rewards r
     LEFT JOIN campaigns ca ON ca.id = r.campaign_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY r.weight DESC, r.created_at ASC`,
  )
    .bind(...params)
    .all();

  return jsonResponse({ success: true, rewards: rows.results ?? [] });
}

async function handleRewardPatch(request: Request, env: Env, user: AuthenticatedUser, rewardId: string): Promise<Response> {
  const input = rewardPatchSchema.parse(await request.json());
  const businessIds = await getBusinessIds(user.id, env);
  if (businessIds.length === 0) return errorResponse('Reward not found.', 404);

  const reward = await env.DB.prepare(
    `SELECT id, business_id, campaign_id FROM rewards
     WHERE id = ? AND business_id IN (${placeholders(businessIds.length)})
     LIMIT 1`,
  )
    .bind(rewardId, ...businessIds)
    .first<{ id: string; business_id: string }>();

  if (!reward) return errorResponse('Reward not found.', 404);

  const updates: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) { updates.push('name = ?'); params.push(input.name); }
  if (input.description !== undefined) { updates.push('description = ?'); params.push(input.description); }
  if (input.active !== undefined) { updates.push('active = ?'); params.push(input.active ? 1 : 0); }
  if (input.quantity !== undefined) { updates.push('quantity = ?'); params.push(input.quantity); }
  if (input.weight !== undefined) { updates.push('weight = ?'); params.push(input.weight); }

  updates.push('updated_at = ?');
  params.push(new Date().toISOString());

  await env.DB.prepare(`UPDATE rewards SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...params, rewardId)
    .run();

  await writeAuditLog(env, {
    businessId: reward.business_id,
    userId: user.id,
    action: 'reward.updated',
    entityType: 'reward',
    entityId: rewardId,
    metadata: input,
  });

  const updated = await env.DB.prepare(
    `SELECT r.id, r.campaign_id, ca.name AS campaign_name, r.name, r.type, r.value, r.description,
            r.quantity, r.quantity_initial, r.weight, r.active, r.created_at, r.updated_at,
            (SELECT COUNT(*) FROM coupons cp WHERE cp.reward_id = r.id) AS issued_count
     FROM rewards r
     LEFT JOIN campaigns ca ON ca.id = r.campaign_id
     WHERE r.id = ? LIMIT 1`,
  )
    .bind(rewardId)
    .first();

  return jsonResponse({ success: true, reward: updated ?? null });
}

async function handleQrList(request: Request, env: Env, user: AuthenticatedUser): Promise<Response> {
  const url = new URL(request.url);
  const campaignId = url.searchParams.get('campaignId') ?? undefined;

  const businessIds = await getBusinessIds(user.id, env);
  if (businessIds.length === 0) return jsonResponse({ success: true, qrCodes: [] });

  const params: unknown[] = [...businessIds];
  const clauses = [`q.business_id IN (${placeholders(businessIds.length)})`];

  if (campaignId) {
    clauses.push('q.campaign_id = ?');
    params.push(campaignId);
  }

  const rows = await env.DB.prepare(
    `SELECT q.id, q.campaign_id, ca.name AS campaign_name, ca.public_code AS campaign_public_code,
            q.public_code, q.name, q.location, q.active, q.created_at,
            (SELECT COUNT(*) FROM participations p WHERE p.campaign_id = q.campaign_id) AS campaign_participations
     FROM qr_codes q
     LEFT JOIN campaigns ca ON ca.id = q.campaign_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY q.created_at DESC`,
  )
    .bind(...params)
    .all();

  return jsonResponse({ success: true, qrCodes: rows.results ?? [] });
}

async function handleQrCreate(request: Request, env: Env, user: AuthenticatedUser): Promise<Response> {
  const input = qrCodeCreateSchema.parse(await request.json());
  const businessIds = await getBusinessIds(user.id, env);
  const campaign = await findCampaignForUser(input.campaignId, businessIds, env);

  if (!campaign) return errorResponse('Campaign not found.', 404);

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const publicCode = secureRandomHex(8).toUpperCase();

  await env.DB.prepare(
    `INSERT INTO qr_codes (id, business_id, campaign_id, public_code, name, location, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
  )
    .bind(id, campaign.business_id, campaign.id, publicCode, input.name, input.location, now)
    .run();

  await writeAuditLog(env, {
    businessId: campaign.business_id,
    userId: user.id,
    action: 'qr_code.created',
    entityType: 'qr_code',
    entityId: id,
  });

  const created = await env.DB.prepare(
    `SELECT q.id, q.campaign_id, ca.name AS campaign_name, ca.public_code AS campaign_public_code,
            q.public_code, q.name, q.location, q.active, q.created_at
     FROM qr_codes q
     LEFT JOIN campaigns ca ON ca.id = q.campaign_id
     WHERE q.id = ? LIMIT 1`,
  )
    .bind(id)
    .first();

  return jsonResponse({ success: true, qrCode: created ?? null }, 201);
}

async function handleQrPatch(request: Request, env: Env, user: AuthenticatedUser, qrId: string): Promise<Response> {
  const input = qrCodePatchSchema.parse(await request.json());
  const businessIds = await getBusinessIds(user.id, env);
  if (businessIds.length === 0) return errorResponse('QR code not found.', 404);

  const qrCode = await env.DB.prepare(
    `SELECT id FROM qr_codes WHERE id = ? AND business_id IN (${placeholders(businessIds.length)}) LIMIT 1`,
  )
    .bind(qrId, ...businessIds)
    .first();

  if (!qrCode) return errorResponse('QR code not found.', 404);

  const updates: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) { updates.push('name = ?'); params.push(input.name); }
  if (input.location !== undefined) { updates.push('location = ?'); params.push(input.location); }
  if (input.active !== undefined) { updates.push('active = ?'); params.push(input.active ? 1 : 0); }

  if (updates.length > 0) {
    await env.DB.prepare(`UPDATE qr_codes SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...params, qrId)
      .run();
  }

  const updated = await env.DB.prepare(
    `SELECT q.id, q.campaign_id, ca.name AS campaign_name, ca.public_code AS campaign_public_code,
            q.public_code, q.name, q.location, q.active, q.created_at
     FROM qr_codes q
     LEFT JOIN campaigns ca ON ca.id = q.campaign_id
     WHERE q.id = ? LIMIT 1`,
  )
    .bind(qrId)
    .first();

  return jsonResponse({ success: true, qrCode: updated ?? null });
}

/**
 * Tenant-scoped reads (and small writes) for the records the dashboard needs:
 * customers, coupons, rewards and QR codes.
 */
export async function handleRecordRoute(
  request: Request,
  env: Env,
  user: AuthenticatedUser,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  try {
    const couponRedeem = COUPON_REDEEM.exec(path);
    if (couponRedeem?.[1]) {
      if (request.method === 'POST') return await handleCouponRedeem(request, env, user, couponRedeem[1]);
      return errorResponse('Method not allowed.', 405);
    }

    const customerItem = CUSTOMER_ITEM.exec(path);
    if (customerItem?.[1]) {
      if (request.method === 'GET') return await handleCustomerDetail(request, env, user, customerItem[1]);
      return errorResponse('Method not allowed.', 405);
    }

    const couponItem = COUPON_ITEM.exec(path);
    if (couponItem?.[1]) {
      return errorResponse('Method not allowed.', 405);
    }

    const rewardItem = REWARD_ITEM.exec(path);
    if (rewardItem?.[1]) {
      if (request.method === 'PATCH') return await handleRewardPatch(request, env, user, rewardItem[1]);
      return errorResponse('Method not allowed.', 405);
    }

    const qrItem = QR_ITEM.exec(path);
    if (qrItem?.[1]) {
      if (request.method === 'PATCH') return await handleQrPatch(request, env, user, qrItem[1]);
      return errorResponse('Method not allowed.', 405);
    }

    if (path === CUSTOMERS_PATH) {
      if (request.method === 'GET') return await handleCustomerList(request, env, user);
      return errorResponse('Method not allowed.', 405);
    }

    if (path === COUPONS_PATH) {
      if (request.method === 'GET') return await handleCouponList(request, env, user);
      return errorResponse('Method not allowed.', 405);
    }

    if (path === REWARDS_PATH) {
      if (request.method === 'GET') return await handleRewardList(request, env, user);
      return errorResponse('Method not allowed.', 405);
    }

    if (path === QR_PATH) {
      if (request.method === 'GET') return await handleQrList(request, env, user);
      if (request.method === 'POST') return await handleQrCreate(request, env, user);
      return errorResponse('Method not allowed.', 405);
    }

    return errorResponse('Route not found.', 404);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse('Validation failed.', 400, error.flatten());
    }

    console.error('Record route failed.', error);
    return errorResponse('Unable to process the request.', 500);
  }
}
