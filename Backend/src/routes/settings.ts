import { z } from 'zod';
import { errorResponse, jsonResponse } from '../lib/http';
import { hashPassword, sha256Hex, verifyPassword } from '../lib/crypto';
import {
  changePlanSchema,
  passwordChangeSchema,
  profileUpdateSchema,
  businessSettingsSchema,
} from '../lib/validation';
import { getAuthenticatedUser, getPrimaryBusinessId, writeAuditLog } from '../lib/tenant';
import type { AuthenticatedUser } from '../lib/tenant';
import type { Env } from '../types';

const PROFILE_PATH = '/api/profile';
const PROFILE_PASSWORD_PATH = '/api/profile/password';
const SETTINGS_PATH = '/api/settings';
const BILLING_PATH = '/api/billing';
const BILLING_PLAN_PATH = '/api/billing/change-plan';

type BusinessRow = {
  id: string;
  name: string;
  description: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  timezone: string | null;
  logo: string | null;
};

type SettingsRow = {
  google_maps_name: string | null;
  google_maps_url: string | null;
  google_place_id: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  notifications: string | null;
};

type BrandingRow = {
  primary_color: string | null;
  secondary_color: string | null;
};

const DEFAULT_NOTIFICATIONS = { email: true, sms: false, push: false };

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

async function handleProfileGet(request: Request, env: Env, user: AuthenticatedUser): Promise<Response> {
  const profile = await env.DB.prepare(
    `SELECT id, email, first_name, last_name, avatar_url, email_verified, created_at
     FROM users WHERE id = ? LIMIT 1`,
  )
    .bind(user.id)
    .first<Record<string, unknown>>();

  if (!profile) return errorResponse('Profile not found.', 404);

  const businessIds = await env.DB.prepare(
    `SELECT bm.role, b.id, b.name, b.slug
     FROM business_members bm
     INNER JOIN businesses b ON b.id = bm.business_id
     WHERE bm.user_id = ?
     ORDER BY bm.created_at ASC`,
  )
    .bind(user.id)
    .all<{ role: string; id: string; name: string; slug: string }>();

  return jsonResponse({
    success: true,
    profile: {
      id: profile.id,
      email: profile.email,
      firstName: profile.first_name,
      lastName: profile.last_name,
      avatarUrl: profile.avatar_url ?? '',
      emailVerified: Number(profile.email_verified ?? 0) === 1,
      createdAt: profile.created_at,
      businesses: businessIds.results ?? [],
    },
  });
}

async function handleProfileUpdate(request: Request, env: Env, user: AuthenticatedUser): Promise<Response> {
  const input = profileUpdateSchema.parse(await request.json());
  const updates: string[] = [];
  const params: unknown[] = [];

  if (input.firstName !== undefined) {
    updates.push('first_name = ?');
    params.push(input.firstName);
  }
  if (input.lastName !== undefined) {
    updates.push('last_name = ?');
    params.push(input.lastName);
  }

  if (updates.length === 0) {
    return errorResponse('Provide at least one field to update.', 400);
  }

  updates.push('updated_at = ?');
  params.push(new Date().toISOString());

  await env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...params, user.id)
    .run();

  await writeAuditLog(env, {
    businessId: null,
    userId: user.id,
    action: 'profile.updated',
    entityType: 'user',
    entityId: user.id,
    metadata: input,
  });

  return handleProfileGet(request, env, user);
}

async function handlePasswordChange(request: Request, env: Env, user: AuthenticatedUser): Promise<Response> {
  const input = passwordChangeSchema.parse(await request.json());

  const account = await env.DB.prepare('SELECT password_hash, salt FROM users WHERE id = ? LIMIT 1')
    .bind(user.id)
    .first<{ password_hash: string | null; salt: string | null }>();

  if (!account?.password_hash || !account.salt) {
    return errorResponse('This account uses Google sign-in and has no password.', 409);
  }

  const isValid = await verifyPassword(input.currentPassword, account.salt, account.password_hash);
  if (!isValid) {
    return errorResponse('Your current password is incorrect.', 401);
  }

  const next = await hashPassword(input.newPassword);
  await env.DB.prepare('UPDATE users SET password_hash = ?, salt = ?, updated_at = ? WHERE id = ?')
    .bind(next.hash, next.salt, new Date().toISOString(), user.id)
    .run();

  // A password change must end every other session for this user.
  const authorizationHeader = request.headers.get('authorization');
  const token = authorizationHeader?.startsWith('Bearer ') ? authorizationHeader.slice(7).trim() : null;

  if (token) {
    const tokenHash = await sha256Hex(token);
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?')
      .bind(user.id, tokenHash)
      .run();
  } else {
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run();
  }

  await writeAuditLog(env, {
    businessId: null,
    userId: user.id,
    action: 'profile.password_changed',
    entityType: 'user',
    entityId: user.id,
  });

  return jsonResponse({ success: true, message: 'Password updated. Other sessions were signed out.' });
}

