import { planUpsertSchema, planUpdateSchema } from '../../lib/validation';
import { errorResponse, jsonResponse } from '../../lib/http';
import { writeAuditLog } from '../../lib/tenant';
import {
  EMAIL_PLAN_BATCH_LIMITS,
  EMAIL_PLAN_MONTHLY_LIMITS,
  WHATSAPP_PLAN_BATCH_LIMITS,
  WHATSAPP_PLAN_MONTHLY_LIMITS,
  WHEEL_CENTER_LOGO_PLAN_LIMITS,
  WHEEL_DESIGN_PLAN_LIMITS,
  readPlanLimit,
} from '../../lib/subscription-limits';
import { renderRouteError, requireOperator } from '../lib/guard';
import type { Env } from '../../types';

const LIST_PATH = '/api/admin/plans';
const ITEM_PATTERN = /^\/api\/admin\/plans\/([^/]+)$/;

interface PlanRow {
  id: string;
  name: string;
  slug: string;
  price_cents: number;
  interval: string;
  features: string | null;
  active: number;
}

interface PlanDto {
  id: string;
  name: string;
  slug: string;
  priceCents: number;
  interval: string;
  active: boolean;
  features: {
    limits: {
      campaigns: number;
      customers: number;
      whatsappMonthly: number;
      whatsappBatch: number;
      emailMonthly: number;
      emailBatch: number;
      wheelDesign: number;
      wheelCenterLogo: number;
    };
    features: string[];
  };
}

const PLAN_COLUMNS = 'id, name, slug, price_cents, interval, features, active';

function parseFeaturesBlob(raw: string | null): { limits: Record<string, number>; features: string[] } {
  try {
    const parsed = JSON.parse(raw ?? '{}') as Partial<PlanDto['features']>;
    const limits = parsed.limits && typeof parsed.limits === 'object' ? parsed.limits : {};
    const features = Array.isArray(parsed.features) ? parsed.features.filter((f) => typeof f === 'string') : [];
    return { limits, features };
  } catch {
    return { limits: {}, features: [] };
  }
}

/**
 * Serialises a plan for the console. Broadcast quotas fall back to the legacy
 * slug maps so an untouched legacy plan displays its effective criteria; the
 * operator form then saves the resolved values explicitly.
 */
function describePlan(row: PlanRow): PlanDto {
  const stored = parseFeaturesBlob(row.features);
  const pick = (key: string, legacy: Record<string, number>): number =>
    readPlanLimit(row.slug, stored.limits, key, legacy);
  const number = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    priceCents: row.price_cents,
    interval: row.interval,
    active: row.active === 1,
    features: {
      limits: {
        campaigns: number(stored.limits.campaigns, -1),
        customers: number(stored.limits.customers, 100),
        whatsappMonthly: pick('whatsappMonthly', WHATSAPP_PLAN_MONTHLY_LIMITS),
        whatsappBatch: pick('whatsappBatch', WHATSAPP_PLAN_BATCH_LIMITS),
        emailMonthly: pick('emailMonthly', EMAIL_PLAN_MONTHLY_LIMITS),
        emailBatch: pick('emailBatch', EMAIL_PLAN_BATCH_LIMITS),
        wheelDesign: pick('wheelDesign', WHEEL_DESIGN_PLAN_LIMITS),
        wheelCenterLogo: pick('wheelCenterLogo', WHEEL_CENTER_LOGO_PLAN_LIMITS),
      },
      features: stored.features,
    },
  };
}

async function findPlanById(env: Env, planId: string): Promise<PlanRow | null> {
  return env.DB.prepare(`SELECT ${PLAN_COLUMNS} FROM plans WHERE id = ? LIMIT 1`)
    .bind(planId)
    .first<PlanRow>();
}

/** True when another plan already owns this slug (slugs are unique). */
async function slugTaken(env: Env, slug: string, exceptId?: string): Promise<boolean> {
  const row = exceptId
    ? await env.DB.prepare('SELECT id FROM plans WHERE slug = ? AND id != ? LIMIT 1')
        .bind(slug, exceptId)
        .first<{ id: string }>()
    : await env.DB.prepare('SELECT id FROM plans WHERE slug = ? LIMIT 1')
        .bind(slug)
        .first<{ id: string }>();
  return row !== null;
}

async function listPlans(request: Request, env: Env): Promise<Response> {
  await requireOperator(request, env);
  const result = await env.DB.prepare(
    `SELECT ${PLAN_COLUMNS} FROM plans ORDER BY price_cents ASC, name ASC`,
  ).all<PlanRow>();
  return jsonResponse({ success: true, plans: (result.results ?? []).map(describePlan) });
}

