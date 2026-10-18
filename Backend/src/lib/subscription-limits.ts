import type { Env } from '../types';
import { getBusinessAccess, type BusinessAccess } from './subscription-access';

/** Pure: customer storage quota from an already-fetched access object. */
export function customerLimitFromAccess(access: BusinessAccess | null | undefined): number {
  const limit = Number(access?.plan.features.limits.customers ?? 100);
  return Number.isFinite(limit) ? limit : 100;
}

/**
 * Campaign stats (participants / conversion) ride with the analytics
 * entitlement — the same criterion as the analytics 403 gate — so Pro tier
 * and up unlock both and Starter sees neither.
 */
export function campaignStatsAllowed(access: BusinessAccess | null | undefined): boolean {
  return Boolean(
    access?.canManage &&
    access.plan.features.features.some((feature) => /analytics/i.test(feature)),
  );
}

export async function getCustomerLimit(env: Env, businessId: string): Promise<number> {
  return customerLimitFromAccess(await getBusinessAccess(env, businessId));
}

/** Monthly WhatsApp broadcast quota by plan slug; absent slug = no access. */
export const WHATSAPP_PLAN_MONTHLY_LIMITS: Record<string, number> = {
  growth: 200,
  scale: 1000,
  premium: 1000,
};

/** Per-broadcast recipient cap by plan slug; spec: Pro 100, Business 250. */
export const WHATSAPP_PLAN_BATCH_LIMITS: Record<string, number> = {
  growth: 100,
  scale: 250,
  premium: 250,
};

/** Monthly email broadcast quota by plan slug; absent slug = no access. */
export const EMAIL_PLAN_MONTHLY_LIMITS: Record<string, number> = {
  growth: 1000,
  scale: 3000,
  premium: 3000,
};

/** Max recipients per single email broadcast by plan slug. */
export const EMAIL_PLAN_BATCH_LIMITS: Record<string, number> = {
  growth: 200,
  scale: 1000,
  premium: 1000,
};

/** Reads a plan-stored limit override; only finite non-negative numbers count. */
function planOverride(limits: Record<string, number> | undefined, key: string): number | undefined {
  const value = limits?.[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return Math.floor(value);
}

/**
 * Plan criteria stored on the plan row override the legacy slug maps, so an
 * operator-created plan (or an edited quota) is honoured as-is.
 */
export function readPlanLimit(
  slug: string,
  limits: Record<string, number> | undefined,
  key: string,
  legacy: Record<string, number>,
): number {
  return planOverride(limits, key) ?? legacy[slug] ?? 0;
}

/** Wheel design (colors/motion) by plan slug; absent slug = off. Pro+. */
export const WHEEL_DESIGN_PLAN_LIMITS: Record<string, number> = {
  growth: 1,
  scale: 1,
  premium: 1,
};

/** Merchant logo at the wheel hub by plan slug; absent slug = off. Pro+. */
export const WHEEL_CENTER_LOGO_PLAN_LIMITS: Record<string, number> = {
  growth: 1,
  scale: 1,
  premium: 1,
};

/** Gate step colour (badges + CTA buttons) by plan slug; absent slug = off. Pro+. */
export const WHEEL_STEPS_COLOR_PLAN_LIMITS: Record<string, number> = {
  growth: 1,
  scale: 1,
  premium: 1,
};

/** Plan-stored `wheelDesign` criteria win over the slug map above. */
export function wheelDesignAllowed(
  slug: string | null | undefined,
  limits?: Record<string, number>,
): boolean {
  return Boolean(slug) && readPlanLimit(slug as string, limits, 'wheelDesign', WHEEL_DESIGN_PLAN_LIMITS) === 1;
}

/** Plan-stored `wheelCenterLogo` criteria win over the slug map above. */
export function wheelCenterLogoAllowed(
  slug: string | null | undefined,
  limits?: Record<string, number>,
): boolean {
  return Boolean(slug) && readPlanLimit(slug as string, limits, 'wheelCenterLogo', WHEEL_CENTER_LOGO_PLAN_LIMITS) === 1;
}

/** Plan-stored `wheelStepsColor` criteria win over the slug map above. */
export function wheelStepsColorAllowed(
  slug: string | null | undefined,
  limits?: Record<string, number>,
): boolean {
  return Boolean(slug) && readPlanLimit(slug as string, limits, 'wheelStepsColor', WHEEL_STEPS_COLOR_PLAN_LIMITS) === 1;
}

export type WhatsAppLimits = { monthly: number; batch: number };

/**
 * Monthly quota + per-broadcast cap for a plan slug; absent slug = no access.
 * `limits` is the plan's stored criteria — present keys win over the maps.
 */
export function getWhatsAppLimitsForSlug(
  slug: string,
  limits?: Record<string, number>,
): WhatsAppLimits {
  return {
    monthly: readPlanLimit(slug, limits, 'whatsappMonthly', WHATSAPP_PLAN_MONTHLY_LIMITS),
    batch: readPlanLimit(slug, limits, 'whatsappBatch', WHATSAPP_PLAN_BATCH_LIMITS),
  };
}

export type EmailLimits = { monthly: number; batch: number };

/** Email quota + per-broadcast cap for a plan slug; absent slug = no access. */
export function getEmailLimitsForSlug(slug: string, limits?: Record<string, number>): EmailLimits {
  return {
    monthly: readPlanLimit(slug, limits, 'emailMonthly', EMAIL_PLAN_MONTHLY_LIMITS),
    batch: readPlanLimit(slug, limits, 'emailBatch', EMAIL_PLAN_BATCH_LIMITS),
  };
}

/** 0 monthly means the plan cannot use WhatsApp broadcasts at all. */
export async function getWhatsAppBroadcastMonthlyLimit(env: Env, businessId: string): Promise<number> {
  const access = await getBusinessAccess(env, businessId);
  return getWhatsAppLimitsForSlug(access.plan.slug, access.plan.features.limits).monthly;
}

/** 0 monthly means the plan cannot use email campaigns at all. */
export async function getWhatsAppBroadcastLimits(env: Env, businessId: string): Promise<WhatsAppLimits> {
  const access = await getBusinessAccess(env, businessId);
  return getWhatsAppLimitsForSlug(access.plan.slug, access.plan.features.limits);
}

/** 0 monthly means the plan cannot use email campaigns at all. */
export async function getEmailBroadcastLimits(env: Env, businessId: string): Promise<EmailLimits> {
  const access = await getBusinessAccess(env, businessId);
  return getEmailLimitsForSlug(access.plan.slug, access.plan.features.limits);
}
