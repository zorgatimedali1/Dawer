import { z } from 'zod';
import { errorResponse, jsonResponse } from '../lib/http';
import { secureRandomHex } from '../lib/crypto';
import {
  ensureNoWinSlice,
  restoreDeactivatedWeightFromNoWin,
  transferDeactivatedWeightToNoWin,
} from '../lib/reward';
import { markAnalyticsDirtySafe } from '../lib/analytics-cache';
import { invalidateWheelRewardsCache } from '../lib/wheel-rewards-cache';
import {
  couponListQuerySchema,
  couponUpdateSchema,
  customerListQuerySchema,
  posterCreateSchema,
  posterPatchSchema,
  qrCodeCreateSchema,
  qrCodePatchSchema,
  rewardPatchSchema,
} from '../lib/validation';
import {
  findCampaignForUser,
  getBusinessIds,
  getPrimaryBusinessId,
  writeAuditLog,
  type AuthenticatedUser,
} from '../lib/tenant';
import { getBusinessAccess } from '../lib/subscription-access';
import { campaignStatsAllowed } from '../lib/subscription-limits';
import type { Env } from '../types';

const CUSTOMERS_PATH = '/api/business/customers';
const COUPONS_PATH = '/api/business/coupons';
const REWARDS_PATH = '/api/business/rewards';
const QR_PATH = '/api/business/qr-codes';
const POSTERS_PATH = '/api/business/posters';

const CUSTOMER_ITEM = /^\/api\/business\/customers\/([^/]+)$/;
const COUPON_ITEM = /^\/api\/business\/coupons\/([^/]+)$/;
const COUPON_REDEEM = /^\/api\/business\/coupons\/([^/]+)\/redeem$/;
const COUPON_DELETE = /^\/api\/business\/coupons\/([^/]+)$/;
const REWARD_ITEM = /^\/api\/business\/rewards\/([^/]+)$/;
const QR_ITEM = /^\/api\/business\/qr-codes\/([^/]+)$/;
const POSTER_ITEM = /^\/api\/business\/posters\/([^/]+)$/;

function placeholders(count: number): string {
  return new Array(count).fill('?').join(', ');
}

