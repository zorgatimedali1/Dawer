import { z } from 'zod';
import { errorResponse, jsonResponse } from '../lib/http';
import { hashPassword, sha256Hex, verifyPassword } from '../lib/crypto';
import {
  passwordChangeSchema,
  profileUpdateSchema,
  subscribeRequestSchema,
  businessSettingsSchema,
  logoUploadSchema,
  wheelThemeSchema,
  wheelThemeToStorage,
  parseWheelTheme,
  resolveWheelTheme,
  DEFAULT_WHEEL_THEME,
  type WheelTheme,
} from '../lib/validation';
import { getAuthenticatedUser, getPrimaryBusinessId, writeAuditLog } from '../lib/tenant';
import { buildSubscriptionWhatsAppUrl } from '../lib/whatsapp';
import { getBusinessAccess } from '../lib/subscription-access';
import { wheelCenterLogoAllowed, wheelDesignAllowed } from '../lib/subscription-limits';
import { getEffectiveFeatures } from '../lib/feature-access';
import type { AuthenticatedUser } from '../lib/tenant';
import type { Env } from '../types';

const PROFILE_PATH = '/api/profile';
const PROFILE_PASSWORD_PATH = '/api/profile/password';
const SETTINGS_PATH = '/api/settings';
const LOGO_PATH = '/api/settings/logo';
const WHEEL_THEME_PATH = '/api/settings/wheel-theme';
const WHEEL_LOGO_PATH = '/api/settings/wheel-logo';
const PUBLIC_LOGO_PATH = '/api/public/businesses';
const BILLING_PATH = '/api/billing';
const BILLING_SUBSCRIBE_PATH = '/api/billing/subscribe-request';

export function businessLogoPath(businessId: string): string {
  return `${PUBLIC_LOGO_PATH}/${businessId}/logo`;
}

export function businessWheelLogoPath(businessId: string): string {
  return `${PUBLIC_LOGO_PATH}/${businessId}/wheel-logo`;
}

/**
 * Cache-buster for the hub-logo URL handed to the SPA. The public image URL is
 * constant, so a replaced logo would otherwise keep rendering from the
 * browser/edge cache for minutes; appending the row's updated_at forces a
 * fresh fetch the moment a new logo is stored.
 */
function wheelLogoVersionedPath(businessId: string, updatedAt: string | null): string {
  const base = businessWheelLogoPath(businessId);
  return updatedAt ? `${base}?v=${encodeURIComponent(updatedAt)}` : base;
}

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
  twitter_url: string | null;
  linkedin_url: string | null;
  tiktok_url: string | null;
  youtube_url: string | null;
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
    `SELECT id, email, first_name, last_name, avatar_url, email_verified, password_hash, created_at
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
      hasPassword: Boolean(profile.password_hash),
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
    `SELECT google_maps_name, google_maps_url, google_place_id, facebook_url, instagram_url,
            twitter_url, linkedin_url, tiktok_url, youtube_url, notifications
     FROM business_settings WHERE business_id = ? LIMIT 1`,
  )
    .bind(businessId)
    .first<SettingsRow>();

  if (!settingsRow) {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO business_settings (id, business_id, timezone, notifications, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(business_id) DO NOTHING`,
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
      twitterUrl: settingsRow?.twitter_url ?? '',
      linkedinUrl: settingsRow?.linkedin_url ?? '',
      tiktokUrl: settingsRow?.tiktok_url ?? '',
      youtubeUrl: settingsRow?.youtube_url ?? '',
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
    twitter_url: input.twitterUrl,
    linkedin_url: input.linkedinUrl,
    tiktok_url: input.tiktokUrl,
    youtube_url: input.youtubeUrl,
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
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(business_id) DO NOTHING`,
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
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(business_id) DO NOTHING`,
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
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(business_id) DO NOTHING`,
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

  const [plans, subscription, usage, pendingRequest, access, features] = await Promise.all([
    env.DB.prepare(
      `SELECT id, name, slug, price_cents, interval, features, active
       FROM plans WHERE active = 1 ORDER BY price_cents ASC`,
    )
      .all<Record<string, unknown>>(),
    env.DB.prepare(
      `SELECT s.id, s.status, s.updated_at, s.current_period_end, s.plan_id, p.name, p.slug, p.price_cents, p.interval
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
    env.DB.prepare(
      `SELECT r.id, r.created_at, p.name, p.slug
       FROM subscription_requests r
       JOIN plans p ON p.id = r.plan_id
       WHERE r.business_id = ? AND r.status = 'PENDING'
       ORDER BY r.created_at DESC LIMIT 1`,
    )
      .bind(businessId)
      .first<{ id: string; created_at: string; name: string; slug: string }>(),
    getBusinessAccess(env, businessId),
    getEffectiveFeatures(env, businessId),
  ]);

  const subscriptionStatus = subscription
    ? access.state === 'expired' ? 'expired' : access.state === 'trial' ? 'trialing' : describeSubscriptionStatus(subscription)
    : null;

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
    access,
    subscription: subscription
      ? {
          id: subscription.id,
          status: subscriptionStatus ?? 'expired',
          currentPeriodStart: subscription.updated_at,
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
    pendingRequest: pendingRequest
      ? {
          id: pendingRequest.id,
          plan: { name: pendingRequest.name, slug: pendingRequest.slug },
          createdAt: pendingRequest.created_at,
        }
      : null,
    usage: {
      campaigns: usage?.campaigns ?? 0,
      customers: usage?.customers ?? 0,
    },
    features,
  });
}

