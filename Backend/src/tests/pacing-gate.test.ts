import { describe, expect, it, vi } from 'vitest';
import { WhatsAppPacingGate } from '../durable/pacing-gate';
import type { Env } from '../types';
import { createTestEnv } from './helpers/d1';

/**
 * Builds a fake DurableObjectState plus a delivery queue that mirrors the
 * runtime input gate: each event runs its storage-only chain uninterrupted
 * (storage promises settle as microtasks) and the next event is delivered
 * only once the current chain drains onto a macrotask (timer sleep or
 * completion) — exactly when the real input gate reopens. Without this,
 * a fake context would interleave at every microtask and prove nothing.
 */
function createGateContext() {
  const store = new Map<string, unknown>();
  const queue: Array<() => void> = [];
  let running = false;

  function pump(): void {
    if (running) return;
    const next = queue.shift();
    if (!next) return;
    running = true;
    setImmediate(() => {
      running = false;
      next();
      pump();
    });
  }

  function deliver<T>(run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        run().then(resolve, reject);
      });
      pump();
    });
  }

  const ctx = {
    storage: {
      async get<T>(key: string): Promise<T | undefined> {
        return store.get(key) as T | undefined;
      },
      async put(key: string, value: unknown): Promise<void> {
        store.set(key, value);
      },
      async delete(key: string): Promise<boolean> {
        return store.delete(key);
      },
    },
  } as unknown as DurableObjectState;

  return { ctx, store, deliver };
}

function newGate() {
  const { ctx, store, deliver } = createGateContext();
  const gate = new WhatsAppPacingGate(ctx, createTestEnv() as unknown as Env);
  return { gate, store, deliver };
}

describe('WhatsAppPacingGate.acquire', () => {
  it('spaces concurrent acquires a full MIN_GAP apart even when acquire sleeps', async () => {
    const { gate, store, deliver } = newGate();

    // A recent send puts the next slot 100 ms away — inside the inline
    // window, so acquire() must sleep, which is precisely the moment the
    // input gate reopens and a concurrent caller used to sneak through on
    // the stale lastSentAt.
    const seed = Date.now() - 50;
    store.set('lastSentAt', seed);

    const [first, second] = await Promise.all([
      deliver(() => gate.acquire()),
      deliver(() => gate.acquire()),
    ]);

    expect(first).toEqual({ allowed: true });
    expect(second).toEqual({ allowed: true });
    // Slot 1: seed+MIN_GAP, slot 2: seed+2*MIN_GAP — never both on slot 1.
    const lastSentAt = store.get('lastSentAt') as number;
    expect(lastSentAt).toBeGreaterThanOrEqual(seed + 2 * WhatsAppPacingGate.MIN_GAP_MS);
  });

  it('reserves the current timestamp when no wait is needed', async () => {
    const { gate, store, deliver } = newGate();

    const before = Date.now();
    const result = await deliver(() => gate.acquire());

    expect(result).toEqual({ allowed: true });
    const lastSentAt = store.get('lastSentAt') as number;
    expect(lastSentAt).toBeGreaterThanOrEqual(before);
    expect(lastSentAt).toBeLessThanOrEqual(Date.now());
  });

  it('hands waits longer than the inline window back without sleeping or reserving', async () => {
    const { gate, store, deliver } = newGate();

    store.set('blockedUntil', Date.now() + 30_000);
    const started = Date.now();
    const result = await deliver(() => gate.acquire());

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.waitMs).toBeGreaterThan(WhatsAppPacingGate.MAX_INLINE_WAIT_MS);
      expect(result.waitMs).toBeLessThanOrEqual(30_000);
    }
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(store.get('lastSentAt')).toBeUndefined();
  });

  it('reserves the slot before sleeping through a short inline wait', async () => {
    const { gate, store, deliver } = newGate();

    const blockedUntil = Date.now() + 300;
    store.set('blockedUntil', blockedUntil);

    const pending = deliver(() => gate.acquire());
    // Mid-sleep the reservation must already be on storage — that is the
    // whole point of writing before the timer await.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(store.get('lastSentAt')).toBe(blockedUntil);

    expect(await pending).toEqual({ allowed: true });
    expect(store.get('lastSentAt')).toBe(blockedUntil);
  });

  it('blocks acquires after Meta reports a 429 through reportRateLimit', async () => {
    const { gate, deliver } = newGate();

    await deliver(() => gate.reportRateLimit(60_000));
    const result = await deliver(() => gate.acquire());

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.waitMs).toBeGreaterThan(55_000);
      expect(result.waitMs).toBeLessThanOrEqual(60_000);
    }
  });

  it('falls back to the default block when Meta omits Retry-After', async () => {
    const { gate, deliver } = newGate();

    await deliver(() => gate.reportRateLimit());
    const result = await deliver(() => gate.acquire());

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.waitMs).toBeGreaterThan(WhatsAppPacingGate.DEFAULT_BLOCK_MS - 500);
      expect(result.waitMs).toBeLessThanOrEqual(WhatsAppPacingGate.DEFAULT_BLOCK_MS);
    }
  });

  it('reports the remaining wait through waitMs', async () => {
    const { gate, deliver } = newGate();

    await deliver(() => gate.reportRateLimit(60_000));
    const wait = await deliver(() => gate.waitMs());

    expect(wait).toBeGreaterThan(55_000);
    expect(wait).toBeLessThanOrEqual(60_000);
  });
});

describe('WhatsAppPacingGate circuit observability', () => {
  it('counts circuit openings, logs them and exposes them through stats', async () => {
    const { gate, store, deliver } = newGate();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await deliver(() => gate.reportRateLimit(10_000));
    await deliver(() => gate.reportRateLimit(10_000));

    const stats = await deliver(() => gate.stats());
    expect(stats.opens24h).toBe(2);
    expect(stats.blockedUntil).toBeGreaterThan(Date.now());
    expect(store.get('opens_24h')).toBe(2);

    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(errorSpy.mock.calls[0]?.[0]).toBe('circuit_opened');
    expect(JSON.parse(String(errorSpy.mock.calls[0]?.[1]))).toMatchObject({
      blockMs: 10_000,
      opens24h: 1,
    });
    vi.restoreAllMocks();
  });

  it('starts a fresh count once the 24h window elapses', async () => {
    const { gate, deliver } = newGate();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await deliver(() => gate.reportRateLimit(10_000));
    expect((await deliver(() => gate.stats())).opens24h).toBe(1);

    const realNow = Date.now;
    vi.spyOn(Date, 'now').mockReturnValue(realNow() + WhatsAppPacingGate.OPENS_WINDOW_MS + 60_000);
    try {
      await deliver(() => gate.reportRateLimit(10_000));
      expect((await deliver(() => gate.stats())).opens24h).toBe(1);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('exposes the pacing reservation through stats', async () => {
    const { gate, store, deliver } = newGate();
    const lastSentAt = Date.now() - 5;
    store.set('lastSentAt', lastSentAt);

    const stats = await deliver(() => gate.stats());

    expect(stats.lastSentAt).toBe(lastSentAt);
    expect(stats.blockedUntil).toBe(0);
    expect(stats.opens24h).toBe(0);
  });
});
