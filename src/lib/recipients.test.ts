import { describe, expect, it } from 'vitest';
import { selectWithinBatch } from './recipients';

describe('selectWithinBatch', () => {
  const items = Array.from({ length: 6 }, (_, index) => ({ id: `item-${index}` }));

  it('selects everything when the batch limit is unlimited (0)', () => {
    const pick = selectWithinBatch(items, 0);
    expect(pick.ids).toHaveLength(6);
    expect(pick.capped).toBe(false);
  });

  it('selects everything when the list fits the limit', () => {
    const pick = selectWithinBatch(items.slice(0, 3), 4);
    expect(pick.ids).toEqual(['item-0', 'item-1', 'item-2']);
    expect(pick.capped).toBe(false);
  });

  it('trims an overflowing list to exactly the limit', () => {
    const pick = selectWithinBatch(items, 4);
    expect(pick.ids).toHaveLength(4);
    expect(new Set(pick.ids).size).toBe(4);
    expect(pick.capped).toBe(true);
    expect(pick.total).toBe(6);
  });

  it('picks a random subset, not just the first items', () => {
    const first = selectWithinBatch(items, 3);
    const second = selectWithinBatch(items, 3);
    // A deterministic whole-prefix slice would be identical; random picks
    // almost never are (6·5·4 / 3! distinct sets).
    expect(first.ids.join(',')).not.toBe(second.ids.join(','));
  });
});
