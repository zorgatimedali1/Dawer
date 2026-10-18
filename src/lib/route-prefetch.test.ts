import { describe, expect, it } from 'vitest';
import { prefetchRoute } from '@/lib/route-prefetch';

describe('route prefetch', () => {
  it('is a no-op for routes without a lazy page', () => {
    expect(() => prefetchRoute('/dashboard/does-not-exist')).not.toThrow();
    expect(() => prefetchRoute('/wheels/param-chunk')).not.toThrow();
  });

  it('can be called repeatedly without side effects', () => {
    expect(() => {
      prefetchRoute('/dashboard/overview');
      prefetchRoute('/dashboard/overview');
      prefetchRoute('/dashboard/campaigns');
    }).not.toThrow();
  });
});
