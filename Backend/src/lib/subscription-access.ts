import type { Env } from '../types';

export type SubscriptionAccessState = 'trial' | 'active' | 'expired' | 'inactive' | 'none';

export interface EffectivePlan {
  id: string;
  name: string;
  slug: string;
  priceCents: number;
  interval: string;
  features: {
    limits: Record<string, number>;
    features: string[];
  };
}

export interface BusinessAccess {
  state: SubscriptionAccessState;
  canManage: boolean;
  startsAt: string | null;
  endsAt: string | null;
  plan: EffectivePlan;
}

interface PlanRow {
  id: string;
  name: string;
  slug: string;
  price_cents: number;
  interval: string;
  features: string | null;
}

interface SubscriptionRow extends PlanRow {
  status: string;
  current_period_start: string;
  current_period_end: string | null;
}

function mapPlan(row: PlanRow): EffectivePlan {
  let features: EffectivePlan['features'] = { limits: {}, features: [] };
  try {
    const parsed = JSON.parse(row.features ?? '{}') as Partial<EffectivePlan['features']>;
    features = {
      limits: parsed.limits ?? {},
      features: parsed.features ?? [],
    };
  } catch {
    // A malformed plan config must not grant any implicit entitlements.
  }

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    priceCents: Number(row.price_cents),
    interval: row.interval,
    features,
  };
}

export async function getBusinessAccess(env: Env, businessId: string): Promise<BusinessAccess> {
  const subscription = await env.DB.prepare(
    `SELECT s.status, s.updated_at AS current_period_start, s.current_period_end,
            p.id, p.name, p.slug, p.price_cents, p.interval, p.features
     FROM subscriptions s
     LEFT JOIN plans p ON p.id = s.plan_id
     WHERE s.business_id = ?
     ORDER BY s.created_at DESC LIMIT 1`,
  )
    .bind(businessId)
    .first<SubscriptionRow>();

  const fallback = await env.DB.prepare(
    `SELECT id, name, slug, price_cents, interval, features
     FROM plans WHERE slug = 'starter' AND active = 1 LIMIT 1`,
  ).first<PlanRow>();

  const plan = subscription?.id ? mapPlan(subscription) : fallback ? mapPlan(fallback) : null;
  if (!plan) {
    return { state: 'none', canManage: false, startsAt: null, endsAt: null, plan: {
      id: '', name: 'Starter', slug: 'starter', priceCents: 0, interval: '3_months', features: { limits: {}, features: [] },
    } };
  }

  if (!subscription) {
    return { state: 'none', canManage: false, startsAt: null, endsAt: null, plan };
  }

  const status = subscription.status.toLowerCase();
  const endTime = subscription.current_period_end ? Date.parse(subscription.current_period_end) : Number.NaN;
  const periodValid = Number.isFinite(endTime) && endTime > Date.now();
  const state: SubscriptionAccessState =
    status === 'active' && periodValid ? 'active'
      : status === 'trialing' && periodValid ? 'trial'
        : status === 'active' || status === 'trialing' ? 'expired'
          : 'inactive';

  return {
    state,
    canManage: state === 'active',
    startsAt: subscription.current_period_start ?? null,
    endsAt: subscription.current_period_end,
    plan,
  };
}