async function loadBusinessSettings(env: Env, userId: string): Promise<Response> {
  const businessId = await getPrimaryBusinessId(userId, env);
  if (!businessId) return errorResponse('Create a business before configuring settings.', 404);

  const business = await env.DB.prepare(
    `SELECT id, name, description, website, phone, email, address, timezone, logo
     FROM businesses WHERE id = ? LIMIT 1`,
  )
    .bind(businessId)
    .first<BusinessRow>();

  if (!business) return errorResponse('Create a business before configuring settings.', 404);

  const settingsRow = await env.DB.prepare(
    `SELECT google_maps_name, google_maps_url, google_place_id, facebook_url, instagram_url, notifications
     FROM business_settings WHERE business_id = ? LIMIT 1`,
  )
    .bind(businessId)
    .first<SettingsRow>();

  if (!settingsRow) {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO business_settings (id, business_id, timezone, notifications, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), businessId, business.timezone ?? 'UTC', JSON.stringify(DEFAULT_NOTIFICATIONS), now, now)
      .run();
  }

  const branding = await env.DB.prepare(
    'SELECT primary_color, secondary_color FROM business_branding WHERE business_id = ? LIMIT 1',
  )
    .bind(businessId)
    .first<BrandingRow>();

  return jsonResponse({
    success: true,
    settings: {
      name: business.name,
      description: business.description ?? '',
      website: business.website ?? '',
      phone: business.phone ?? '',
      email: business.email ?? '',
      address: business.address ?? '',
      timezone: business.timezone ?? 'UTC',
      logo: business.logo ?? '',
      googleMapsName: settingsRow?.google_maps_name ?? '',
      googleMapsUrl: settingsRow?.google_maps_url ?? '',
      googlePlaceId: settingsRow?.google_place_id ?? '',
      facebookUrl: settingsRow?.facebook_url ?? '',
      instagramUrl: settingsRow?.instagram_url ?? '',
      primaryColor: branding?.primary_color ?? '#4f46e5',
      secondaryColor: branding?.secondary_color ?? '#10b981',
      notifications: parseJson(settingsRow?.notifications ?? null, DEFAULT_NOTIFICATIONS),
    },
  });
}

