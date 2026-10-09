import { sha256Hex } from '../../lib/crypto';
import type { TestDatabase } from './d1';

export type SeededMerchant = {
  userId: string;
  businessId: string;
  token: string;
};

export async function seedMerchant(
  db: TestDatabase,
  options: { email?: string; businessName?: string; withBusiness?: boolean; withActiveSubscription?: boolean; planId?: string } = {},
): Promise<SeededMerchant> {
  const userId = crypto.randomUUID();
  const token = `cf_${crypto.randomUUID().replace(/-/g, '')}.${crypto.randomUUID().replace(/-/g, '')}`;
  const tokenHash = await sha256Hex(token);
  const now = new Date().toISOString();
  const email = options.email ?? `owner-${userId.slice(0, 8)}@example.test`;

  db.prepare(
    `INSERT INTO users (id, email, password_hash, salt, first_name, last_name, email_verified, created_at, updated_at)
     VALUES (?, ?, 'x', 'y', 'Ada', 'Lovelace', 1, ?, ?)`,
  )
    .bind(userId, email, now, now)
    .run();

  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), userId, tokenHash, now, new Date(Date.now() + 7 * 86400_000).toISOString())
    .run();

  let businessId = '';

  if (options.withBusiness !== false) {
    businessId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO businesses (id, name, slug, timezone, created_at, updated_at)
       VALUES (?, ?, ?, 'UTC', ?, ?)`,
    )
      .bind(businessId, options.businessName ?? 'Test Shop', `shop-${businessId.slice(0, 8)}`, now, now)
      .run();

    db.prepare(
      `INSERT INTO business_members (id, business_id, user_id, role, created_at)
       VALUES (?, ?, ?, 'OWNER', ?)`,
    )
    .bind(crypto.randomUUID(), businessId, userId, now)
      .run();

    if (options.withActiveSubscription) {
      db.prepare(
        `INSERT INTO subscriptions (id, business_id, plan_id, status, current_period_end, created_at, updated_at)
         VALUES (?, ?, ?, 'active', ?, ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          businessId,
          options.planId ?? 'plan_starter',
          new Date(Date.now() + 30 * 86_400_000).toISOString(),
          now,
          now,
        )
        .run();
    }
  }

  return { userId, businessId, token };
}

export function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export const OPERATOR_COOKIE_NAME = 'cf_op_session';

export type SeededOperator = {
  operatorId: string;
  token: string;
};

/**
 * Platform operator: not a user row, so it has no business memberships and its
 * session lives in `platform_sessions` behind an HttpOnly cookie.
 */
export async function seedOperator(
  db: TestDatabase,
  email = 'operator@example.test',
): Promise<SeededOperator> {
  const operatorId = crypto.randomUUID();
  const token = `op_${crypto.randomUUID().replace(/-/g, '')}.${crypto.randomUUID().replace(/-/g, '')}`;
  const tokenHash = await sha256Hex(token);
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO platform_operators (id, email, password_hash, salt, first_name, last_name, status, created_at, updated_at)
     VALUES (?, ?, 'x', 'y', 'Ops', 'Admin', 'ACTIVE', ?, ?)`,
  )
    .bind(operatorId, email, now, now)
    .run();

  db.prepare(
    `INSERT INTO platform_sessions (id, operator_id, token_hash, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), operatorId, tokenHash, now, new Date(Date.now() + 7 * 86400_000).toISOString())
    .run();

  return { operatorId, token };
}

export function jsonRequest(
  path: string,
  method: string,
  body?: unknown,
  token?: string,
): Request {
  return new Request(`https://example.test${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** Same as jsonRequest, but authenticates with the operator session cookie. */
export function operatorRequest(
  path: string,
  method: string,
  body?: unknown,
  token?: string,
): Request {
  return new Request(`https://example.test${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { cookie: `${OPERATOR_COOKIE_NAME}=${encodeURIComponent(token)}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
