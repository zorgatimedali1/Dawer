import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../lib/crypto';
import { pickWeightedReward } from '../lib/reward';

describe('reward selection', () => {
  it('returns null when no rewards exist', () => {
    expect(pickWeightedReward([])).toBeNull();
  });

  it('returns one of the configured rewards', () => {
    const rewards = [
      { id: 'a', name: 'Reward A', weight: 20 },
      { id: 'b', name: 'Reward B', weight: 80 },
    ];

    const chosen = pickWeightedReward(rewards);
    expect(chosen).toBeTruthy();
    expect(rewards.some((reward) => reward.id === chosen?.id)).toBe(true);
  });
});

describe('password helpers', () => {
  it('hashes and verifies a password', async () => {
    const password = 'SecurePass!123';
    const result = await hashPassword(password);
    const valid = await verifyPassword(password, result.salt, result.hash);

    expect(valid).toBe(true);
  });
});
