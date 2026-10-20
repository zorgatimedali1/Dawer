import { errorResponse, jsonResponse } from '../../lib/http';
import {
  adminAccountListQuerySchema,
  adminDeleteSchema,
  adminFeatureAccessSchema,
  adminPlayPolicySchema,
  adminSuspendSchema,
  adminWheelThemeSchema,
  describeStoredPlayPolicy,
  parseWheelTheme,
  playPolicyToStorage,
  wheelThemeToStorage,
  type AdminPlayPolicy,
  type AdminWheelThemeUpdate,
  type WheelTheme,
} from '../../lib/validation';
import { wheelDesignAllowed } from '../../lib/subscription-limits';
import { type FeatureFlags } from '../../lib/feature-access';
import { writeAuditLog } from '../../lib/tenant';
import { renderRouteError, requireOperator } from '../lib/guard';
import type { Operator } from '../lib/auth';
import type { Env } from '../../types';

const ACCOUNTS_PATH = '/api/admin/accounts';

/** Reads `plans.features.limits` from the blob a business row carries along. */
function parsePlanLimits(raw: string | null | undefined): Record<string, number> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { limits?: unknown };
    return parsed.limits && typeof parsed.limits === 'object'
      ? (parsed.limits as Record<string, number>)
      : undefined;
  } catch {
    return undefined;
  }
}

type AccountListRow = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  status: string;
  avatar_url: string | null;
  created_at: string;
  business_count: number;
  session_count: number;
  last_seen_at: string | null;
};

function describeAccount(row: AccountListRow) {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    avatarUrl: row.avatar_url,
    status: row.status,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    businessCount: row.business_count,
    sessionCount: row.session_count,
  };
}

