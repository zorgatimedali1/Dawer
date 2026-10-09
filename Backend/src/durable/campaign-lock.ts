import { DurableObject } from 'cloudflare:workers';

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

export class CampaignParticipationLock extends DurableObject<never> {
  constructor(ctx: DurableObjectState, _env: never) {
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
}
