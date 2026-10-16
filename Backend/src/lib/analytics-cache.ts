import { sha256Hex } from './crypto';
import type { Env } from '../types';

/**
 * Analytics responses are recomputed from the same D1 rows on every dashboard
 * load. Caching the computed payload in KV turns repeat visits into a ~5ms KV
 * read instead of 2–4 aggregations, at the cost of bounded staleness.
 *
 * TTL is tiered by window length: short windows (≤ 7 days) are what merchants
 * treat as "live", so they expire after 1 hour; longer windows change slowly
 * and stay warm for 3 hours. A `?fresh=1` request bypasses the read, recomputes
 * and re-arms the window — that is the merchant's on-demand escape hatch.
 */
const SHORT_WINDOW_DAYS = 7;
const SHORT_WINDOW_TTL_SECONDS = 3_600;
const LONG_WINDOW_TTL_SECONDS = 10_800;

/** Bump the prefix to invalidate every cached entry at once on deploy. */
const KEY_PREFIX = 'analytics:v1';

/**
 * The in-memory edge cache on KV reads: identical requests inside one isolate
 * skip even the KV round-trip. Keeps read amplification flat when many tabs
 * poll the same tenant, without extending the durable staleness window.
 */
export const KV_READ_EDGE_CACHE_SECONDS = 60;

export function analyticsTtlSeconds(days: number): number {
  return days <= SHORT_WINDOW_DAYS ? SHORT_WINDOW_TTL_SECONDS : LONG_WINDOW_TTL_SECONDS;
}

/**
 * Scoped to the sorted tenant-id set so a user who belongs to several
 * businesses always reads exactly what their own queries would compute, and
 * two tenants can never share an entry.
 */
export async function analyticsCacheKey(
  businessIds: string[],
  endpoint: string,
  days: number,
): Promise<string> {
  const tenantHash = await sha256Hex([...businessIds].sort().join(','));
  return `${KEY_PREFIX}:${tenantHash}:${endpoint}:${days}`;
}

export async function readAnalyticsCache(env: Env, key: string): Promise<string | null> {
  return env.TOKENS.get(key, { cacheTtl: KV_READ_EDGE_CACHE_SECONDS });
}

export async function writeAnalyticsCache(
  env: Env,
  key: string,
  body: unknown,
  ttlSeconds: number,
): Promise<void> {
  await env.TOKENS.put(key, JSON.stringify(body), { expirationTtl: ttlSeconds });
}
