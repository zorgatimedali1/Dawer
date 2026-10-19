import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ageCachedResourceForTests,
  invalidateCachedResource,
  setCachedResource,
  useCachedResource,
  type FetchContext,
} from '@/hooks/useCachedResource';

type Payload = { items: string[]; revision: number };

function json(value: Payload | Promise<Payload>) {
  return Promise.resolve(value);
}

/** Writes an entry and (optionally) ages it past the TTL via fake clock. */
function writeCache(key: string, payload: Payload, ageSeconds = 0) {
  setCachedResource(key, payload);
  if (ageSeconds > 0) ageCachedResourceForTests(key, ageSeconds * 1000);
}

function Probe({ cacheKey, fetcher }: { cacheKey: string | null; fetcher: (context: FetchContext) => Promise<Payload> }) {
  const { data, loading, updating, error, reload, mutate } = useCachedResource(cacheKey, fetcher);
  return (
    <div>
      <p data-testid={`state-${cacheKey ?? 'null'}`}>
        {loading ? 'loading' : 'settled'}|{updating ? 'updating' : 'idle'}|
        {data ? `${data.revision}:${data.items.join(',')}` : 'empty'}|{error ?? 'no-error'}
      </p>
      <button type="button" onClick={reload}>reload</button>
      <button type="button" onClick={() => mutate({ items: ['written', 'through'], revision: 99 })}>
        mutate
      </button>
    </div>
  );
}

function state(cacheKey: string | null = 'k') {
  return screen.getByTestId(`state-${cacheKey}`).textContent;
}