/** Participation stats shared with the QR/poster payloads ride the analytics entitlement. */
async function campaignStatsAllowedFor(env: Env, user: AuthenticatedUser): Promise<boolean> {
  const primaryBusinessId = await getPrimaryBusinessId(user.id, env);
  if (!primaryBusinessId) return false;
  const access = await getBusinessAccess(env, primaryBusinessId);
  return campaignStatsAllowed(access);
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
  const clauses = [
    `c.business_id IN (${placeholders(businessIds.length)})`,
    `TRIM(COALESCE(c.first_name, '')) <> ''`,
    `TRIM(COALESCE(c.phone, '')) <> ''`,
  ];

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
            (SELECT COUNT(*) FROM coupons cp WHERE cp.customer_id = c.id AND cp.status <> 'DELETED') AS coupon_count,
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
      `SELECT cp.id, cp.campaign_id, cp.reward_id, r.name AS reward_name,
          ca.name AS campaign_name, cp.code, cp.status, cp.issued_at, cp.expires_at, cp.redeemed_at
       FROM coupons cp
       LEFT JOIN rewards r ON r.id = cp.reward_id
       LEFT JOIN campaigns ca ON ca.id = cp.campaign_id
      WHERE cp.customer_id = ? AND cp.status <> 'DELETED'
       ORDER BY cp.issued_at DESC
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
  const clauses = [
    `cp.business_id IN (${placeholders(businessIds.length)})`,
    `cp.status <> 'DELETED'`,
    // A coupon is only ever issued once its winner is known; legacy rows
    // written before that rule stay stored but stay out of the list.
    `cp.customer_id IS NOT NULL`,
  ];

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
  if (coupon.status === 'DELETED') return errorResponse('Coupon not found.', 404);
  if (coupon.status === 'REDEEMED') {
    return errorResponse('This coupon has already been redeemed.', 409);
  }
  if (coupon.expires_at && String(coupon.expires_at) < new Date().toISOString()) {
    return errorResponse('This coupon has expired.', 410);
  }

  const now = new Date().toISOString();
  // Compare-and-swap: only the request that flips ISSUED → REDEEMED records
  // the redemption, so concurrent clicks can't double-count or double-stamp.
  const updated = await env.DB.prepare(
    `UPDATE coupons SET status = 'REDEEMED', redeemed_at = ?
     WHERE id = ? AND status = 'ISSUED' AND (expires_at IS NULL OR expires_at >= ?)`,
  )
    .bind(now, couponId, now)
    .run();

  if (Number(updated.meta.changes ?? 0) === 0) {
    const latest = await env.DB.prepare(`SELECT status, expires_at FROM coupons WHERE id = ? LIMIT 1`)
      .bind(couponId)
      .first<{ status: string; expires_at: string | null }>();
    if (!latest || latest.status === 'DELETED') return errorResponse('Coupon not found.', 404);
    if (latest.status === 'REDEEMED') return errorResponse('This coupon has already been redeemed.', 409);
    if (latest.expires_at && latest.expires_at < now) return errorResponse('This coupon has expired.', 410);
    return errorResponse('This coupon has already been redeemed.', 409);
  }

  await env.DB.prepare(
    `INSERT INTO analytics_events (id, business_id, campaign_id, event_type, event_data, created_at)
     VALUES (?, ?, ?, 'COUPON_REDEEMED', ?, ?)`,
  )
    .bind(crypto.randomUUID(), coupon.business_id, coupon.campaign_id, JSON.stringify({ couponId }), now)
    .run();

  void markAnalyticsDirtySafe(env, String(coupon.business_id));

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

async function handleCouponUpdate(request: Request, env: Env, user: AuthenticatedUser, couponId: string): Promise<Response> {
  const input = couponUpdateSchema.parse(await request.json());
  const businessIds = await getBusinessIds(user.id, env);
  if (businessIds.length === 0) return errorResponse('Coupon not found.', 404);

  const coupon = await env.DB.prepare(
    `SELECT id, status, expires_at, redeemed_at, business_id, campaign_id
     FROM coupons
     WHERE id = ? AND business_id IN (${placeholders(businessIds.length)})
     LIMIT 1`,
  )
    .bind(couponId, ...businessIds)
    .first<{ id: string; status: string; expires_at: string | null; redeemed_at: string | null; business_id: string; campaign_id: string }>();

  if (!coupon) return errorResponse('Coupon not found.', 404);
  if (coupon.status === 'DELETED') return errorResponse('Coupon not found.', 404);

  const now = new Date().toISOString();
  if (input.expiresAt && Date.parse(input.expiresAt) <= Date.now()) {
    return errorResponse('The new deadline must be in the future.', 400);
  }

  // `expiresAt: null` clears the deadline; omitted (`undefined`) leaves it.
  const nextExpiresAt =
    input.expiresAt !== undefined ? input.expiresAt : coupon.expires_at;

  // A redeemed coupon can never go back to ISSUED (that would let a PATCH
  // un-redeem it and re-count the redemption in analytics); only its deadline
  // may still be adjusted.
  if (coupon.status === 'REDEEMED') {
    if (input.status === 'ISSUED') {
      return errorResponse('This coupon has already been redeemed.', 409);
    }
    await env.DB.prepare(
      `UPDATE coupons SET expires_at = ? WHERE id = ? AND business_id = ? AND status = 'REDEEMED'`,
    )
      .bind(nextExpiresAt, couponId, coupon.business_id)
      .run();
    await writeAuditLog(env, {
      businessId: String(coupon.business_id),
      userId: user.id,
      action: 'coupon.updated',
      entityType: 'coupon',
      entityId: couponId,
      metadata: input,
    });
    return jsonResponse({
      success: true,
      coupon: { ...coupon, expires_at: nextExpiresAt },
    });
  }

  const nextStatus = input.status ?? coupon.status;

  // Marking redeemed through PATCH must honour the same expiry rule as the
  // dedicated redeem endpoint.
  if (nextStatus === 'REDEEMED' && nextExpiresAt && String(nextExpiresAt) < now) {
    return errorResponse('This coupon has expired.', 410);
  }

  const redeemedAt = nextStatus === 'REDEEMED' ? now : null;
  const expiresAt = nextExpiresAt;

  // Compare-and-swap on ISSUED → REDEEMED so concurrent PATCHes record the
  // transition (and its analytics event) exactly once, like handleCouponRedeem.
  const updated =
    nextStatus === 'REDEEMED'
      ? await env.DB.prepare(
          `UPDATE coupons SET status = 'REDEEMED', redeemed_at = ?, expires_at = ?
           WHERE id = ? AND business_id = ? AND status = 'ISSUED' AND (expires_at IS NULL OR expires_at >= ?)`,
        )
          .bind(redeemedAt, expiresAt, couponId, coupon.business_id, now)
          .run()
      : await env.DB.prepare(
          `UPDATE coupons SET status = ?, redeemed_at = ?, expires_at = ? WHERE id = ? AND business_id = ? AND status = 'ISSUED'`,
        )
          .bind(nextStatus, redeemedAt, expiresAt, couponId, coupon.business_id)
          .run();

  if (Number(updated.meta.changes ?? 0) === 0) {
    return errorResponse('This coupon has already been redeemed.', 409);
  }

  if (nextStatus === 'REDEEMED') {
    await env.DB.prepare(
      `INSERT INTO analytics_events (id, business_id, campaign_id, event_type, event_data, created_at)
       VALUES (?, ?, ?, 'COUPON_REDEEMED', ?, ?)`,
    )
      .bind(crypto.randomUUID(), coupon.business_id, coupon.campaign_id, JSON.stringify({ couponId }), now)
      .run();

    void markAnalyticsDirtySafe(env, String(coupon.business_id));
  }

  await writeAuditLog(env, {
    businessId: String(coupon.business_id),
    userId: user.id,
    action: 'coupon.updated',
    entityType: 'coupon',
    entityId: couponId,
    metadata: input,
  });

  return jsonResponse({
    success: true,
    coupon: { ...coupon, status: nextStatus, redeemed_at: redeemedAt, expires_at: expiresAt },
  });
}

async function handleCouponDelete(env: Env, user: AuthenticatedUser, couponId: string): Promise<Response> {
  const businessIds = await getBusinessIds(user.id, env);
  if (businessIds.length === 0) return errorResponse('Coupon not found.', 404);

  const coupon = await env.DB.prepare(
    `SELECT id, status, business_id FROM coupons
     WHERE id = ? AND business_id IN (${placeholders(businessIds.length)})
     LIMIT 1`,
  )
    .bind(couponId, ...businessIds)
    .first<{ id: string; status: string; business_id: string }>();

  if (!coupon || coupon.status === 'DELETED') return errorResponse('Coupon not found.', 404);
  if (coupon.status !== 'REDEEMED') {
    return errorResponse('Only prizes given to the customer can be deleted.', 409);
  }

  await env.DB.prepare(`UPDATE coupons SET status = 'DELETED' WHERE id = ? AND status = 'REDEEMED'`)
    .bind(couponId)
    .run();

  await writeAuditLog(env, {
    businessId: coupon.business_id,
    userId: user.id,
    action: 'coupon.deleted',
    entityType: 'coupon',
    entityId: couponId,
  });

  return jsonResponse({ success: true });
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
     ORDER BY r.weight DESC, r.created_at ASC
     LIMIT 500`,
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
    `SELECT id, business_id, campaign_id, type, quantity_initial, weight, stored_weight, active FROM rewards
     WHERE id = ? AND business_id IN (${placeholders(businessIds.length)})
     LIMIT 1`,
  )
    .bind(rewardId, ...businessIds)
    .first<{
      id: string;
      business_id: string;
      campaign_id: string;
      type: string;
      quantity_initial: number | null;
      weight: number;
      stored_weight: number;
      active: number;
    }>();

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

  await env.DB.prepare(`UPDATE rewards SET ${updates.join(', ')} WHERE id = ? AND business_id = ?`)
    .bind(...params, rewardId, reward.business_id)
    .run();

  // A merchant emptying a capped reward's stock is exactly the sold-out case:
  // its weight now flows to the "Prochaine fois" slice on the customer wheel,
  // which needs switching on if it was still deactivated.
  const emptiedStock =
    input.quantity !== undefined &&
    input.quantity <= 0 &&
    Number(reward.quantity_initial ?? 0) > 0 &&
    reward.type !== 'none';
  if (emptiedStock) {
    await ensureNoWinSlice(env, reward.campaign_id);
  }

  // Deactivating a prize hands its stored weight to the "Prochaine fois"
  // slice — activating it when it was off, topping it up otherwise — so the
  // freed percentage lands where the disabled prize used to be instead of
  // silently renormalizing across the remaining prizes.
  if (input.active === false && reward.type !== 'none') {
    await transferDeactivatedWeightToNoWin(env, reward.campaign_id, reward.id, Number(reward.weight ?? 0));
  }

  // Re-activating hands the remembered percentage back out of the "Prochaine
  // fois" slice, which shrinks again (and goes back to deactivated once it
  // holds nothing).
  if (input.active === true && reward.type !== 'none') {
    await restoreDeactivatedWeightFromNoWin(env, reward.campaign_id, reward.id, Number(reward.stored_weight ?? 0));
  }

  // The customer wheel display just changed (weight, stock or active state):
  // drop the cached payload so the next GET recomputes from D1.
  void invalidateWheelRewardsCache(env, reward.campaign_id);

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

