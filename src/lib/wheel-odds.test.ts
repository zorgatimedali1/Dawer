import { describe, expect, it } from 'vitest';
import { effectiveRewardOdds, isSoldOutReward } from '@/lib/wheel-odds';

const cafe = { id: 'cafe', name: 'Café offert', type: 'free_product', weight: 70, quantity: 0, quantityInitial: 1, active: true };
const discount = { id: 'discount', name: '10%', type: 'percentage_discount', weight: 30, quantity: 0, quantityInitial: 0, active: true };
const noWin = { id: 'next', name: 'Prochaine fois', type: 'none', weight: 0, quantity: 0, quantityInitial: 0, active: true };

describe('isSoldOutReward', () => {
  it('flags capped rewards that ran out and nothing else', () => {
    expect(isSoldOutReward({ type: 'free_product', quantity: 0, quantityInitial: 1 })).toBe(true);
    expect(isSoldOutReward({ type: 'free_product', quantity: 1, quantityInitial: 1 })).toBe(false);
    expect(isSoldOutReward({ type: 'free_product', quantity: 0, quantityInitial: null })).toBe(false);
    expect(isSoldOutReward({ type: 'none', quantity: 0, quantityInitial: 0 })).toBe(false);
  });
});

describe('effectiveRewardOdds', () => {
  it('hands the sold-out weight to the none slice', () => {
    expect(effectiveRewardOdds([cafe, discount, noWin])).toEqual([
      { id: 'cafe', name: 'Café offert', percent: 0 },
      { id: 'discount', name: '10%', percent: 30 },
      { id: 'next', name: 'Prochaine fois', percent: 70 },
    ]);
  });

  it('keeps the raw distribution when nothing is sold out', () => {
    const stocked = { ...cafe, quantity: 3 };
    expect(effectiveRewardOdds([stocked, discount, noWin])).toEqual([
      { id: 'cafe', name: 'Café offert', percent: 70 },
      { id: 'discount', name: '10%', percent: 30 },
      { id: 'next', name: 'Prochaine fois', percent: 0 },
    ]);
  });

  it('ignores inactive rewards entirely', () => {
    expect(effectiveRewardOdds([{ ...discount, active: false }, noWin])).toEqual([
      { id: 'next', name: 'Prochaine fois', percent: 0 },
    ]);
  });

  it('aggregates several sold-out slices', () => {
    const bag = { id: 'bag', name: 'Sac', type: 'custom_reward', weight: 20, quantity: 0, quantityInitial: 2, active: true };
    // Freed weight 70 + 20 = 90 over a 120 total (90 + 30 still in stock).
    expect(effectiveRewardOdds([cafe, bag, discount, noWin]).find((entry) => entry.id === 'next')).toEqual({
      id: 'next',
      name: 'Prochaine fois',
      percent: 75,
    });
  });
});
