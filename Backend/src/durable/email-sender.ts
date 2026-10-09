import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types';
import { EMAIL_PACE_MS, msUntilUtcMidnight, processEmailBatch, settleInterruptedEmailCampaign } from '../lib/email';

/** Retries of a failing alarm round before the campaign is settled FAILED. */
const MAX_ALARM_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 30_000;

/**
 * One instance per campaign (named by campaign id). The POST endpoint
 * schedules it and answers 202 immediately; each alarm round delivers one
 * Resend batch chunk and re-arms with pacing until the campaign settles.
 *
 * Delivery lives in `lib/email.ts` so tests can drive rounds without touching
 * `cloudflare:workers`. A throwing round is retried with backoff and
 * eventually settled FAILED with a refund, so a crash can never strand the
 * campaign in PENDING (permanent 409, quota reservation held forever).
 */
export class EmailBroadcastSender extends DurableObject<Env> {
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
      const outcome = await processEmailBatch(this.envRef, campaignId);
      await this.ctx.storage.put('attempts', 0);
      if (outcome === 'continue') {
        await this.ctx.storage.setAlarm(Date.now() + EMAIL_PACE_MS);
      } else if (outcome === 'paused') {
        // Daily quota: sleep until Resend's UTC midnight reset (+2s buffer),
        // then the next round resumes the same campaign where it left off.
        await this.ctx.storage.setAlarm(Date.now() + msUntilUtcMidnight() + 2_000);
      }
    } catch (error) {
      console.error('Email broadcast round failed.', error);

      if (attempts + 1 >= MAX_ALARM_ATTEMPTS) {
        await settleInterruptedEmailCampaign(
          this.envRef,
          campaignId,
          'The email sender failed repeatedly. Unsent emails were refunded.',
        );
        await this.ctx.storage.put('attempts', 0);
        return;
      }

      await this.ctx.storage.put('attempts', attempts + 1);
      await this.ctx.storage.setAlarm(Date.now() + RETRY_BACKOFF_MS * 2 ** attempts);
    }
  }
}
