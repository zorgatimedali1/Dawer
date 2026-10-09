import { secureRandomHex } from './crypto';
import { getPlatformFeatures } from './feature-access';
import type { Env } from '../types';

export const STARTER_TRIAL_DAYS = 7;

export function starterTrialStatement(env: Env, businessId: string, now: string) {
  const endsAt = new Date(Date.parse(now) + STARTER_TRIAL_DAYS * 86_400_000).toISOString();
  return env.DB.prepare(
    `INSERT INTO subscriptions (id, business_id, plan_id, status, current_period_end, created_at, updated_at)
     SELECT ?, ?, 'plan_starter', 'trialing', ?, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM subscriptions WHERE business_id = ?)
     ON CONFLICT(business_id) DO NOTHING`,
  ).bind(crypto.randomUUID(), businessId, endsAt, now, now, businessId);
}

export async function ensureStarterTrialForUser(userId: string, env: Env): Promise<void> {
  const business = await env.DB.prepare(
    `SELECT business_id FROM business_members WHERE user_id = ? ORDER BY created_at ASC LIMIT 1`,
  )
    .bind(userId)
    .first<{ business_id: string }>();

  if (!business) return;
  const now = new Date().toISOString();
  await starterTrialStatement(env, business.business_id, now).run();
}

/**
 * Business slugs are globally unique, so a friendly name can collide with an
 * existing one. Deterministically suffix with random bytes until it is free.
 */
export async function uniqueBusinessSlug(name: string, env: Env): Promise<string> {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'business';
  let slug = base;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const clash = await env.DB.prepare('SELECT 1 AS taken FROM businesses WHERE slug = ? LIMIT 1')
      .bind(slug)
      .first();
    if (!clash) return slug;
    slug = `${base}-${secureRandomHex(3)}`;
  }

  return `${base}-${secureRandomHex(6)}`;
}

/** Creates a business and makes the given user its OWNER, in one batch. */
export async function createBusinessForUser(
  userId: string,
  businessName: string,
  env: Env,
): Promise<{ businessId: string; name: string; slug: string }> {
  const businessId = crypto.randomUUID();
  const slug = await uniqueBusinessSlug(businessName, env);
  const now = new Date().toISOString();
  // Seed the channel switches from the platform-wide controls so a new
  // business starts in sync with the operator's current intent.
  const platform = await getPlatformFeatures(env);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO businesses (id, name, slug, whatsapp_enabled, email_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(businessId, businessName, slug, platform.whatsappEnabled ? 1 : 0, platform.emailEnabled ? 1 : 0, now, now),
    env.DB.prepare(
      `INSERT INTO business_members (id, business_id, user_id, role, created_at) VALUES (?, ?, ?, 'OWNER', ?)`,
    ).bind(crypto.randomUUID(), businessId, userId, now),
    starterTrialStatement(env, businessId, now),
  ]);

  return { businessId, name: businessName, slug };
}

/** True when the user already belongs to at least one business. */
export async function userHasBusiness(userId: string, env: Env): Promise<boolean> {
  const row = await env.DB.prepare('SELECT 1 AS taken FROM business_members WHERE user_id = ? LIMIT 1')
    .bind(userId)
    .first();
  return Boolean(row);
}