async function handleRewardDelete(env: Env, user: AuthenticatedUser, rewardId: string): Promise<Response> {
  const businessIds = await getBusinessIds(user.id, env);
  if (businessIds.length === 0) return errorResponse('Reward not found.', 404);

  const reward = await env.DB.prepare(
    `SELECT id, business_id, campaign_id FROM rewards
     WHERE id = ? AND business_id IN (${placeholders(businessIds.length)})
     LIMIT 1`,
  )
    .bind(rewardId, ...businessIds)
    .first<{ id: string; business_id: string; campaign_id: string }>();

  if (!reward) return errorResponse('Reward not found.', 404);

  await env.DB.prepare('DELETE FROM rewards WHERE id = ?').bind(rewardId).run();

  void invalidateWheelRewardsCache(env, reward.campaign_id);

  await writeAuditLog(env, {
    businessId: reward.business_id,
    userId: user.id,
    action: 'reward.deleted',
    entityType: 'reward',
    entityId: rewardId,
  });

  return jsonResponse({ success: true, id: rewardId });
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

  // Archived campaigns are soft-deleted: their public landing refuses visitors,
  // so their QR tiles leave the QR codes interface. Same for orphaned rows
  // after a hard delete — the INNER JOIN drops both.
  const rows = await env.DB.prepare(
    `SELECT q.id, q.campaign_id, ca.name AS campaign_name, ca.public_code AS campaign_public_code,
            q.public_code, q.name, q.location, q.active, q.created_at,
            (SELECT COUNT(*) FROM participations p WHERE p.campaign_id = q.campaign_id) AS campaign_participations
     FROM qr_codes q
     JOIN campaigns ca ON ca.id = q.campaign_id AND ca.status <> 'ARCHIVED'
     WHERE ${clauses.join(' AND ')}
     ORDER BY q.created_at DESC
     LIMIT 500`,
  )
    .bind(...params)
    .all();

  const statsAllowed = await campaignStatsAllowedFor(env, user);
  return jsonResponse({
    success: true,
    qrCodes: (rows.results ?? []).map((row) =>
      statsAllowed ? row : { ...row, campaign_participations: null },
    ),
  });
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
            (SELECT COUNT(*) FROM participations p WHERE p.campaign_id = q.campaign_id) AS campaign_participations,
            q.public_code, q.name, q.location, q.active, q.created_at
     FROM qr_codes q
     LEFT JOIN campaigns ca ON ca.id = q.campaign_id
     WHERE q.id = ? LIMIT 1`,
  )
    .bind(id)
    .first();

  const statsAllowed = await campaignStatsAllowedFor(env, user);
  const qrCode = created && !statsAllowed ? { ...created, campaign_participations: null } : (created ?? null);
  return jsonResponse({ success: true, qrCode }, 201);
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
    await env.DB.prepare(
      `UPDATE qr_codes SET ${updates.join(', ')} WHERE id = ? AND business_id IN (${placeholders(businessIds.length)})`,
    )
      .bind(...params, qrId, ...businessIds)
      .run();
  }

  const updated = await env.DB.prepare(
    `SELECT q.id, q.campaign_id, ca.name AS campaign_name, ca.public_code AS campaign_public_code,
            (SELECT COUNT(*) FROM participations p WHERE p.campaign_id = q.campaign_id) AS campaign_participations,
            q.public_code, q.name, q.location, q.active, q.created_at
     FROM qr_codes q
     LEFT JOIN campaigns ca ON ca.id = q.campaign_id
     WHERE q.id = ? LIMIT 1`,
  )
    .bind(qrId)
    .first();

  const statsAllowed = await campaignStatsAllowedFor(env, user);
  const masked = updated && !statsAllowed ? { ...updated, campaign_participations: null } : (updated ?? null);
  return jsonResponse({ success: true, qrCode: masked });
}

const POSTER_COLUMNS = `p.id, p.campaign_id, ca.name AS campaign_name, ca.public_code AS campaign_public_code,
  p.template, p.title, p.subtitle, p.theme, p.configuration, p.created_at, p.updated_at`;

async function handlePosterList(request: Request, env: Env, user: AuthenticatedUser): Promise<Response> {
  const url = new URL(request.url);
  const campaignId = url.searchParams.get('campaignId') ?? undefined;

  const businessIds = await getBusinessIds(user.id, env);
  if (businessIds.length === 0) return jsonResponse({ success: true, posters: [] });

  const params: unknown[] = [...businessIds];
  const clauses = [`p.business_id IN (${placeholders(businessIds.length)})`];

  if (campaignId) {
    clauses.push('p.campaign_id = ?');
    params.push(campaignId);
  }

  const rows = await env.DB.prepare(
    `SELECT ${POSTER_COLUMNS}
     FROM posters p
     LEFT JOIN campaigns ca ON ca.id = p.campaign_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY p.updated_at DESC
     LIMIT 500`,
  )
    .bind(...params)
    .all();

  return jsonResponse({ success: true, posters: rows.results ?? [] });
}

async function handlePosterCreate(request: Request, env: Env, user: AuthenticatedUser): Promise<Response> {
  const input = posterCreateSchema.parse(await request.json());
  const businessIds = await getBusinessIds(user.id, env);
  const campaign = await findCampaignForUser(input.campaignId, businessIds, env);

  if (!campaign) return errorResponse('Campaign not found.', 404);

  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO posters (id, business_id, campaign_id, template, title, subtitle, theme, configuration, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      campaign.business_id,
      campaign.id,
      input.template,
      input.title,
      input.subtitle,
      input.theme,
      input.configuration ? JSON.stringify(input.configuration) : null,
      now,
      now,
    )
    .run();

  await writeAuditLog(env, {
    businessId: campaign.business_id,
    userId: user.id,
    action: 'poster.created',
    entityType: 'poster',
    entityId: id,
  });

  const created = await env.DB.prepare(
    `SELECT ${POSTER_COLUMNS} FROM posters p LEFT JOIN campaigns ca ON ca.id = p.campaign_id WHERE p.id = ? LIMIT 1`,
  )
    .bind(id)
    .first();

  return jsonResponse({ success: true, poster: created ?? null }, 201);
}

async function handlePosterPatch(request: Request, env: Env, user: AuthenticatedUser, posterId: string): Promise<Response> {
  const input = posterPatchSchema.parse(await request.json());
  const businessIds = await getBusinessIds(user.id, env);
  if (businessIds.length === 0) return errorResponse('Poster not found.', 404);

  const poster = await env.DB.prepare(
    `SELECT id, business_id FROM posters
     WHERE id = ? AND business_id IN (${placeholders(businessIds.length)})
     LIMIT 1`,
  )
    .bind(posterId, ...businessIds)
    .first<{ id: string; business_id: string }>();

  if (!poster) return errorResponse('Poster not found.', 404);

  const updates: string[] = [];
  const params: unknown[] = [];

  if (input.template !== undefined) { updates.push('template = ?'); params.push(input.template); }
  if (input.title !== undefined) { updates.push('title = ?'); params.push(input.title); }
  if (input.subtitle !== undefined) { updates.push('subtitle = ?'); params.push(input.subtitle); }
  if (input.theme !== undefined) { updates.push('theme = ?'); params.push(input.theme); }
  if (input.configuration !== undefined) {
    updates.push('configuration = ?');
    params.push(JSON.stringify(input.configuration));
  }

  updates.push('updated_at = ?');
  params.push(new Date().toISOString());

  await env.DB.prepare(`UPDATE posters SET ${updates.join(', ')} WHERE id = ? AND business_id = ?`)
    .bind(...params, posterId, poster.business_id)
    .run();

  await writeAuditLog(env, {
    businessId: poster.business_id,
    userId: user.id,
    action: 'poster.updated',
    entityType: 'poster',
    entityId: posterId,
    metadata: input,
  });

  const updated = await env.DB.prepare(
    `SELECT ${POSTER_COLUMNS} FROM posters p LEFT JOIN campaigns ca ON ca.id = p.campaign_id WHERE p.id = ? LIMIT 1`,
  )
    .bind(posterId)
    .first();

  return jsonResponse({ success: true, poster: updated ?? null });
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

    const couponDelete = COUPON_DELETE.exec(path);
    if (couponDelete?.[1] && request.method === 'DELETE') {
      return await handleCouponDelete(env, user, couponDelete[1]);
    }

    const customerItem = CUSTOMER_ITEM.exec(path);
    if (customerItem?.[1]) {
      if (request.method === 'GET') return await handleCustomerDetail(request, env, user, customerItem[1]);
      return errorResponse('Method not allowed.', 405);
    }

    const couponItem = COUPON_ITEM.exec(path);
    if (couponItem?.[1]) {
      if (request.method === 'PATCH') return await handleCouponUpdate(request, env, user, couponItem[1]);
      return errorResponse('Method not allowed.', 405);
    }

    const rewardItem = REWARD_ITEM.exec(path);
    if (rewardItem?.[1]) {
      if (request.method === 'PATCH') return await handleRewardPatch(request, env, user, rewardItem[1]);
      if (request.method === 'DELETE') return await handleRewardDelete(env, user, rewardItem[1]);
      return errorResponse('Method not allowed.', 405);
    }

    const qrItem = QR_ITEM.exec(path);
    if (qrItem?.[1]) {
      if (request.method === 'PATCH') return await handleQrPatch(request, env, user, qrItem[1]);
      return errorResponse('Method not allowed.', 405);
    }

    const posterItem = POSTER_ITEM.exec(path);
    if (posterItem?.[1]) {
      if (request.method === 'PATCH') return await handlePosterPatch(request, env, user, posterItem[1]);
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

    if (path === POSTERS_PATH) {
      if (request.method === 'GET') return await handlePosterList(request, env, user);
      if (request.method === 'POST') return await handlePosterCreate(request, env, user);
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
