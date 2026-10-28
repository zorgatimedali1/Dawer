import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../types';
import { CampaignParticipationLock } from '../durable/campaign-lock';
import type { ClaimOutcome } from '../durable/campaign-lock';

type StorageValue = unknown;

function fakeStorage() {
  const map = new Map<string, StorageValue>();
  return {
    async get<T = unknown>(key: string): Promise<T | undefined> {
      return map.get(key) as T | undefined;
    },
    async put<T>(key: string, value: T): Promise<void> {
      map.set(key, value);
    },
    async delete(key: string): Promise<boolean> {
      return map.delete(key);
    },
    async list(options?: { prefix?: string }): Promise<Map<string, unknown>> {
      const prefix = options?.prefix ?? '';
      const entries = [...map.entries()].filter(([key]) => key.startsWith(prefix));
      return new Map(entries);
    },
    map,
  };
}

function fakeDurableObject(storage: ReturnType<typeof fakeStorage>) {
  return { storage } as never;
}

let storage: ReturnType<typeof fakeStorage>;
let lock: CampaignParticipationLock;

beforeEach(() => {
  storage = fakeStorage();
  lock = new CampaignParticipationLock(fakeDurableObject(storage), {} as Env);
});

afterEach(() => {
  storage.map.clear();
});

const WINDOWED = { mode: 'windowed' as const, perDay: 2, cooldownMinutes: 0 };

describe('CampaignParticipationLock claim/release', () => {
  it('once-mode claims are permanent until their granted timestamp is released', async () => {
    const first = await lock.claim('c1', 'v1');
    expect(first).toMatchObject({ allowed: true });
    expect(await lock.claim('c1', 'v1')).toEqual({ allowed: false, reason: 'duplicate_spin' });

    await lock.release('c1', 'v1', claim(first));
    // Freed: the next claim succeeds again.
    expect((await lock.claim('c1', 'v1')).allowed).toBe(true);
  });

  it('ignores stale timestamps when releasing a permanent claim', async () => {
    const granted = await lock.claim('c1', 'v1');
    await lock.release('c1', 'v1', claim(granted) - 1);

    const state = await storage.get('c1:v1');
    expect(state).toMatchObject({ claimedAt: claim(granted) });
  });

  it('windowed release removes exactly the granted timestamp, not the array tail', async () => {
    const first = claim(await lock.claim('c1', 'v1', WINDOWED));
    const second = claim(await lock.claim('c1', 'v1', WINDOWED));

    await lock.release('c1', 'v1', second);

    const state = await storage.get<{ claims: number[] }>('c1:v1');
    expect(state?.claims).toEqual([first]);

    // The window has room again (perDay 2) and the cooldown anchor is first.
    let outcome = await lock.claim('c1', 'v1', WINDOWED);
    expect(outcome.allowed).toBe(true);

    // The refilled window denies a fourth attempt (perDay = 2).
    outcome = await lock.claim('c1', 'v1', WINDOWED);
    expect(outcome).toEqual({ allowed: false, reason: 'daily_limit' });
  });

  it('windowed release of an unknown timestamp is a no-op', async () => {
    const first = claim(await lock.claim('c1', 'v1', WINDOWED));
    await lock.release('c1', 'v1', first + 5);

    const state = await storage.get<{ claims: number[] }>('c1:v1');
    expect(state?.claims).toEqual([first]);
  });

  it('releasing every claim keeps wins and drops the key only when empty', async () => {
    const first = claim(await lock.claim('c1', 'v1', WINDOWED));
    await lock.recordWin('c1', 'v1');
    await lock.release('c1', 'v1', first);

    // Wins alone keep the record alive; the stale window claim is gone.
    expect(await lock.getWinCount('c1', 'v1')).toBe(1);
    const state = await storage.get<{ claims: number[]; wins: number[] }>('c1:v1');
    expect(state?.claims).toEqual([]);
    expect(state?.wins?.length ?? 0).toBe(1);
  });
});

describe('CampaignParticipationLock daily spin cap reservations', () => {
  it('refuses the spin that would exceed capacity', async () => {
    expect(await lock.reserveDailySpinCount('c1', 2)).toBe(true);
    expect(await lock.reserveDailySpinCount('c1', 2)).toBe(true);
    expect(await lock.reserveDailySpinCount('c1', 2)).toBe(false);
  });

  it('hands a reservation back so the next spin can take it', async () => {
    expect(await lock.reserveDailySpinCount('c1', 1)).toBe(true);
    expect(await lock.reserveDailySpinCount('c1', 1)).toBe(false);

    await lock.releaseDailySpinCount('c1');
    expect(await lock.reserveDailySpinCount('c1', 1)).toBe(true);
  });

  it('release is a no-op below zero', async () => {
    await lock.releaseDailySpinCount('c1');
    expect(storage.map.get(dailyKeyNow('c1'))).toBeUndefined();
  });
});

function dailyKeyNow(campaignId: string): string {
  return `#cap:${campaignId}:${new Date().toISOString().slice(0, 10)}`;
}

function claim(outcome: ClaimOutcome): number {
  if (!outcome.allowed) throw new Error(`Unexpected denied claim: ${'reason' in outcome ? outcome.reason : 'unknown'}`);
  return outcome.claimedAt;
}