async function listAccounts(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const query = adminAccountListQuerySchema.parse({
    search: url.searchParams.get('search') ?? '',
    status: url.searchParams.get('status') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });

  // No session-existence filter here: sessions are transient (suspend,
  // revoke and logout all DELETE them), so requiring one made accounts
  // vanish from the list exactly when operators needed to manage them.
  const conditions: string[] = ['1 = 1'];
  const binds: string[] = [];

  if (query.search) {
    conditions.push('(u.email LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ?)');
    const pattern = `%${query.search}%`;
    binds.push(pattern, pattern, pattern);
  }

  if (query.status) {
    conditions.push('u.status = ?');
    binds.push(query.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS total FROM users u ${where}`)
    .bind(...binds)
    .first<{ total: number }>();

  const total = totalRow?.total ?? 0;
  const offset = (query.page - 1) * query.limit;

  const rows = await env.DB.prepare(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.status, u.avatar_url, u.created_at,
            (SELECT COUNT(*) FROM business_members bm WHERE bm.user_id = u.id) AS business_count,
            (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ?) AS session_count,
            (SELECT MAX(s.created_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen_at
     FROM users u
     ${where}
     ORDER BY u.created_at DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(new Date().toISOString(), ...binds, query.limit, offset)
    .all<AccountListRow>();

  return jsonResponse({
    success: true,
    accounts: (rows.results ?? []).map(describeAccount),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
  });
}

async function getAccount(request: Request, env: Env, accountId: string): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.status, u.avatar_url, u.created_at,
            (SELECT COUNT(*) FROM business_members bm WHERE bm.user_id = u.id) AS business_count,
            (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ?) AS session_count,
            (SELECT MAX(s.created_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen_at
     FROM users u WHERE u.id = ? LIMIT 1`,
  )
    .bind(new Date().toISOString(), accountId)
    .first<AccountListRow>();

  if (!row) return errorResponse('Account not found.', 404);

  const businesses = await env.DB.prepare(
    `SELECT bm.role, bm.created_at AS joined_at, b.id, b.name, b.slug, b.play_policy, b.created_at,
            b.whatsapp_enabled, b.email_enabled, b.sms_enabled, b.wheel_design_enabled,
            b.rewards_enabled, b.wheel_theme, b.wheel_theme_override,
            (SELECT p.slug FROM subscriptions s
              INNER JOIN plans p ON p.id = s.plan_id
              WHERE s.business_id = b.id
              ORDER BY s.created_at DESC LIMIT 1) AS plan_slug,
            (SELECT p.features FROM subscriptions s
              INNER JOIN plans p ON p.id = s.plan_id
              WHERE s.business_id = b.id
              ORDER BY s.created_at DESC LIMIT 1) AS plan_features
     FROM business_members bm
     INNER JOIN businesses b ON b.id = bm.business_id
     WHERE bm.user_id = ?
     ORDER BY bm.created_at ASC
     LIMIT 50`,
  )
    .bind(accountId)
    .all<{
      role: string;
      joined_at: string;
      id: string;
      name: string;
      slug: string;
      play_policy: string | null;
      created_at: string;
      whatsapp_enabled: number;
      email_enabled: number;
      sms_enabled: number;
      wheel_design_enabled: number;
      rewards_enabled: number;
      wheel_theme: string | null;
      wheel_theme_override: string | null;
      plan_slug: string | null;
      plan_features: string | null;
    }>();

  const sessions = await env.DB.prepare(
    `SELECT id, created_at, expires_at FROM sessions
     WHERE user_id = ? AND expires_at > ?
     ORDER BY created_at DESC LIMIT 20`,
  )
    .bind(accountId, new Date().toISOString())
    .all<{ id: string; created_at: string; expires_at: string }>();

  const accounts = await env.DB.prepare(
    `SELECT provider, provider_account_id, email, avatar_url, created_at FROM accounts
     WHERE user_id = ? ORDER BY created_at ASC
     LIMIT 20`,
  )
    .bind(accountId)
    .all<{ provider: string; provider_account_id: string; email: string | null; avatar_url: string | null; created_at: string }>();

  // `platform_operator_id`/`user_id` is the actor and `entity_id` is the
  // subject, so an account's history needs both: what operators did to it,
  // and what it did itself. Operator rows leave `user_id` null, so they are
  // picked up through the subject clause alone.
  const audit = await env.DB.prepare(
    `SELECT id, action, entity_type, entity_id, metadata, created_at FROM audit_logs
     WHERE user_id = ? OR (entity_type = 'user' AND entity_id = ?)
     ORDER BY created_at DESC LIMIT 20`,
  )
    .bind(accountId, accountId)
    .all<{ id: string; action: string; entity_type: string | null; entity_id: string | null; metadata: string | null; created_at: string }>();

  const businessRows = businesses.results ?? [];
  // Businesses normally share the account's policy (the setter writes all of
  // them); one created afterwards reads as `off` until the operator re-saves.
  const accountPolicy = businessRows.find((business) => business.play_policy !== null)?.play_policy ?? null;

  // Same story for the feature switches: the setter writes every business, so
  // the account view is only "on" when no business of the account is flagged
  // off (a business created after a toggle reads on until re-saved, so any off
  // row wins).
  // `Partial<FeatureFlags>` + the explicit sms key keeps the account view
  // serialising the full switch set regardless of FeatureFlags' growth.
  const featureAccess: Partial<FeatureFlags> & { smsEnabled?: boolean } = {
    whatsappEnabled: businessRows.every((business) => Number(business.whatsapp_enabled) === 1),
    emailEnabled: businessRows.every((business) => Number(business.email_enabled) === 1),
    wheelDesignEnabled: businessRows.every((business) => Number(business.wheel_design_enabled) === 1),
    rewardsEnabled: businessRows.every((business) => Number(business.rewards_enabled) === 1),
    smsEnabled: businessRows.every((business) => Number(business.sms_enabled) === 1),
  };

  // Wheel design: the setter writes every business, so the account view is
  // the first non-null theme in each slot; plan_slug falls back to starter
  // (no subscription row = Starter), matching getBusinessAccess.
  const wheelTheme = parseWheelTheme(
    businessRows.find((business) => business.wheel_theme !== null)?.wheel_theme ?? null,
  );
  const wheelThemeOverride = parseWheelTheme(
    businessRows.find((business) => business.wheel_theme_override !== null)?.wheel_theme_override ?? null,
  );
  const planSlug = businessRows.find((business) => business.plan_slug !== null)?.plan_slug ?? 'starter';
  // The wheel's design flag comes from each business's plan criteria, so the
  // account view reports it as soon as one business qualifies.
  const designAllowed = businessRows.some((business) =>
    wheelDesignAllowed(business.plan_slug, parsePlanLimits(business.plan_features)),
  );

  return jsonResponse({
    success: true,
    account: describeAccount(row),
    playPolicy: describeStoredPlayPolicy(accountPolicy),
    featureAccess,
    wheelTheme,
    wheelThemeOverride,
    planSlug,
    designAllowed,
    businesses: businessRows.map((business) => ({
      id: business.id,
      name: business.name,
      slug: business.slug,
      role: business.role,
      playPolicy: describeStoredPlayPolicy(business.play_policy),
      whatsappEnabled: Number(business.whatsapp_enabled) === 1,
      emailEnabled: Number(business.email_enabled) === 1,
      smsEnabled: Number(business.sms_enabled) === 1,
      wheelDesignEnabled: Number(business.wheel_design_enabled) === 1,
      rewardsEnabled: Number(business.rewards_enabled) === 1,
      planSlug: business.plan_slug ?? 'starter',
      createdAt: business.created_at,
    })),
    sessions: (sessions.results ?? []).map((session) => ({
      id: session.id,
      createdAt: session.created_at,
      expiresAt: session.expires_at,
    })),
    identities: (accounts.results ?? []).map((identity) => ({
      provider: identity.provider,
      providerAccountId: identity.provider_account_id,
      email: identity.email,
      avatarUrl: identity.avatar_url,
      createdAt: identity.created_at,
    })),
    auditTrail: (audit.results ?? []).map((entry) => ({
      id: entry.id,
      action: entry.action,
      entityType: entry.entity_type,
      entityId: entry.entity_id,
      metadata: entry.metadata,
      createdAt: entry.created_at,
    })),
  });
}

async function setStatus(
  env: Env,
  operator: Operator,
  accountId: string,
  status: 'ACTIVE' | 'SUSPENDED',
  reason: string | null,
): Promise<Response> {
  const existing = await env.DB.prepare('SELECT id, email, status FROM users WHERE id = ? LIMIT 1')
    .bind(accountId)
    .first<{ id: string; email: string; status: string }>();

  if (!existing) return errorResponse('Account not found.', 404);

  await env.DB.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?')
    .bind(status, new Date().toISOString(), accountId)
    .run();

  let revoked = 0;

  if (status === 'SUSPENDED') {
    const result = await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(accountId).run();
    revoked = Number(result.meta.changes ?? 0);
  }

  await writeAuditLog(env, {
    businessId: null,
    userId: null,
    platformOperatorId: operator.id,
    action: status === 'SUSPENDED' ? 'ADMIN_ACCOUNT_SUSPENDED' : 'ADMIN_ACCOUNT_ACTIVATED',
    entityType: 'user',
    entityId: accountId,
    metadata: { target: existing.email, reason, revokedSessions: revoked },
  });

  return jsonResponse({
    success: true,
    accountId,
    status,
    revokedSessions: revoked,
  });
}

/**
 * Writes the operator's play policy to every business of the account. The
 * policy is the account's effective frequency rule: `off` clears the override
 * so each campaign falls back to its own play rules.
 */
async function setPlayPolicy(
  env: Env,
  operator: Operator,
  accountId: string,
  policy: AdminPlayPolicy,
): Promise<Response> {
  const existing = await env.DB.prepare('SELECT id, email FROM users WHERE id = ? LIMIT 1')
    .bind(accountId)
    .first<{ id: string; email: string }>();

  if (!existing) return errorResponse('Account not found.', 404);

  const result = await env.DB.prepare(
    `UPDATE businesses SET play_policy = ?, updated_at = ?
     WHERE id IN (SELECT business_id FROM business_members WHERE user_id = ?)`,
  )
    .bind(playPolicyToStorage(policy), new Date().toISOString(), accountId)
    .run();
  const updated = Number(result.meta.changes ?? 0);

  await writeAuditLog(env, {
    businessId: null,
    userId: null,
    platformOperatorId: operator.id,
    action: 'ADMIN_PLAY_POLICY_UPDATED',
    entityType: 'user',
    entityId: accountId,
    metadata: { target: existing.email, playPolicy: policy, businesses: updated },
  });

  return jsonResponse({ success: true, accountId, playPolicy: policy, updated });
}

async function revokeSessions(env: Env, operator: Operator, accountId: string): Promise<Response> {
  const existing = await env.DB.prepare('SELECT id, email FROM users WHERE id = ? LIMIT 1')
    .bind(accountId)
    .first<{ id: string; email: string }>();

  if (!existing) return errorResponse('Account not found.', 404);

  const result = await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(accountId).run();
  const revoked = Number(result.meta.changes ?? 0);

  await writeAuditLog(env, {
    businessId: null,
    userId: null,
    platformOperatorId: operator.id,
    action: 'ADMIN_SESSIONS_REVOKED',
    entityType: 'user',
    entityId: accountId,
    metadata: { target: existing.email, revokedSessions: revoked },
  });

  return jsonResponse({ success: true, accountId, revokedSessions: revoked });
}

/**
 * Hard delete. Everything that belongs to the person goes with them — sessions,
 * OAuth identities, business memberships — but businesses themselves have no
 * owner column, so they stay as tenant containers rather than being cascade
 * deleted along with their data (campaigns, payments, customers).
 */
async function deleteAccount(
  env: Env,
  operator: Operator,
  accountId: string,
  reason: string,
): Promise<Response> {
  const existing = await env.DB.prepare('SELECT id, email FROM users WHERE id = ? LIMIT 1')
    .bind(accountId)
    .first<{ id: string; email: string }>();

  if (!existing) return errorResponse('Account not found.', 404);

  const sessions = await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?')
    .bind(accountId)
    .run();
  const identities = await env.DB.prepare('DELETE FROM accounts WHERE user_id = ?')
    .bind(accountId)
    .run();
  const memberships = await env.DB.prepare('DELETE FROM business_members WHERE user_id = ?')
    .bind(accountId)
    .run();
  const deleted = await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(accountId).run();

  if (Number(deleted.meta.changes ?? 0) === 0) return errorResponse('Account not found.', 404);

  const counts = {
    revokedSessions: Number(sessions.meta.changes ?? 0),
    removedIdentities: Number(identities.meta.changes ?? 0),
    removedMemberships: Number(memberships.meta.changes ?? 0),
  };

  await writeAuditLog(env, {
    businessId: null,
    userId: null,
    platformOperatorId: operator.id,
    action: 'ADMIN_ACCOUNT_DELETED',
    entityType: 'user',
    entityId: accountId,
    metadata: { target: existing.email, reason, ...counts },
  });

  return jsonResponse({ success: true, accountId, email: existing.email, ...counts });
}

/**
 * Turns WhatsApp / email marketing, wheel design or the rewards module on or
 * off for every business of the account. The per-account switch always wins
 * for that merchant — it overrides the platform-wide control in either
 * direction.
 *
 * Granting wheel design access is a control handover: the same update clears
 * the operator-authored theme override so the merchant's own design is the
 * one that renders (and the merchant regains editing). The override can
 * always be re-imposed later from the wheel-theme card below.
 */
async function setFeatureAccess(
  env: Env,
  operator: Operator,
  accountId: string,
  update: {
    whatsappEnabled?: boolean;
    emailEnabled?: boolean;
    smsEnabled?: boolean;
    wheelDesignEnabled?: boolean;
    rewardsEnabled?: boolean;
    reason?: string;
  },
): Promise<Response> {
  const existing = await env.DB.prepare('SELECT id, email FROM users WHERE id = ? LIMIT 1')
    .bind(accountId)
    .first<{ id: string; email: string }>();

  if (!existing) return errorResponse('Account not found.', 404);

  const flags: Partial<FeatureFlags> & { smsEnabled?: boolean } = {};
  if (update.whatsappEnabled !== undefined) flags.whatsappEnabled = update.whatsappEnabled;
  if (update.emailEnabled !== undefined) flags.emailEnabled = update.emailEnabled;
  if (update.smsEnabled !== undefined) flags.smsEnabled = update.smsEnabled;
  if (update.wheelDesignEnabled !== undefined) flags.wheelDesignEnabled = update.wheelDesignEnabled;
  if (update.rewardsEnabled !== undefined) flags.rewardsEnabled = update.rewardsEnabled;
  const grantsWheelDesign = flags.wheelDesignEnabled === true;

  const result = await env.DB.prepare(
    `UPDATE businesses SET
       whatsapp_enabled = COALESCE(?, whatsapp_enabled),
       email_enabled = COALESCE(?, email_enabled),
       sms_enabled = COALESCE(?, sms_enabled),
       wheel_design_enabled = COALESCE(?, wheel_design_enabled),
       rewards_enabled = COALESCE(?, rewards_enabled),
       wheel_theme_override = CASE WHEN ? = 1 THEN NULL ELSE wheel_theme_override END,
       updated_at = ?
     WHERE id IN (SELECT business_id FROM business_members WHERE user_id = ?)`,
  )
    .bind(
      flags.whatsappEnabled === undefined ? null : flags.whatsappEnabled ? 1 : 0,
      flags.emailEnabled === undefined ? null : flags.emailEnabled ? 1 : 0,
      flags.smsEnabled === undefined ? null : flags.smsEnabled ? 1 : 0,
      flags.wheelDesignEnabled === undefined ? null : flags.wheelDesignEnabled ? 1 : 0,
      flags.rewardsEnabled === undefined ? null : flags.rewardsEnabled ? 1 : 0,
      grantsWheelDesign ? 1 : 0,
      new Date().toISOString(),
      accountId,
    )
    .run();
  const updated = Number(result.meta.changes ?? 0);

  await writeAuditLog(env, {
    businessId: null,
    userId: null,
    platformOperatorId: operator.id,
    action: 'ADMIN_FEATURE_ACCESS_UPDATED',
    entityType: 'user',
    entityId: accountId,
    metadata: {
      target: existing.email,
      ...(update.reason ? { reason: update.reason } : {}),
      features: flags,
      businesses: updated,
      ...(grantsWheelDesign ? { clearedWheelOverride: updated } : {}),
    },
  });

  return jsonResponse({
    success: true,
    accountId,
    featureAccess: { ...flags },
    updatedBusinesses: updated,
  });
}

/**
 * Operator-authored wheel design for an account. The override is written to
 * every business and beats the merchant's own theme; `clear` hands control
 * back to the merchant's design (still subject to plan gating downstream).
 * Starter accounts stay on the default regardless — resolved at read time.
 */
async function setWheelTheme(
  env: Env,
  operator: Operator,
  accountId: string,
  update: AdminWheelThemeUpdate,
): Promise<Response> {
  const existing = await env.DB.prepare('SELECT id, email FROM users WHERE id = ? LIMIT 1')
    .bind(accountId)
    .first<{ id: string; email: string }>();

  if (!existing) return errorResponse('Account not found.', 404);

  const storage = update.clear ? null : wheelThemeToStorage(update.theme ?? null);

  const result = await env.DB.prepare(
    `UPDATE businesses SET wheel_theme_override = ?, updated_at = ?
     WHERE id IN (SELECT business_id FROM business_members WHERE user_id = ?)`,
  )
    .bind(storage, new Date().toISOString(), accountId)
    .run();
  const updated = Number(result.meta.changes ?? 0);

  const theme: WheelTheme | null = update.clear ? null : (update.theme ?? null);

  await writeAuditLog(env, {
    businessId: null,
    userId: null,
    platformOperatorId: operator.id,
    action: 'ADMIN_WHEEL_THEME_UPDATED',
    entityType: 'user',
    entityId: accountId,
    metadata: {
      target: existing.email,
      clear: update.clear === true,
      theme: theme ? { preset: theme.motion.preset, centerLogo: theme.centerLogo } : null,
      businesses: updated,
    },
  });

  return jsonResponse({
    success: true,
    accountId,
    wheelThemeOverride: theme,
    cleared: update.clear === true,
    updatedBusinesses: updated,
  });
}

export async function handleAdminRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (!url.pathname.startsWith(ACCOUNTS_PATH)) {
    return errorResponse('Route not found.', 404);
  }

  try {
    const operator = await requireOperator(request, env);
    const accountId = url.pathname.slice(ACCOUNTS_PATH.length).replace(/^\//, '').split('/')[0] ?? '';

    if (request.method === 'GET' && !accountId) {
      return await listAccounts(request, env);
    }

    if (request.method === 'GET') {
      return await getAccount(request, env, accountId);
    }

    if (request.method === 'POST' && url.pathname === `${ACCOUNTS_PATH}/${accountId}/suspend`) {
      const input = adminSuspendSchema.parse(await request.json());
      return await setStatus(env, operator, accountId, 'SUSPENDED', input.reason);
    }

    if (request.method === 'POST' && url.pathname === `${ACCOUNTS_PATH}/${accountId}/activate`) {
      return await setStatus(env, operator, accountId, 'ACTIVE', null);
    }

    if (request.method === 'POST' && url.pathname === `${ACCOUNTS_PATH}/${accountId}/revoke-sessions`) {
      return await revokeSessions(env, operator, accountId);
    }

    if (request.method === 'POST' && url.pathname === `${ACCOUNTS_PATH}/${accountId}/play-policy`) {
      const input = adminPlayPolicySchema.parse(await request.json());
      return await setPlayPolicy(env, operator, accountId, input);
    }

    if (request.method === 'POST' && url.pathname === `${ACCOUNTS_PATH}/${accountId}/features`) {
      const input = adminFeatureAccessSchema.parse(await request.json());
      return await setFeatureAccess(env, operator, accountId, input);
    }

    if (request.method === 'POST' && url.pathname === `${ACCOUNTS_PATH}/${accountId}/wheel-theme`) {
      const input = adminWheelThemeSchema.parse(await request.json());
      return await setWheelTheme(env, operator, accountId, input);
    }

    if (
      request.method === 'DELETE' &&
      accountId &&
      url.pathname === `${ACCOUNTS_PATH}/${accountId}`
    ) {
      const input = adminDeleteSchema.parse(await request.json());
      return await deleteAccount(env, operator, accountId, input.reason);
    }

    if (request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH' || request.method === 'DELETE') {
      return errorResponse('Method not allowed.', 405);
    }

    return errorResponse('Route not found.', 404);
  } catch (error) {
    return renderRouteError(error, 'Admin route failed.');
  }
}