async function handleSettingsUpdate(request: Request, env: Env, user: AuthenticatedUser): Promise<Response> {
  const input = businessSettingsSchema.partial().parse(await request.json());

  const businessId = await getPrimaryBusinessId(user.id, env);
  if (!businessId) return errorResponse('Create a business before configuring settings.', 404);

  const businessFields: Record<string, string | undefined> = {
    name: input.name,
    description: input.description,
    website: input.website,
    phone: input.phone,
    email: input.email,
    address: input.address,
    timezone: input.timezone,
    logo: input.logo,
  };

  const businessUpdates: string[] = [];
  const businessParams: unknown[] = [];

  for (const [column, value] of Object.entries(businessFields)) {
    if (value !== undefined) {
      businessUpdates.push(`${column} = ?`);
      businessParams.push(value === '' ? null : value);
    }
  }

  if (businessUpdates.length > 0) {
    businessUpdates.push('updated_at = ?');
    businessParams.push(new Date().toISOString());
    await env.DB.prepare(`UPDATE businesses SET ${businessUpdates.join(', ')} WHERE id = ?`)
      .bind(...businessParams, businessId)
      .run();
  }

  const settingFields: Record<string, string | undefined> = {
    google_maps_name: input.googleMapsName,
    google_maps_url: input.googleMapsUrl,
    google_place_id: input.googlePlaceId,
    facebook_url: input.facebookUrl,
    instagram_url: input.instagramUrl,
    timezone: input.timezone,
  };

  const settingUpdates: string[] = [];
  const settingParams: unknown[] = [];

  for (const [column, value] of Object.entries(settingFields)) {
    if (value !== undefined) {
      settingUpdates.push(`${column} = ?`);
      settingParams.push(value === '' ? null : value);
    }
  }

  if (input.notifications !== undefined) {
    settingUpdates.push('notifications = ?');
    settingParams.push(JSON.stringify(input.notifications));
  }

  if (settingUpdates.length > 0) {
    settingUpdates.push('updated_at = ?');
    settingParams.push(new Date().toISOString());
  }

  const existing = await env.DB.prepare('SELECT id FROM business_settings WHERE business_id = ? LIMIT 1')
    .bind(businessId)
    .first<{ id: string }>();

  if (!existing) {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO business_settings (id, business_id, timezone, notifications, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        businessId,
        input.timezone ?? 'UTC',
        JSON.stringify(input.notifications ?? DEFAULT_NOTIFICATIONS),
        now,
        now,
      )
      .run();
  }

  if (settingUpdates.length > 0) {
    await env.DB.prepare(`UPDATE business_settings SET ${settingUpdates.join(', ')} WHERE business_id = ?`)
      .bind(...settingParams, businessId)
      .run();
  }

  const brandingUpdates: string[] = [];
  const brandingParams: unknown[] = [];

  if (input.primaryColor !== undefined) {
    brandingUpdates.push('primary_color = ?');
    brandingParams.push(input.primaryColor);
  }
  if (input.secondaryColor !== undefined) {
    brandingUpdates.push('secondary_color = ?');
    brandingParams.push(input.secondaryColor);
  }

  const branding = await env.DB.prepare('SELECT id FROM business_branding WHERE business_id = ? LIMIT 1')
    .bind(businessId)
    .first<{ id: string }>();

  if (brandingUpdates.length > 0) {
    brandingUpdates.push('updated_at = ?');
    brandingParams.push(new Date().toISOString());

    if (!branding) {
      await env.DB.prepare(
        `INSERT INTO business_branding (id, business_id, primary_color, secondary_color, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          businessId,
          input.primaryColor ?? '#4f46e5',
          input.secondaryColor ?? '#10b981',
          new Date().toISOString(),
          new Date().toISOString(),
        )
        .run();
    } else {
      await env.DB.prepare(`UPDATE business_branding SET ${brandingUpdates.join(', ')} WHERE business_id = ?`)
        .bind(...brandingParams, businessId)
        .run();
    }
  } else if (!branding) {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO business_branding (id, business_id, primary_color, secondary_color, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), businessId, '#4f46e5', '#10b981', now, now)
      .run();
  }

  await writeAuditLog(env, {
    businessId,
    userId: user.id,
    action: 'settings.updated',
    entityType: 'business',
    entityId: businessId,
    metadata: input,
  });

  return loadBusinessSettings(env, user.id);
}

async function handleBillingGet(request: Request, env: Env, user: AuthenticatedUser): Promise<Response> {
  const businessId = await getPrimaryBusinessId(user.id, env);
  if (!businessId) return errorResponse('Create a business before opening billing.', 404);

  const [plans, subscription, usage] = await Promise.all([
    env.DB.prepare(
      `SELECT id, name, slug, price_cents, interval, features, active
       FROM plans WHERE active = 1 ORDER BY price_cents ASC`,
    )
      .all<Record<string, unknown>>(),
    env.DB.prepare(
      `SELECT s.id, s.status, s.current_period_end, s.plan_id, p.name, p.slug, p.price_cents, p.interval
       FROM subscriptions s
       LEFT JOIN plans p ON p.id = s.plan_id
       WHERE s.business_id = ?
       ORDER BY s.created_at DESC LIMIT 1`,
    )
      .bind(businessId)
      .first<Record<string, unknown>>(),
    env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM campaigns WHERE business_id = ?) AS campaigns,
         (SELECT COUNT(*) FROM customers WHERE business_id = ?) AS customers`,
    )
      .bind(businessId, businessId)
      .first<{ campaigns: number; customers: number }>(),
  ]);

  return jsonResponse({
    success: true,
    plans: (plans.results ?? []).map((plan) => ({
      id: plan.id,
      name: plan.name,
      slug: plan.slug,
      priceCents: plan.price_cents,
      interval: plan.interval,
      features: parseJson<{ limits?: Record<string, number>; features?: string[] }>(String(plan.features ?? ''), {
        features: [],
      }),
    })),
    subscription: subscription
      ? {
          id: subscription.id,
          status: subscription.status,
          currentPeriodEnd: subscription.current_period_end,
          plan: {
            id: subscription.plan_id,
            name: subscription.name,
            slug: subscription.slug,
            priceCents: subscription.price_cents,
            interval: subscription.interval,
          },
        }
      : null,
    usage: {
      campaigns: usage?.campaigns ?? 0,
      customers: usage?.customers ?? 0,
    },
  });
}