/**
 * Nothing renews automatically in this app, so an "active" row whose period
 * already elapsed is reported as expired instead of silently looking current.
 */
function describeSubscriptionStatus(subscription: Record<string, unknown> | null | undefined): string {
  const status = String(subscription?.status ?? '');
  const periodEnd = subscription?.current_period_end;

  if (
    ['active', 'trialing'].includes(status.toLowerCase()) &&
    typeof periodEnd === 'string' &&
    Date.parse(periodEnd) < Date.now()
  ) {
    return 'expired';
  }

  return status;
}

/**
 * There is no online payment in Tunisia: the merchant records the plan they
 * want and the owner confirms the transfer over WhatsApp, then activates it
 * from the operator console.
 */
async function handleSubscribeRequest(
  request: Request,
  env: Env,
  user: AuthenticatedUser,
): Promise<Response> {
  const input = subscribeRequestSchema.parse(await request.json());
  const businessId = await getPrimaryBusinessId(user.id, env);
  if (!businessId) return errorResponse('Create a business before subscribing.', 404);

  const plan = await env.DB.prepare(
    'SELECT id, name, slug, price_cents, interval FROM plans WHERE slug = ? AND active = 1 LIMIT 1',
  )
    .bind(input.planSlug)
    .first<{ id: string; name: string; slug: string; price_cents: number; interval: string }>();

  if (!plan) return errorResponse('Plan not found.', 404);

  const pending = await env.DB.prepare(
    `SELECT id FROM subscription_requests WHERE business_id = ? AND status = 'PENDING' LIMIT 1`,
  )
    .bind(businessId)
    .first<{ id: string }>();

  if (pending) {
    return errorResponse('A request is already awaiting validation.', 409);
  }

  const business = await env.DB.prepare('SELECT name FROM businesses WHERE id = ? LIMIT 1')
    .bind(businessId)
    .first<{ name: string }>();

  const now = new Date().toISOString();
  const requestId = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO subscription_requests (id, business_id, user_id, plan_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'PENDING', ?, ?)`,
  )
    .bind(requestId, businessId, user.id, plan.id, now, now)
    .run();

  await writeAuditLog(env, {
    businessId,
    userId: user.id,
    action: 'billing.subscription_requested',
    entityType: 'subscription_request',
    entityId: requestId,
    metadata: { planSlug: plan.slug },
  });

  return jsonResponse({
    success: true,
    requestId,
    plan: { id: plan.id, name: plan.name, slug: plan.slug },
    whatsappUrl: buildSubscriptionWhatsAppUrl({
      reference: requestId.slice(0, 8).toUpperCase(),
      planName: plan.name,
      priceCents: plan.price_cents,
      interval: plan.interval,
      businessName: business?.name ?? 'Mon espace',
    }),
  });
}

async function handleLogoUpload(request: Request, env: Env, user: AuthenticatedUser): Promise<Response> {
  const input = logoUploadSchema.parse(await request.json());
  const businessId = await getPrimaryBusinessId(user.id, env);
  if (!businessId) return errorResponse('Create a business before adding a logo.', 404);

  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO business_logos (id, business_id, mime_type, image_data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(business_id) DO UPDATE SET
       mime_type = excluded.mime_type,
       image_data = excluded.image_data,
       updated_at = excluded.updated_at`,
  )
    .bind(crypto.randomUUID(), businessId, input.mimeType, input.dataBase64, now, now)
    .run();

  await env.DB.prepare('UPDATE businesses SET logo = ?, updated_at = ? WHERE id = ?')
    .bind(businessLogoPath(businessId), now, businessId)
    .run();

  await writeAuditLog(env, {
    businessId,
    userId: user.id,
    action: 'business.logo.updated',
    entityType: 'business',
    entityId: businessId,
  });

  return jsonResponse({ success: true, logo: businessLogoPath(businessId) });
}

