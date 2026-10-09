import { errorResponse, jsonResponse } from '../../lib/http';
import { approveSubscriptionSchema, adminSuspendSchema, subscriptionRequestListQuerySchema } from '../../lib/validation';
import { writeAuditLog } from '../../lib/tenant';
import { renderRouteError, requireOperator } from '../lib/guard';
import type { Env } from '../../types';

const REQUESTS_PATH = '/api/admin/subscriptions/requests';

type RequestRow = {
  id: string;
  status: string;
  duration_days: number | null;
  reject_reason: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  user_id: string;
  business_id: string;
  plan_id: string;
  email: string;
  business_name: string | null;
  plan_name: string;
  plan_slug: string;
  price_cents: number;
  interval: string;
};

const REQUEST_SELECT = `
  SELECT r.id, r.status, r.duration_days, r.reject_reason, r.created_at, r.resolved_at, r.resolved_by,
         r.user_id, r.business_id, r.plan_id,
         u.email,
         b.name AS business_name,
         p.name AS plan_name, p.slug AS plan_slug, p.price_cents, p.interval
  FROM subscription_requests r
  JOIN users u ON u.id = r.user_id
  JOIN businesses b ON b.id = r.business_id
  JOIN plans p ON p.id = r.plan_id`;

function describeRequest(row: RequestRow) {
  return {
    id: row.id,
    status: row.status,
    durationDays: row.duration_days,
    rejectReason: row.reject_reason,
    requestedAt: row.created_at,
    resolvedAt: row.resolved_at,
    userId: row.user_id,
    businessId: row.business_id,
    email: row.email,
    businessName: row.business_name,
    plan: { name: row.plan_name, slug: row.plan_slug },
    priceCents: row.price_cents,
    interval: row.interval,
  };
}

async function listRequests(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const query = subscriptionRequestListQuerySchema.parse({
    search: url.searchParams.get('search') ?? '',
    status: url.searchParams.get('status') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });

  const conditions: string[] = [];
  const binds: string[] = [];

  if (query.search) {
    conditions.push('(u.email LIKE ? OR b.name LIKE ?)');
    const pattern = `%${query.search}%`;
    binds.push(pattern, pattern);
  }

  if (query.status) {
    conditions.push('r.status = ?');
    binds.push(query.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) AS total FROM subscription_requests r
     JOIN users u ON u.id = r.user_id
     JOIN businesses b ON b.id = r.business_id
     ${where}`,
  )
    .bind(...binds)
    .first<{ total: number }>();

  const total = totalRow?.total ?? 0;
  const offset = (query.page - 1) * query.limit;

  const rows = await env.DB.prepare(
    `${REQUEST_SELECT}
     ${where}
     ORDER BY CASE WHEN r.status = 'PENDING' THEN 0 ELSE 1 END, r.created_at DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(...binds, query.limit, offset)
    .all<RequestRow>();

  return jsonResponse({
    success: true,
    requests: (rows.results ?? []).map(describeRequest),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
  });
}

async function loadRequest(env: Env, requestId: string): Promise<RequestRow | null> {
  const row = await env.DB.prepare(`${REQUEST_SELECT} WHERE r.id = ? LIMIT 1`)
    .bind(requestId)
    .first<RequestRow>();

  return row ?? null;
}

async function approveRequest(env: Env, operatorId: string, requestId: string, durationDays: number): Promise<Response> {
  const row = await loadRequest(env, requestId);

  if (!row) {
    return errorResponse('Request not found.', 404);
  }

  if (row.status !== 'PENDING') {
    return errorResponse('This request has already been resolved.', 409);
  }

  const now = new Date().toISOString();
  const currentPeriodEnd = new Date(Date.now() + durationDays * 86_400_000).toISOString();

  await env.DB.prepare(
    `UPDATE subscription_requests
     SET status = 'APPROVED', duration_days = ?, resolved_at = ?, resolved_by = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(durationDays, now, operatorId, now, requestId)
    .run();

  const current = await env.DB.prepare(
    'SELECT id FROM subscriptions WHERE business_id = ? ORDER BY created_at DESC LIMIT 1',
  )
    .bind(row.business_id)
    .first<{ id: string }>();

  if (current) {
    await env.DB.prepare(
      `UPDATE subscriptions
       SET plan_id = ?, status = 'active', current_period_end = ?, updated_at = ?
       WHERE id = ?`,
    )
      .bind(row.plan_id, currentPeriodEnd, now, current.id)
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO subscriptions (id, business_id, plan_id, status, current_period_end, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), row.business_id, row.plan_id, currentPeriodEnd, now, now)
      .run();
  }

  await writeAuditLog(env, {
    businessId: row.business_id,
    userId: null,
    platformOperatorId: operatorId,
    action: 'SUBSCRIPTION_ACTIVATED',
    entityType: 'subscription_request',
    entityId: requestId,
    metadata: { planSlug: row.plan_slug, durationDays, currentPeriodEnd, target: row.email },
  });

  return jsonResponse({
    success: true,
    request: { ...describeRequest(row), status: 'APPROVED', durationDays, resolvedAt: now },
    currentPeriodEnd,
  });
}

async function rejectRequest(env: Env, operatorId: string, requestId: string, reason: string): Promise<Response> {
  const row = await loadRequest(env, requestId);

  if (!row) {
    return errorResponse('Request not found.', 404);
  }

  if (row.status !== 'PENDING') {
    return errorResponse('This request has already been resolved.', 409);
  }

  const now = new Date().toISOString();

  await env.DB.prepare(
    `UPDATE subscription_requests
     SET status = 'REJECTED', reject_reason = ?, resolved_at = ?, resolved_by = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(reason, now, operatorId, now, requestId)
    .run();

  await writeAuditLog(env, {
    businessId: row.business_id,
    userId: null,
    platformOperatorId: operatorId,
    action: 'SUBSCRIPTION_REQUEST_REJECTED',
    entityType: 'subscription_request',
    entityId: requestId,
    metadata: { planSlug: row.plan_slug, reason, target: row.email },
  });

  return jsonResponse({
    success: true,
    request: { ...describeRequest(row), status: 'REJECTED', rejectReason: reason, resolvedAt: now },
  });
}

/**
 * Mounted before the `/api/admin` catch-all in index.ts, otherwise the account
 * prefix guard answers 404 for these paths.
 */
export async function handleSubscriptionRoute(request: Request, env: Env): Promise<Response> {
  const path = new URL(request.url).pathname;

  try {
    const operator = await requireOperator(request, env);

    if (request.method === 'GET' && path === '/api/admin/subscriptions') {
      return await listRequests(request, env);
    }

    if (path.startsWith(`${REQUESTS_PATH}/`)) {
      const rest = path.slice(REQUESTS_PATH.length + 1);
      const [requestId, action] = rest.split('/');

      if (request.method === 'POST' && requestId && action === 'approve') {
        const input = approveSubscriptionSchema.parse(await request.json());
        return await approveRequest(env, operator.id, requestId, input.durationDays);
      }

      if (request.method === 'POST' && requestId && action === 'reject') {
        const input = adminSuspendSchema.parse(await request.json());
        return await rejectRequest(env, operator.id, requestId, input.reason);
      }
    }

    if (request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH' || request.method === 'DELETE') {
      return errorResponse('Method not allowed.', 405);
    }

    return errorResponse('Route not found.', 404);
  } catch (error) {
    return renderRouteError(error, 'Subscription route failed.');
  }
}