async function createPlan(request: Request, env: Env): Promise<Response> {
  const operator = await requireOperator(request, env);
  const input = planUpsertSchema.parse(await request.json());

  if (await slugTaken(env, input.slug)) {
    return errorResponse('A plan with this slug already exists.', 409);
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO plans (id, name, slug, price_cents, interval, features, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      input.name,
      input.slug,
      input.priceCents,
      input.interval,
      JSON.stringify(input.features),
      input.active === false ? 0 : 1,
      new Date().toISOString(),
    )
    .run();

  await writeAuditLog(env, {
    businessId: null,
    userId: null,
    platformOperatorId: operator.id,
    action: 'ADMIN_PLAN_CREATED',
    entityType: 'plan',
    entityId: id,
    metadata: { name: input.name, slug: input.slug, priceCents: input.priceCents },
  });

  const row = await findPlanById(env, id);
  if (!row) return errorResponse('Plan could not be loaded after creation.', 500);
  return jsonResponse({ success: true, plan: describePlan(row) }, 201);
}

async function updatePlan(request: Request, env: Env, planId: string): Promise<Response> {
  const operator = await requireOperator(request, env);
  const input = planUpdateSchema.parse(await request.json());

  const row = await findPlanById(env, planId);
  if (!row) return errorResponse('Plan not found.', 404);

  if (input.slug && (await slugTaken(env, input.slug, planId))) {
    return errorResponse('A plan with this slug already exists.', 409);
  }

  const columns: string[] = [];
  const values: (string | number)[] = [];
  const assign = (column: string, value: string | number): void => {
    columns.push(`${column} = ?`);
    values.push(value);
  };

  if (input.name !== undefined) assign('name', input.name);
  if (input.slug !== undefined) assign('slug', input.slug);
  if (input.priceCents !== undefined) assign('price_cents', input.priceCents);
  if (input.interval !== undefined) assign('interval', input.interval);
  if (input.active !== undefined) assign('active', input.active ? 1 : 0);
  if (input.features !== undefined) assign('features', JSON.stringify(input.features));

  if (columns.length > 0) {
    values.push(planId);
    await env.DB.prepare(`UPDATE plans SET ${columns.join(', ')} WHERE id = ?`).bind(...values).run();

    await writeAuditLog(env, {
      businessId: null,
      userId: null,
      platformOperatorId: operator.id,
      action: 'ADMIN_PLAN_UPDATED',
      entityType: 'plan',
      entityId: planId,
      metadata: { slug: input.slug ?? row.slug, fields: Object.keys(input) },
    });
  }

  const updated = await findPlanById(env, planId);
  if (!updated) return errorResponse('Plan not found.', 404);
  return jsonResponse({ success: true, plan: describePlan(updated) });
}

async function deletePlan(request: Request, env: Env, planId: string): Promise<Response> {
  const operator = await requireOperator(request, env);
  const row = await findPlanById(env, planId);
  if (!row) return errorResponse('Plan not found.', 404);

  const subscription = await env.DB.prepare(
    'SELECT id FROM subscriptions WHERE plan_id = ? LIMIT 1',
  )
    .bind(planId)
    .first<{ id: string }>();
  const pending = await env.DB.prepare(
    "SELECT id FROM subscription_requests WHERE plan_id = ? AND status = 'PENDING' LIMIT 1",
  )
    .bind(planId)
    .first<{ id: string }>();
  if (subscription || pending) {
    return errorResponse('This plan is referenced by a subscription; deactivate it instead.', 409);
  }

  await env.DB.prepare('DELETE FROM plans WHERE id = ?').bind(planId).run();

  await writeAuditLog(env, {
    businessId: null,
    userId: null,
    platformOperatorId: operator.id,
    action: 'ADMIN_PLAN_DELETED',
    entityType: 'plan',
    entityId: planId,
    metadata: { name: row.name, slug: row.slug },
  });

  return jsonResponse({ success: true });
}

/** Operator console CRUD for pricing plans and their criteria. */
export async function handlePlanAdminRoute(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);

    if (url.pathname === LIST_PATH) {
      if (request.method === 'GET') return await listPlans(request, env);
      if (request.method === 'POST') return await createPlan(request, env);
      return errorResponse('Method not allowed.', 405);
    }

    const itemMatch = ITEM_PATTERN.exec(url.pathname);
    if (itemMatch?.[1]) {
      if (request.method === 'PUT') return await updatePlan(request, env, itemMatch[1]);
      if (request.method === 'DELETE') return await deletePlan(request, env, itemMatch[1]);
      return errorResponse('Method not allowed.', 405);
    }

    return errorResponse('Route not found.', 404);
  } catch (error) {
    return renderRouteError(error, 'Plans admin route failed.');
  }
}