afterEach(() => {
  invalidateCachedResource();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useCachedResource', () => {
  it('fetches on first mount (no cache) and settles with the data', async () => {
    render(<Probe cacheKey="k1" fetcher={() => json({ items: ['a', 'b'], revision: 1 })} />);
    expect(state('k1')).toBe('loading|updating|empty|no-error');

    expect(await screen.findByText('settled|idle|1:a,b|no-error')).toBeInTheDocument();
  });

  it('paints instantly from a fresh cache and never calls the fetcher', () => {
    writeCache('k2', { items: ['cached'], revision: 2 });
    render(
      <Probe
        cacheKey="k2"
        fetcher={() => {
          throw new Error('must not be called');
        }}
      />,
    );
    expect(state('k2')).toBe('settled|idle|2:cached|no-error');
  });

  it('serves a stale cache immediately, then revalidates in the background', async () => {
    writeCache('k3', { items: ['stale'], revision: 3 }, 90);
    render(<Probe cacheKey="k3" fetcher={() => json({ items: ['fresh'], revision: 30 })} />);

    await waitFor(() => expect(state('k3')).toBe('settled|updating|3:stale|no-error'));
    expect(await screen.findByText('settled|idle|30:fresh|no-error')).toBeInTheDocument();
  });

  it('keeps stale data on screen when revalidation fails', async () => {
    writeCache('k4', { items: ['stale'], revision: 4 }, 90);
    render(<Probe cacheKey="k4" fetcher={() => Promise.reject(new Error('Network went away.'))} />);

    expect(await screen.findByText('settled|idle|4:stale|Network went away.')).toBeInTheDocument();
  });

  it('shows the first fetch error when there is no cached value', async () => {
    render(<Probe cacheKey="k5" fetcher={() => Promise.reject(new Error('Boom.'))} />);
    expect(await screen.findByText('settled|idle|empty|Boom.')).toBeInTheDocument();
  });

  it('switching keys inside the TTL paints each cached value with zero fetches', () => {
    writeCache('k6-a', { items: ['one'], revision: 6 });
    writeCache('k6-b', { items: ['two'], revision: 7 });
    const fetcher = vi.fn(() => json({ items: ['skip'], revision: 8 }));

    const { rerender } = render(<Probe cacheKey="k6-a" fetcher={fetcher} />);
    expect(state('k6-a')).toBe('settled|idle|6:one|no-error');

    rerender(<Probe cacheKey="k6-b" fetcher={fetcher} />);
    expect(state('k6-b')).toBe('settled|idle|7:two|no-error');

    rerender(<Probe cacheKey="k6-a" fetcher={fetcher} />);
    expect(state('k6-a')).toBe('settled|idle|6:one|no-error');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fetches when the key switches to an uncached value', async () => {
    writeCache('k9-a', { items: ['one'], revision: 1 });
    const fetcher = vi.fn(() => json({ items: ['searched'], revision: 9 }));
    const { rerender } = render(<Probe cacheKey="k9-a" fetcher={fetcher} />);

    rerender(<Probe cacheKey="search:ada" fetcher={fetcher} />);
    expect(await screen.findByText('settled|idle|9:searched|no-error')).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('reload() bypasses the TTL', async () => {
    const fetcher1 = vi.fn(() => json({ items: ['v1'], revision: 10 }));
    const result = render(<Probe cacheKey="k7" fetcher={fetcher1} />);
    await screen.findByText('settled|idle|10:v1|no-error');
    expect(fetcher1).toHaveBeenCalledTimes(1);

    const fetcher2 = vi.fn(() => json({ items: ['v2'], revision: 11 }));
    result.rerender(<Probe cacheKey="k7" fetcher={fetcher2} />);
    expect(state('k7')).toBe('settled|idle|10:v1|no-error');

    await act(async () => {
      screen.getByText('reload').click();
    });
    await waitFor(() => expect(state('k7')).toBe('settled|idle|11:v2|no-error'));
    expect(fetcher2).toHaveBeenCalledTimes(1);
  });

  it('passes fresh=false on ordinary fetches and fresh=true after reload()', async () => {
    const fetcher = vi.fn((context: { fresh: boolean }) =>
      json({ items: [context.fresh ? 'forced' : 'normal'], revision: 14 }),
    );
    const result = render(<Probe cacheKey="k10" fetcher={fetcher} />);
    await screen.findByText('settled|idle|14:normal|no-error');
    expect(fetcher).toHaveBeenCalledWith({ fresh: false });

    await act(async () => {
      screen.getByText('reload').click();
    });
    await waitFor(() => expect(state('k10')).toBe('settled|idle|14:forced|no-error'));
    expect(fetcher).toHaveBeenLastCalledWith({ fresh: true });

    // The flag is consumed: the next ordinary fetch is not a forced one.
    result.rerender(<Probe cacheKey="k11" fetcher={fetcher} />);
    await screen.findByText('settled|idle|14:normal|no-error');
    expect(fetcher).toHaveBeenLastCalledWith({ fresh: false });
  });

  it('mutate() writes through to the cache without a fetch', async () => {
    const fetcher = vi.fn(() => json({ items: ['initial'], revision: 12 }));
    const result = render(<Probe cacheKey="k8" fetcher={fetcher} />);
    await screen.findByText('settled|idle|12:initial|no-error');
    const calls = fetcher.mock.calls.length;

    await act(async () => {
      screen.getByText('mutate').click();
    });
    expect(state('k8')).toBe('settled|idle|99:written,through|no-error');

    // A fresh probe in the same session paints the mutated value.
    result.rerender(
      <Probe
        cacheKey="k8"
        fetcher={() => {
          throw new Error('must not be called');
        }}
      />,
    );
    expect(state('k8')).toBe('settled|idle|99:written,through|no-error');
    expect(fetcher).toHaveBeenCalledTimes(calls);
  });

  it('a null key idles without fetching', () => {
    const fetcher = vi.fn(() => json({ items: [], revision: 13 }));
    render(<Probe cacheKey={null} fetcher={fetcher} />);

    expect(state(null)).toBe('settled|idle|empty|no-error');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('invalidateCachedResource clears by prefix', () => {
    writeCache('analytics:overview', { items: ['a'], revision: 1 });

    invalidateCachedResource('analytics:');
    render(
      <Probe
        cacheKey="analytics:overview"
        fetcher={() => json({ items: ['refreshed'], revision: 5 })}
      />,
    );
    expect(screen.getByTestId('state-analytics:overview').textContent).toBe('loading|updating|empty|no-error');
  });
});
