import { describe, expect, it } from 'vitest';
import { seededShuffle } from './shuffle';

describe('seededShuffle', () => {
  it('keeps every element exactly once (permutation)', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const output = seededShuffle(input, 7);
    expect([...output].sort((a, b) => a - b)).toEqual(input);
  });

  it('is deterministic for a given seed', () => {
    const input = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(seededShuffle(input, 99)).toEqual(seededShuffle(input, 99));
  });

  it('produces a different order for different seeds', () => {
    const input = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    expect(seededShuffle(input, 1)).not.toEqual(seededShuffle(input, 2));
  });

  it('reorders the list for a typical seed', () => {
    const input = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    expect(seededShuffle(input, 12_345)).not.toEqual(input);
  });

  it('does not mutate the input array', () => {
    const input = [3, 1, 2];
    seededShuffle(input, 5);
    expect(input).toEqual([3, 1, 2]);
  });

  it('leaves single-element and empty lists untouched', () => {
    expect(seededShuffle([], 1)).toEqual([]);
    expect(seededShuffle(['only'], 1)).toEqual(['only']);
  });
});
