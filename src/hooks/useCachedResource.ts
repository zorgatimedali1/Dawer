import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * In-memory stale-while-revalidate cache for dashboard page data.
 *
 * Switching tabs remounts the target page and everything it refetches —
 * auth, plan access, list reads — so a revisit shows skeletons again even
 * when nothing changed. This hook keeps the last value per cache key for a
 * minute: revisits paint instantly, and only genuinely stale keys
 * revalidate in the background. Read-only display cache — mutations
 * invalidate their keys, and server-side permissions stay authoritative.
 */

const TTL_MS = 60_000;
const MAX_ENTRIES = 300;

type Entry = { value: unknown; savedAt: number };

const cache = new Map<string, Entry>();

/** Clears the whole cache (or one prefix) — used after mutations and in tests. */
export function invalidateCachedResource(prefix?: string): void {
  if (!prefix) {
    cache.clear();
    return;
  }
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

/** Write-through for callers that already hold fresh data (e.g. after a save). */
export function setCachedResource<T>(key: string, value: T): void {
  cache.set(key, { value, savedAt: Date.now() });
  prune();
}

/** Test-only: roll a cached entry back so it reads as older than the TTL. */
export function ageCachedResourceForTests(key: string, ageMs: number): void {
  const entry = cache.get(key);
  if (entry) cache.set(key, { value: entry.value, savedAt: Date.now() - ageMs });
}

/** Fresh-only read, for callers that want to seed a state initializer. */
export function readCachedResource<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry || Date.now() - entry.savedAt >= TTL_MS) return null;
  return entry.value as T;
}

function prune(): void {
  while (cache.size > MAX_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [key, entry] of cache) {
      if (entry.savedAt < oldestAt) {
        oldestKey = key;
        oldestAt = entry.savedAt;
      }
    }
    if (oldestKey === null) break;
    cache.delete(oldestKey);
  }
}

export interface CachedResource<T> {
  /** Latest value for the current key; null while the first fetch is in flight. */
  data: T | null;
  /** True only when nothing can be painted yet (no cached value for this key). */
  loading: boolean;
  /** True while (re)validating in the background. */
  updating: boolean;
  error: string | null;
  /** Force a refetch now, bypassing the TTL. */
  reload: () => void;
  /** Write the fresh value through to state + cache without refetching. */
  mutate: (value: T) => void;
}

/**
 * SWR-style read for one cache key. The fetcher is re-read every render, so
 * closures over filters/search state stay fresh. A `null` key = not mounted
 * or not applicable yet: no fetch, no loading flash.
 */
export function useCachedResource<T>(key: string | null, fetcher: () => Promise<T>): CachedResource<T> {
  const [state, setState] = useState<{
    key: string | null;
    data: T | null;
    loading: boolean;
    updating: boolean;
    error: string | null;
  }>(() => {
    const entry = key ? (cache.get(key) as (Entry & { value: T }) | undefined) : undefined;
    return {
      key,
      data: entry?.value ?? null,
      loading: key !== null && !entry,
      updating: false,
      error: null,
    };
  });

  // Keep the latest fetcher without re-running the fetch effect on every
  // render (filters/search closures change each keystroke).
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (key === null) return undefined;
    const active = true;
    const entry = cache.get(key) as (Entry & { value: T }) | undefined;
    // Fresh + not an explicit reload: the value was fetched within the TTL,
    // painting it is enough. A reload (tick > 0) always revalidates.
    const fresh = entry !== undefined && Date.now() - entry.savedAt < TTL_MS && tick === 0;

    setState((prev) => {
      const data = entry?.value ?? (prev.key !== null && prev.key !== key ? null : prev.data);
      const next = {
        key,
        data,
        loading: !entry && !data,
        updating: !fresh,
        error: null,
      };
      if (
        prev.key === key &&
        prev.data === next.data &&
        prev.loading === next.loading &&
        prev.updating === next.updating &&
        prev.error === next.error
      ) {
        return prev;
      }
      return next;
    });

    if (fresh) return () => { void active; };

    let cancelled = false;
    fetcherRef
      .current()
      .then((value) => {
        if (cancelled) return;
        setCachedResource(key, value);
        setState((prev) => {
          if (prev.key !== key) return prev;
          return { ...prev, key, data: value, loading: false, updating: false, error: null };
        });
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        const message = caught instanceof Error ? caught.message : 'Request failed.';
        setState((prev) => {
          if (prev.key !== key) return prev;
          return { ...prev, key, loading: false, updating: false, error: message };
        });
      });
    return () => {
      cancelled = true;
      void active;
    };
  }, [key, tick]);

  const reload = useCallback(() => setTick((value) => value + 1), []);

  const mutate = useCallback((value: T) => {
    setState((prev) => {
      if (prev.key !== null) setCachedResource(prev.key, value);
      return { ...prev, data: value, loading: false, error: null };
    });
  }, []);

  return { ...state, reload, mutate };
}
