import type { Env } from '../types';

/**
 * The customer wheel payload (`selectWheelRewards`) is read on every campaign
 * page load AND every spin, yet it only changes when a merchant edits rewards
 * or a stock unit burns. Caching the computed display list in KV turns those
 * reads into a ~5ms edge read, at a bounded 60s staleness — delete-on-write
 * keeps merchant edits visible immediately (subject to the usual ~60s KV
 * propagation), the TTL bounds how long a lost delete can stay sticky.
 *
 * Wheels that currently run the sold-out lazy migration (a capped prize at
 * zero stock) are never cached: their read also writes D1, so caching them
 * could pin a half-migrated payload. They stay on the D1 hot path until their
 * merchant restocks or edits the rewards.
 */
const KEY_PREFIX = 'wheel-rewards:v1';
const TTL_SECONDS = 60;
/** KV-read edge cache: identical loads in one isolate skip the KV round-trip. */
const EDGE_CACHE_SECONDS = 55;

type CachedReward = {
  id: string;
  name: string;
  description: string | null;
  type: string;
  value: string | null;
  weight: number;
  quantity: number;
  quantityInitial: number;
};

function isCachedRewardList(value: unknown): value is CachedReward[] {
  return (
    Array.isArray(value) &&
    value.every(
      (row) =>
        row !== null &&
        typeof row === 'object' &&
        typeof (row as CachedReward).id === 'string' &&
        typeof (row as CachedReward).name === 'string' &&
        typeof (row as CachedReward).type === 'string',
    )
  );
}

export function wheelRewardsCacheKey(campaignId: string): string {
  return `${KEY_PREFIX}:${campaignId}`;
}

export async function readWheelRewardsCache(env: Env, campaignId: string): Promise<CachedReward[] | null> {
  try {
    const raw = await env.TOKENS.get(wheelRewardsCacheKey(campaignId), { cacheTtl: EDGE_CACHE_SECONDS });
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isCachedRewardList(parsed) ? parsed : null;
  } catch (error) {
    console.error('wheel_rewards_cache_read_failed', error instanceof Error ? error.message : String(error));
    return null;
  }
}

export async function writeWheelRewardsCache(env: Env, campaignId: string, rewards: unknown): Promise<void> {
  try {
    await env.TOKENS.put(wheelRewardsCacheKey(campaignId), JSON.stringify(rewards), {
      expirationTtl: TTL_SECONDS,
    });
  } catch (error) {
    console.error('wheel_rewards_cache_write_failed', error instanceof Error ? error.message : String(error));
  }
}

/** Best-effort: losing one only extends the normal 60s TTL. */
export async function invalidateWheelRewardsCache(env: Env, campaignId: string): Promise<void> {
  try {
    await env.TOKENS.delete(wheelRewardsCacheKey(campaignId));
  } catch (error) {
    console.error('wheel_rewards_cache_invalidate_failed', error instanceof Error ? error.message : String(error));
  }
}
