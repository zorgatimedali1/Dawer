import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type AcquireResult = { allowed: true } | { allowed: false; waitMs: number };

/**
 * Platform-wide pacing + circuit breaker for the shared WhatsApp phone number.
 *
 * Every tenant sends through one Meta credential, so per-campaign delays alone
 * cannot stop concurrent broadcasts from stacking on top of each other. This
 * single Durable Object serialises all outbound template sends to at least
 * `MIN_GAP_MS` apart across every campaign, and opens a circuit for a while
 * when Meta answers 429 so one round of failures cannot burn the whole
 * recipient list as "failed".
 */
export class WhatsAppPacingGate extends DurableObject<Env> {
  /** Minimum gap between two platform-wide template sends. */
  static readonly MIN_GAP_MS = 150;
  /** Waits longer than this are handed back so the alarm can re-arm later. */
  static readonly MAX_INLINE_WAIT_MS = 2_000;
  /** Circuit-open default when Meta does not send a Retry-After. */
  static readonly DEFAULT_BLOCK_MS = 5_000;
  static readonly MAX_BLOCK_MS = 120_000;
  /** Rolling window for the "circuit opened N times" observability counter. */
  static readonly OPENS_WINDOW_MS = 86_400_000;

  async acquire(): Promise<AcquireResult> {
    const now = Date.now();
    const blockedUntil = (await this.ctx.storage.get<number>('blockedUntil')) ?? 0;
    const lastSentAt = (await this.ctx.storage.get<number>('lastSentAt')) ?? 0;
    const readyAt = Math.max(blockedUntil, lastSentAt + WhatsAppPacingGate.MIN_GAP_MS);

    if (readyAt > now) {
      const waitMs = readyAt - now;
      if (waitMs > WhatsAppPacingGate.MAX_INLINE_WAIT_MS) return { allowed: false, waitMs };
      // Reserve the slot BEFORE sleeping. The read-modify-write above only
      // awaits storage (input gate closed, so it is atomic), but sleep() is a
      // timer await — the gate reopens and a concurrent acquire() would read
      // the stale lastSentAt and pass too, letting two sends leave together.
      // Writing the reservation first queues every concurrent caller behind
      // this slot instead.
      await this.ctx.storage.put('lastSentAt', readyAt);
      await sleep(waitMs);
      return { allowed: true };
    }

    await this.ctx.storage.put('lastSentAt', now);
    return { allowed: true };
  }

  /** Meta answered 429: pause the whole platform for a while. */
  async reportRateLimit(retryAfterMs?: number): Promise<void> {
    const blockMs = Math.min(
      WhatsAppPacingGate.MAX_BLOCK_MS,
      Math.max(WhatsAppPacingGate.DEFAULT_BLOCK_MS, retryAfterMs ?? 0),
    );
    const now = Date.now();
    const blockedUntil = now + blockMs;
    const current = (await this.ctx.storage.get<number>('blockedUntil')) ?? 0;
    if (blockedUntil > current) await this.ctx.storage.put('blockedUntil', blockedUntil);

    // Count circuit openings in a rolling 24h window: a Meta outage that
    // re-opens the circuit every few minutes must be visible, not silent.
    const resetAt = (await this.ctx.storage.get<number>('opensResetAt')) ?? 0;
    const opens = now >= resetAt ? 1 : ((await this.ctx.storage.get<number>('opens_24h')) ?? 0) + 1;
    await this.ctx.storage.put('opens_24h', opens);
    await this.ctx.storage.put('opensResetAt', resetAt > now ? resetAt : now + WhatsAppPacingGate.OPENS_WINDOW_MS);

    console.error('circuit_opened', JSON.stringify({ blockMs, blockedUntil, opens24h: opens }));
  }

  /** Snapshot for the delivery-status endpoint and dashboards. */
  async stats(): Promise<{ blockedUntil: number; lastSentAt: number; opens24h: number }> {
    const now = Date.now();
    const resetAt = (await this.ctx.storage.get<number>('opensResetAt')) ?? 0;
    const storedOpens = (await this.ctx.storage.get<number>('opens_24h')) ?? 0;
    return {
      blockedUntil: (await this.ctx.storage.get<number>('blockedUntil')) ?? 0,
      lastSentAt: (await this.ctx.storage.get<number>('lastSentAt')) ?? 0,
      opens24h: now >= resetAt ? 0 : storedOpens,
    };
  }

  /** Milliseconds until the next send may leave — used to size alarm backoffs. */
  async waitMs(): Promise<number> {
    const now = Date.now();
    const blockedUntil = (await this.ctx.storage.get<number>('blockedUntil')) ?? 0;
    const lastSentAt = (await this.ctx.storage.get<number>('lastSentAt')) ?? 0;
    return Math.max(0, Math.max(blockedUntil, lastSentAt + WhatsAppPacingGate.MIN_GAP_MS) - now);
  }
}
