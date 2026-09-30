export type RewardChoice = {
  id: string;
  name: string;
  weight: number;
};

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
