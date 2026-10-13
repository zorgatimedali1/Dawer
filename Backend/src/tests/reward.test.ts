import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../lib/crypto';
import { applySoldOutOdds, isSoldOutReward, pickWeightedReward } from '../lib/reward';

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

  it('never picks a zero-weight slice', () => {
    const rewards = [
      { id: 'a', name: 'Reward A', weight: 0 },
      { id: 'b', name: 'Reward B', weight: 0 },
    ];

    expect(pickWeightedReward(rewards)).toBeNull();
  });
});

describe('isSoldOutReward', () => {
  it('flags a capped reward whose stock ran out', () => {
    expect(isSoldOutReward({ type: 'free_product', quantity: 0, quantityInitial: 5 })).toBe(true);
    expect(isSoldOutReward({ type: 'free_product', quantity: -3, quantityInitial: 5 })).toBe(true);
  });

  it('keeps stocked, unlimited and none rewards eligible', () => {
    expect(isSoldOutReward({ type: 'free_product', quantity: 3, quantityInitial: 5 })).toBe(false);
    expect(isSoldOutReward({ type: 'free_product', quantity: 0, quantityInitial: 0 })).toBe(false);
    expect(isSoldOutReward({ type: 'free_product', quantity: 0, quantityInitial: null })).toBe(false);
    expect(isSoldOutReward({ type: 'none', quantity: 0, quantityInitial: 0 })).toBe(false);
  });
});

describe('applySoldOutOdds', () => {
  const wheel = [
    { id: 'cafe', name: 'Café offert', type: 'free_product', weight: 70, quantity: 0, quantityInitial: 1 },
    { id: 'discount', name: '10%', type: 'percentage_discount', weight: 30, quantity: 0, quantityInitial: 0 },
    { id: 'next', name: 'Prochaine fois', type: 'none', weight: 0, quantity: 0, quantityInitial: 0 },
  ];

  it('zeros a sold-out slice and hands its weight to the none slice', () => {
    const adjusted = applySoldOutOdds(wheel);

    expect(adjusted.find((reward) => reward.id === 'cafe')?.weight).toBe(0);
    expect(adjusted.find((reward) => reward.id === 'discount')?.weight).toBe(30);
    expect(adjusted.find((reward) => reward.id === 'next')?.weight).toBe(70);
  });

  it('leaves the wheel untouched when nothing is sold out', () => {
    const stocked = wheel.map((reward) => (reward.id === 'cafe' ? { ...reward, quantity: 1 } : reward));

    expect(applySoldOutOdds(stocked)).toEqual(stocked);
  });

  it('drops the freed weight when the campaign has no none slice', () => {
    const adjusted = applySoldOutOdds(wheel.filter((reward) => reward.type !== 'none'));

    expect(adjusted.map((reward) => reward.weight)).toEqual([0, 30]);
  });

  it('never treats the none slice as sold out', () => {
    const adjusted = applySoldOutOdds([
      { id: 'next', name: 'Prochaine fois', type: 'none', weight: 10, quantity: 0, quantityInitial: 0 },
    ]);

    expect(adjusted[0]?.weight).toBe(10);
  });

  it('aggregates several sold-out slices into the none weight', () => {
    const adjusted = applySoldOutOdds([
      ...wheel,
      { id: 'bag', name: 'Sac offert', type: 'custom_reward', weight: 20, quantity: 0, quantityInitial: 2 },
    ]);

    expect(adjusted.find((reward) => reward.id === 'next')?.weight).toBe(90);
    expect(adjusted.find((reward) => reward.id === 'bag')?.weight).toBe(0);
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
