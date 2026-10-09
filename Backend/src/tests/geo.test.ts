import { describe, expect, it } from 'vitest';
import { distanceMetersBetween } from '../lib/geo';

describe('distanceMetersBetween', () => {
  it('is zero for identical points', () => {
    expect(distanceMetersBetween(36.8065, 10.1815, 36.8065, 10.1815)).toBe(0);
  });

  it('measures 0.001° of latitude as roughly 111 metres', () => {
    const distance = distanceMetersBetween(36.8, 10.18, 36.801, 10.18);
    expect(distance).toBeGreaterThan(110);
    expect(distance).toBeLessThan(112);
  });

  it('places Tunis to Sfax within a few percent of 235 km', () => {
    const distance = distanceMetersBetween(36.8065, 10.1815, 34.7406, 10.7603);
    expect(distance).toBeGreaterThan(228_000);
    expect(distance).toBeLessThan(243_000);
  });
});
