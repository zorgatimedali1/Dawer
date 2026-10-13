/**
 * Mirrors the backend's sold-out redistribution (Backend/src/lib/reward.ts):
 * a capped reward whose stock ran out keeps its slice but with a 0% chance,
 * and the weight it used to carry lands on the campaign's "none" slice so the
 * freed probability is never silently absorbed by the prizes still in stock.
 */

export interface WheelRewardOddsInput {
  id: string;
  name: string;
  type: string;
  weight: number;
  quantity: number;
  quantityInitial: number | null;
  active: boolean;
}

export interface WheelRewardOdds {
  id: string;
  name: string;
  percent: number;
}

export function isSoldOutReward(reward: Pick<WheelRewardOddsInput, 'type' | 'quantity' | 'quantityInitial'>): boolean {
  return (
    reward.type !== 'none' &&
    (reward.quantityInitial ?? 0) > 0 &&
    reward.quantity <= 0
  );
}

/** Effective win odds per active reward, with sold-out weight moved to "none". */
export function effectiveRewardOdds(rewards: WheelRewardOddsInput[]): WheelRewardOdds[] {
  const active = rewards.filter((reward) => reward.active);

  let freedWeight = 0;
  const adjusted = active.map((reward) => {
    if (!isSoldOutReward(reward)) return reward;
    freedWeight += reward.weight;
    return { ...reward, weight: 0 };
  });

  const withBoost = freedWeight > 0
    ? adjusted.map((reward) =>
        reward.type === 'none' ? { ...reward, weight: reward.weight + freedWeight } : reward,
      )
    : adjusted;

  const totalWeight = withBoost.reduce((sum, reward) => sum + reward.weight, 0);

  return withBoost.map((reward) => ({
    id: reward.id,
    name: reward.name,
    percent: totalWeight > 0 ? Math.round((reward.weight / totalWeight) * 100) : 0,
  }));
}