async function handleLogoDelete(request: Request, env: Env, user: AuthenticatedUser): Promise<Response> {
  const businessId = await getPrimaryBusinessId(user.id, env);
  if (!businessId) return errorResponse('Create a business before removing a logo.', 404);

  const now = new Date().toISOString();

  await env.DB.prepare('DELETE FROM business_logos WHERE business_id = ?').bind(businessId).run();
  await env.DB.prepare('UPDATE businesses SET logo = NULL, updated_at = ? WHERE id = ?')
    .bind(now, businessId)
    .run();

  await writeAuditLog(env, {
    businessId,
    userId: user.id,
    action: 'business.logo.deleted',
    entityType: 'business',
    entityId: businessId,
  });

  return jsonResponse({ success: true, logo: '' });
}

async function loadWheelThemeState(env: Env, businessId: string) {
  return env.DB.prepare(
    'SELECT wheel_theme, wheel_theme_override FROM businesses WHERE id = ?',
  )
    .bind(businessId)
    .first<{
      wheel_theme: string | null;
      wheel_theme_override: string | null;
    }>();
}

async function handleWheelThemeGet(request: Request, env: Env, user: AuthenticatedUser): Promise<Response> {
  const businessId = await getPrimaryBusinessId(user.id, env);
  if (!businessId) return errorResponse('Create a business before configuring the wheel design.', 404);

  const access = await getBusinessAccess(env, businessId);
  const row = await loadWheelThemeState(env, businessId);

  const theme = parseWheelTheme(row?.wheel_theme);
  const override = parseWheelTheme(row?.wheel_theme_override);
  const designAllowed = wheelDesignAllowed(access.plan.slug, access.plan.features.limits);
  const centerLogoAllowed = wheelCenterLogoAllowed(access.plan.slug, access.plan.features.limits);
  const logoRow = await env.DB.prepare(
    'SELECT updated_at FROM business_wheel_logos WHERE business_id = ? LIMIT 1',
  )
    .bind(businessId)
    .first<{ updated_at: string | null }>();

  return jsonResponse({
    success: true,
    designAllowed,
    centerLogoAllowed,
    planSlug: access.plan.slug,
    planName: access.plan.name,
    theme,
    override,
    effective: resolveWheelTheme({
      merchantTheme: row?.wheel_theme,
      overrideTheme: row?.wheel_theme_override,
      designAllowed,
      centerLogoAllowed,
    }),
    centerLogo: wheelLogoVersionedPath(businessId, logoRow?.updated_at ?? null),
  });
}

/**
 * Plan flags first: colors/motion are a Business-tier edit, the hub logo
 * ships from the Pro tier up. There is no per-account grant anymore.
 */
