import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types';
import { pacingGateFor } from '../lib/whatsapp';
import { MESSAGE_DELAY_MS, processBroadcastBatch, settleInterruptedCampaign } from './whatsapp-batch';

/** Retries of a failing alarm round before the campaign is settled FAILED. */
const MAX_ALARM_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 30_000;

/**
 * One instance per broadcast (named by campaign id). The POST endpoint calls
 * `schedule`, which arms an alarm; each alarm round processes a batch and
 * re-arms with the 150 ms pacing until the campaign settles.
 *
 * The actual sending lives in `whatsapp-batch.ts` so tests can drive rounds
 * without touching `cloudflare:workers`.
 *
 * A throwing round is retried with backoff and eventually settled FAILED with
 * a refund: an uncaught exception would exhaust the platform's own alarm
 * retries and strand the campaign in PROCESSING forever (permanent 409 on the
 * broadcast endpoint, quota reservation never released).
 */
export class WhatsAppBroadcastSender extends DurableObject<Env> {
  private readonly envRef: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.envRef = env;
  }

  async schedule(campaignId: string): Promise<void> {
    await this.ctx.storage.put('campaignId', campaignId);
    await this.ctx.storage.put('attempts', 0);
    await this.ctx.storage.setAlarm(Date.now());
  }

  async alarm(): Promise<void> {
    const campaignId = await this.ctx.storage.get<string>('campaignId');
    if (!campaignId) return;

    const attempts = (await this.ctx.storage.get<number>('attempts')) ?? 0;

    try {
      const outcome = await processBroadcastBatch(this.envRef, campaignId);
      await this.ctx.storage.put('attempts', 0);
      if (outcome === 'continue') {
        // Respect an open platform circuit (Meta 429) beyond the usual pacing.
        const pacing = pacingGateFor(this.envRef);
        const waitMs = await pacing.waitMs();
        await this.ctx.storage.setAlarm(Date.now() + Math.max(MESSAGE_DELAY_MS, waitMs));
      }
    } catch (error) {
      console.error(
        'broadcast_round_failed',
        JSON.stringify({ campaignId, attempt: attempts + 1, error: String(error) }),
      );

      if (attempts + 1 >= MAX_ALARM_ATTEMPTS) {
        await settleInterruptedCampaign(
          this.envRef,
          campaignId,
          'The broadcast sender failed repeatedly. Unsent messages were refunded.',
        );
        await this.ctx.storage.put('attempts', 0);
        return;
      }

      await this.ctx.storage.put('attempts', attempts + 1);
      await this.ctx.storage.setAlarm(Date.now() + RETRY_BACKOFF_MS * 2 ** attempts);
    }
  }
}