async function handleChangePlan(request: Request, env: Env, user: AuthenticatedUser): Promise<Response> {
  const input = changePlanSchema.parse(await request.json());
  const businessId = await getPrimaryBusinessId(user.id, env);
  if (!businessId) return errorResponse('Create a business before changing plans.', 404);

  const plan = await env.DB.prepare('SELECT id, name, slug FROM plans WHERE slug = ? AND active = 1 LIMIT 1')
    .bind(input.planSlug)
    .first<{ id: string; name: string; slug: string }>();

  if (!plan) return errorResponse('Plan not found.', 404);

  const now = new Date().toISOString();
  const periodEnd = new Date(Date.now() + 30 * 86400_000).toISOString();

  const existing = await env.DB.prepare(
    'SELECT id FROM subscriptions WHERE business_id = ? ORDER BY created_at DESC LIMIT 1',
  )
    .bind(businessId)
    .first<{ id: string }>();

  if (existing) {
    await env.DB.prepare(
      `UPDATE subscriptions SET plan_id = ?, status = 'active', current_period_end = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(plan.id, periodEnd, now, existing.id)
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO subscriptions (id, business_id, plan_id, status, current_period_end, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), businessId, plan.id, periodEnd, now, now)
      .run();
  }

  await writeAuditLog(env, {
    businessId,
    userId: user.id,
    action: 'billing.plan_changed',
    entityType: 'subscription',
    entityId: plan.id,
    metadata: { planSlug: plan.slug },
  });

  return handleBillingGet(request, env, user);
}

/** Profile, settings/integrations and billing for the signed-in merchant. */
export async function handleSettingsRoute(request: Request, env: Env): Promise<Response> {
  const user = await getAuthenticatedUser(request, env);

  if (!user) {
    return errorResponse('Authentication required.', 401);
  }

  const path = new URL(request.url).pathname;

  try {
    if (path === PROFILE_PATH) {
      if (request.method === 'GET') return await handleProfileGet(request, env, user);
      if (request.method === 'PUT' || request.method === 'PATCH') return await handleProfileUpdate(request, env, user);
      return errorResponse('Method not allowed.', 405);
    }

    if (path === PROFILE_PASSWORD_PATH) {
      if (request.method === 'POST') return await handlePasswordChange(request, env, user);
      return errorResponse('Method not allowed.', 405);
    }

    if (path === SETTINGS_PATH) {
      if (request.method === 'GET') {
        return await loadBusinessSettings(env, user.id);
      }
      if (request.method === 'PUT' || request.method === 'PATCH') {
        return await handleSettingsUpdate(request, env, user);
      }
      return errorResponse('Method not allowed.', 405);
    }

    if (path === BILLING_PATH) {
      if (request.method === 'GET') return await handleBillingGet(request, env, user);
      return errorResponse('Method not allowed.', 405);
    }

    if (path === BILLING_PLAN_PATH) {
      if (request.method === 'POST') return await handleChangePlan(request, env, user);
      return errorResponse('Method not allowed.', 405);
    }

    return errorResponse('Route not found.', 404);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse('Validation failed.', 400, error.flatten());
    }

    console.error('Settings route failed.', error);
    return errorResponse('Unable to process the request.', 500);
  }
}
