import { sha256Hex } from '../../lib/crypto';
import type { TestDatabase } from './d1';

export type SeededMerchant = {
  userId: string;
  businessId: string;
  token: string;
};

export async function seedMerchant(
  db: TestDatabase,
  options: { email?: string; businessName?: string; withBusiness?: boolean } = {},
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
  }

  return { userId, businessId, token };
}

export function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
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
