import type { Env } from '../types';

export type RewardChoice = {
  id: string;
  name: string;
  weight: number;
};

/** The shape every wheel display and winner pick runs on. */
export type StockReward = {
  type: string;
  weight: number;
  quantity: number;
  quantityInitial: number;
};

/**
 * A capped reward whose stock has run out keeps its slice on the wheel but
 * must never win again. Its weight is handed to the campaign's "none" slice
 * by `applySoldOutOdds`, so the freed probability is not silently absorbed
 * by the prizes that are still in stock. Uncapped rewards (no initial
 * quantity) are unlimited and never count as sold out; neither does the
 * "none" slice itself.
 */
export function isSoldOutReward(
  reward: Pick<StockReward, 'type' | 'quantity' | 'quantityInitial'>,
): boolean {
  return reward.type !== 'none' && reward.quantityInitial > 0 && reward.quantity <= 0;
}

/**
 * Rewrites a reward list for display/picking: sold-out rows stay in place at
 * weight 0 and the weight they used to carry lands on the "none" slice (which
 * is normally deactivated at 0%, so this runs after `ensureNoWinSlice`). If
 * the campaign has no "none" row at all the freed weight is simply dropped
 * and the remaining prizes renormalize over what is left.
 */
export function applySoldOutOdds<T extends StockReward>(rewards: T[]): T[] {
  let freedWeight = 0;

  const zeroed = rewards.map((reward) => {
    if (!isSoldOutReward(reward)) return reward;
    freedWeight += reward.weight;
    return { ...reward, weight: 0 } as T;
  });

  if (freedWeight <= 0) return zeroed;

  return zeroed.map((reward) =>
    reward.type === 'none' ? ({ ...reward, weight: reward.weight + freedWeight } as T) : reward,
  );
}

/**
 * The "none" slice ships deactivated at 0%; the first time a sold-out reward
 * hands it a share it has to be switched on. The row always exists (the wheel
 * builder creates it), so this only ever flips `active` and reports whether
 * anything changed — never an insert, never a crash on a campaign that has no
 * such row.
 */
export async function ensureNoWinSlice(env: Env, campaignId: string): Promise<boolean> {
  try {
    const noWin = await env.DB.prepare(
      `SELECT id, active FROM rewards WHERE campaign_id = ? AND type = 'none' LIMIT 1`,
    )
      .bind(campaignId)
      .first<{ id: string; active: number }>();

    if (!noWin || Number(noWin.active) === 1) return false;

    await env.DB.prepare(`UPDATE rewards SET active = 1, updated_at = ? WHERE id = ?`)
      .bind(new Date().toISOString(), noWin.id)
      .run();

    return true;
  } catch (error) {
    console.error('no_win_slice_activation_failed', error instanceof Error ? error.message : String(error));
    return false;
  }
}

export function pickWeightedReward<T extends RewardChoice>(rewards: T[]): T | null {
  if (!rewards.length) {
    return null;
  }

  const totalWeight = rewards.reduce((sum, reward) => sum + Number(reward.weight ?? 0), 0);

  if (totalWeight <= 0) {
    return null;
  }

  const randomValue = (crypto.getRandomValues(new Uint32Array(1))[0] / 0xffffffff) * totalWeight;
  let cursor = 0;

  for (const reward of rewards) {
    cursor += Number(reward.weight ?? 0);
    if (randomValue <= cursor) {
      return reward;
    }
  }

  return rewards[rewards.length - 1];
}
