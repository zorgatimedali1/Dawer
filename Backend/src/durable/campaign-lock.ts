import { DurableObject } from 'cloudflare:workers';

export class CampaignParticipationLock extends DurableObject<never> {
  constructor(ctx: DurableObjectState, _env: never) {
    super(ctx, _env);
  }

  async claim(campaignId: string, customerKey: string): Promise<{ allowed: boolean; reason?: string }> {
    const scopeKey = `${campaignId}:${customerKey}`;
    const existing = await this.ctx.storage.get(scopeKey);

    if (existing) {
      return {
        allowed: false,
        reason: 'duplicate_spin',
      };
    }

    await this.ctx.storage.put(scopeKey, {
      campaignId,
      customerKey,
      claimedAt: Date.now(),
    });

    return { allowed: true };
  }
}
