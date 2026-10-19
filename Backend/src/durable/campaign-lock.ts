import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types';

const DAY_MS = 86_400_000;

type ClaimPolicy = {
  mode: 'windowed';
  perDay: number;
  cooldownMinutes: number;
};

type ClaimState = {
  campaignId: string;
  customerKey: string;
  /** Present only for the legacy permanent claim. */
  claimedAt?: number;
  /** Rolling 24 h claim timestamps (windowed campaigns). */
  claims?: number[];
  /** Rolling 24 h winning-spin timestamps (windowed campaigns). */
  wins?: number[];
};

export type ClaimOutcome = { allowed: true } | { allowed: false; reason: 'duplicate_spin' | 'daily_limit' | 'cooldown' };

const CAP_PREFIX = '#cap:';

function dailyCapPrefix(campaignId: string): string {
  return `${CAP_PREFIX}${campaignId}:`;
}

function dailyCapKey(campaignId: string): string {
  return `${dailyCapPrefix(campaignId)}${new Date().toISOString().slice(0, 10)}`;
}

function normalize(state: ClaimState | undefined): { claims: number[]; wins: number[] } {
  if (!state) return { claims: [], wins: [] };

  const claims = Array.isArray(state.claims)
    ? state.claims
    : typeof state.claimedAt === 'number'
      ? [state.claimedAt]
      : [];
  const wins = Array.isArray(state.wins) ? state.wins : [];
  const now = Date.now();

  return {
    claims: claims.filter((at) => now - at < DAY_MS),
    wins: wins.filter((at) => now - at < DAY_MS),
  };
}

export class CampaignParticipationLock extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, _env: Env) {
    super(ctx, _env);
  }

  async claim(campaignId: string, customerKey: string, policy?: ClaimPolicy): Promise<ClaimOutcome> {
    const scopeKey = `${campaignId}:${customerKey}`;
    const stored = await this.ctx.storage.get<ClaimState>(scopeKey);

    if (!policy) {
      // Default: one spin per visitor, forever. Only an *empty* windowed
      // state counts as unclaimed so a campaign switched back to `once` can
      // still be used; legacy `claimedAt` claims stay permanent (they are not
      // subject to the rolling window).
      const hasClaim =
        typeof stored?.claimedAt === 'number' ||
        (Array.isArray(stored?.claims) && (stored?.claims?.length ?? 0) > 0);

      if (stored && hasClaim) {
        return { allowed: false, reason: 'duplicate_spin' };
      }

      await this.ctx.storage.put(scopeKey, {
        campaignId,
        customerKey,
        claimedAt: Date.now(),
      });

      return { allowed: true };
    }

    const { claims, wins } = normalize(stored);
    const now = Date.now();

    if (claims.length >= policy.perDay) {
      return { allowed: false, reason: 'daily_limit' };
    }

    const lastClaim = claims.length ? claims[claims.length - 1] : 0;
    if (lastClaim && now - lastClaim < policy.cooldownMinutes * 60_000) {
      return { allowed: false, reason: 'cooldown' };
    }

    claims.push(now);
    await this.ctx.storage.put(scopeKey, { campaignId, customerKey, claims, wins });

    return { allowed: true };
  }

  /**
   * Hands the slot back when a spin is abandoned before anything is written
   * (sold-out campaign, for example) so the visitor keeps their attempt.
   * Windowed campaigns only forget the claim that was just made — earlier
   * attempts in the rolling window stay recorded.
   */
  async release(campaignId: string, customerKey: string): Promise<void> {
    const scopeKey = `${campaignId}:${customerKey}`;
    const stored = await this.ctx.storage.get<ClaimState>(scopeKey);

    if (!stored) return;

    if (Array.isArray(stored.claims)) {
      const claims = [...stored.claims];
      claims.pop();

      if (claims.length || (stored.wins?.length ?? 0) > 0) {
        await this.ctx.storage.put(scopeKey, { ...stored, claims });
        return;
      }
    }

    await this.ctx.storage.delete(scopeKey);
  }

  /** Records a winning spin so the campaign's win budget can be enforced. */
  async recordWin(campaignId: string, customerKey: string): Promise<void> {
    const scopeKey = `${campaignId}:${customerKey}`;
    const stored = await this.ctx.storage.get<ClaimState>(scopeKey);
    const { claims, wins } = normalize(stored);

    wins.push(Date.now());
    await this.ctx.storage.put(scopeKey, { ...(stored ?? { campaignId, customerKey }), claims, wins });
  }

  /** Winning spins made by this identity in the rolling 24 h window. */
  async getWinCount(campaignId: string, customerKey: string): Promise<number> {
    const stored = await this.ctx.storage.get<ClaimState>(`${campaignId}:${customerKey}`);
    return normalize(stored).wins.length;
  }

  /**
   * Today's committed participation count for one campaign (platform daily
   * spin cap). Lives under a `#cap:` prefix this class never uses for
   * identity claims, so a counter instance never mixes claim rows into its
   * keys. `null` means "not seeded yet" — the caller reads D1 once and feeds
   * `setDailySpinCount`; after that every spin costs one storage read.
   */
  async getDailySpinCount(campaignId: string): Promise<number | null> {
    const stored = await this.ctx.storage.get<number>(dailyCapKey(campaignId));
    return typeof stored === 'number' ? stored : null;
  }

  /** Stores the D1-computed seed, dropping earlier days' keys for this campaign. */
  async setDailySpinCount(campaignId: string, count: number): Promise<void> {
    const key = dailyCapKey(campaignId);
    const staleKeys = await this.ctx.storage.list({ prefix: dailyCapPrefix(campaignId) });
    await Promise.all([...staleKeys.keys()].filter((k) => k !== key).map((k) => this.ctx.storage.delete(k)));
    await this.ctx.storage.put(key, count);
  }

  /** Post-commit bump — best-effort, skipped by the caller when unseeded. */
  async bumpDailySpinCount(campaignId: string): Promise<void> {
    const key = dailyCapKey(campaignId);
    const stored = await this.ctx.storage.get<number>(key);
    await this.ctx.storage.put(key, (typeof stored === 'number' ? stored : 0) + 1);
  }
}