async function handleWheelThemePut(request: Request, env: Env, user: AuthenticatedUser): Promise<Response> {
  const input = wheelThemeSchema.parse(await request.json());
  const businessId = await getPrimaryBusinessId(user.id, env);
  if (!businessId) return errorResponse('Create a business before configuring the wheel design.', 404);

  const access = await getBusinessAccess(env, businessId);
  const designAllowed = wheelDesignAllowed(access.plan.slug, access.plan.features.limits);
  const centerLogoAllowed = wheelCenterLogoAllowed(access.plan.slug, access.plan.features.limits);
  if (!designAllowed && !centerLogoAllowed) {
    return errorResponse(
      'Custom wheel design requires the Business plan and the center logo requires the Pro plan. Upgrade from Billing.',
      403,
    );
  }

  // Without the design flag the saved colors and motion stay untouched (the
  // resolver keeps them hidden); only the hub toggle tracks the plan flag.
  const existing = parseWheelTheme((await loadWheelThemeState(env, businessId))?.wheel_theme);
  const stored: WheelTheme = {
    colors: designAllowed ? input.colors : existing?.colors ?? DEFAULT_WHEEL_THEME.colors,
    motion: designAllowed ? input.motion : existing?.motion ?? DEFAULT_WHEEL_THEME.motion,
    centerLogo: centerLogoAllowed ? input.centerLogo : false,
  };

  const now = new Date().toISOString();
  await env.DB.prepare('UPDATE businesses SET wheel_theme = ?, updated_at = ? WHERE id = ?')
    .bind(wheelThemeToStorage(stored), now, businessId)
    .run();

  await writeAuditLog(env, {
    businessId,
    userId: user.id,
    action: 'business.wheel_theme.updated',
    entityType: 'business',
    entityId: businessId,
    metadata: { preset: stored.motion.preset, centerLogo: stored.centerLogo },
  });

  return jsonResponse({ success: true, theme: stored, designAllowed, centerLogoAllowed });
}

async function handleWheelLogoUpload(request: Request, env: Env, user: AuthenticatedUser): Promise<Response> {
  const input = logoUploadSchema.parse(await request.json());
  const businessId = await getPrimaryBusinessId(user.id, env);
  if (!businessId) return errorResponse('Create a business before adding a wheel logo.', 404);

  const access = await getBusinessAccess(env, businessId);
  if (!wheelCenterLogoAllowed(access.plan.slug, access.plan.features.limits)) {
    return errorResponse('The center wheel logo is available on the Pro plan and above. Upgrade from Billing.', 403);
  }

  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO business_wheel_logos (id, business_id, mime_type, image_data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(business_id) DO UPDATE SET
       mime_type = excluded.mime_type,
       image_data = excluded.image_data,
       updated_at = excluded.updated_at`,
  )
    .bind(crypto.randomUUID(), businessId, input.mimeType, input.dataBase64, now, now)
    .run();

  await writeAuditLog(env, {
    businessId,
    userId: user.id,
    action: 'business.wheel_logo.updated',
    entityType: 'business',
    entityId: businessId,
  });

  return jsonResponse({ success: true, logo: wheelLogoVersionedPath(businessId, now) });
}

async function handleWheelLogoDelete(request: Request, env: Env, user: AuthenticatedUser): Promise<Response> {
  const businessId = await getPrimaryBusinessId(user.id, env);
  if (!businessId) return errorResponse('Create a business before removing a wheel logo.', 404);

  await env.DB.prepare('DELETE FROM business_wheel_logos WHERE business_id = ?').bind(businessId).run();

  await writeAuditLog(env, {
    businessId,
    userId: user.id,
    action: 'business.wheel_logo.deleted',
    entityType: 'business',
    entityId: businessId,
  });

  return jsonResponse({ success: true, logo: '' });
}

/** Serves the stored center-hub image so the public wheel can render it. */
export async function handlePublicWheelLogoRoute(request: Request, env: Env): Promise<Response> {
  const match = /^\/api\/public\/businesses\/([^/]+)\/wheel-logo$/.exec(new URL(request.url).pathname);
  if (!match?.[1]) return errorResponse('Wheel logo not found.', 404);

  const logo = await env.DB.prepare(
    'SELECT mime_type, image_data, updated_at FROM business_wheel_logos WHERE business_id = ? LIMIT 1',
  )
    .bind(match[1])
    .first<{ mime_type: string; image_data: string; updated_at: string | null }>();

  if (!logo) return errorResponse('Wheel logo not found.', 404);

  // The URL is constant, so a plain max-age cache keeps serving the previous
  // logo after a replacement. Revalidate on every request with a cheap ETag.
  const etag = `W/"wheel-logo-${logo.updated_at ?? '0'}"`;
  const headers: Record<string, string> = {
    'content-type': logo.mime_type,
    'cache-control': 'no-cache',
    etag,
  };
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers });
  }

  let bytes: Uint8Array;
  try {
    const binary = atob(logo.image_data);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
  } catch {
    return errorResponse('Wheel logo not found.', 404);
  }

  headers['content-length'] = String(bytes.byteLength);
  return new Response(bytes, { headers });
}

/** Serves the stored logo image for a business so the public wheel can render it. */
export async function handlePublicLogoRoute(request: Request, env: Env): Promise<Response> {
  const match = /^\/api\/public\/businesses\/([^/]+)\/logo$/.exec(new URL(request.url).pathname);
  if (!match?.[1]) return errorResponse('Logo not found.', 404);

  const logo = await env.DB.prepare(
    'SELECT mime_type, image_data, updated_at FROM business_logos WHERE business_id = ? LIMIT 1',
  )
    .bind(match[1])
    .first<{ mime_type: string; image_data: string; updated_at: string | null }>();

  if (!logo) return errorResponse('Logo not found.', 404);

  // Same rationale as the wheel logo: the URL never changes, so revalidate
  // with an ETag instead of serving a possibly stale image for minutes.
  const etag = `W/"logo-${logo.updated_at ?? '0'}"`;
  const headers: Record<string, string> = {
    'content-type': logo.mime_type,
    'cache-control': 'no-cache',
    etag,
  };
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers });
  }

  let bytes: Uint8Array;
  try {
    const binary = atob(logo.image_data);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
  } catch {
    return errorResponse('Logo not found.', 404);
  }

  headers['content-length'] = String(bytes.byteLength);
  return new Response(bytes, { headers });
}

/** Profile, settings/integrations and billing for the signed-in merchant. */
export async function handleSettingsRoute(request: Request, env: Env): Promise<Response> {
  const user = await getAuthenticatedUser(request, env);

  if (!user) {
    return errorResponse('Authentication required.', 401);
  }

  const path = new URL(request.url).pathname;

  const billingRequest = path === BILLING_SUBSCRIBE_PATH && request.method === 'POST';
  if (request.method !== 'GET' && !billingRequest) {
    const businessId = await getPrimaryBusinessId(user.id, env);
    const access = businessId ? await getBusinessAccess(env, businessId) : null;
    if (!access?.canManage) {
      return errorResponse('This account is read-only. Activate a plan from Billing to change account settings.', 403);
    }
  }

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

    if (path === LOGO_PATH) {
      if (request.method === 'POST' || request.method === 'PUT') return await handleLogoUpload(request, env, user);
      if (request.method === 'DELETE') return await handleLogoDelete(request, env, user);
      return errorResponse('Method not allowed.', 405);
    }

    if (path === WHEEL_THEME_PATH) {
      if (request.method === 'GET') return await handleWheelThemeGet(request, env, user);
      if (request.method === 'PUT' || request.method === 'PATCH') return await handleWheelThemePut(request, env, user);
      return errorResponse('Method not allowed.', 405);
    }

    if (path === WHEEL_LOGO_PATH) {
      if (request.method === 'POST' || request.method === 'PUT') return await handleWheelLogoUpload(request, env, user);
      if (request.method === 'DELETE') return await handleWheelLogoDelete(request, env, user);
      return errorResponse('Method not allowed.', 405);
    }

    if (path === BILLING_PATH) {
      if (request.method === 'GET') return await handleBillingGet(request, env, user);
      return errorResponse('Method not allowed.', 405);
    }

    if (path === BILLING_SUBSCRIBE_PATH) {
      if (request.method === 'POST') return await handleSubscribeRequest(request, env, user);
      return errorResponse('Method not allowed.', 405);
    }

    return errorResponse('Route not found.', 404);
  } catch (error) {
    if (error instanceof z.ZodError) {
      // Surface the first real validation message (e.g. the logo size limit)
      // instead of an opaque "Validation failed." the user can't act on.
      const firstMessage = error.issues[0]?.message;
      return errorResponse(firstMessage || 'Validation failed.', 400, error.flatten());
    }

    console.error('Settings route failed.', error);
    return errorResponse('Unable to process the request.', 500);
  }
}



