import type { Env } from '../types';
import { pacingGateFor, sendTemplateMessage } from '../lib/whatsapp';

/** Meta pacing: 150 ms between outbound template sends. */
export const MESSAGE_DELAY_MS = 150;
/** Recipients handled per alarm invocation — ~3 s of paced sends. */
export const BATCH_SIZE = 20;
/**
 * Hard wall-clock budget for one alarm round: past this the round stops with
 * 'continue' and the leftover recipients continue in the next alarm instead
 * of letting slow Meta calls push a round past the execution budget.
 */
export const ROUND_BUDGET_MS = 25_000;

/**
 * Keeps one alarm round within ~30 s no matter how relaxed the campaign
 * pacing is (relaxed 3000 ms → 10 messages per round instead of 20).
 */
export function effectiveBatchSize(batchSize: number, delayMs: number): number {
  if (!Number.isFinite(delayMs) || delayMs <= 0) return batchSize;
  return Math.max(1, Math.min(batchSize, Math.floor(30_000 / delayMs)));
}

export type BatchOutcome = 'continue' | 'completed' | 'failed';

type CampaignRow = {
  id: string;
  business_id: string;
  template_name: string;
  template_language: string;
  variables: string | null;
  recipients: string;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  status: string;
  message_delay_ms: number | null;
};

type StoredRecipient = { name?: string; phone: string };

function parseRecipients(json: string): StoredRecipient[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? (parsed as StoredRecipient[]) : [];
  } catch {
    return [];
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/**
 * Returns messages of the reservation that were never delivered so the
 * monthly counter is only charged for real sends. Refunds are skipped when
 * the month rolled over in the meantime — the lazy reset already zeroed the
 * old reservation.
 */
async function refundUnsent(env: Env, businessId: string, refund: number): Promise<void> {
  if (refund <= 0) return;
  await env.DB.prepare(
    `UPDATE subscriptions
     SET whatsapp_messages_sent_this_month = max(0, whatsapp_messages_sent_this_month - ?)
     WHERE business_id = ? AND whatsapp_usage_month = ?`,
  )
    .bind(refund, businessId, currentMonth())
    .run();
}

/** One guarded status transition so the quota refund can only fire once. */
async function settleCampaign(
  env: Env,
  campaign: CampaignRow,
  status: 'COMPLETED' | 'FAILED',
  sent: number,
  failed: number,
  error: string | null,
  refund: number,
): Promise<void> {
  const result = await env.DB.prepare(
    `UPDATE whatsapp_campaigns
     SET status = ?, sent_count = ?, failed_count = ?, last_error = ?, updated_at = ?
     WHERE id = ? AND status NOT IN ('COMPLETED', 'FAILED')`,
  )
    .bind(status, sent, failed, error, new Date().toISOString(), campaign.id)
    .run();

  if (Number(result.meta.changes ?? 0) > 0) {
    if (status === 'FAILED') {
      // Structured one-liner so a failed broadcast is alertable in
      // worker logs instead of only visible by inspecting the row.
      console.error(
        'campaign_failed',
        JSON.stringify({ campaignId: campaign.id, sent, failed, reason: error, refunded: refund }),
      );
    }
    await refundUnsent(env, campaign.business_id, refund);
  }
}

/**
 * Settles a campaign whose sender died mid-flight (alarm exhausted its
 * retries, worker restarted, campaign row stranded by a failed schedule).
 * Delivered messages keep their reservation, everything unsent is refunded,
 * and the guarded status transition makes the refund fire at most once.
 */
export async function settleInterruptedCampaign(env: Env, campaignId: string, reason: string): Promise<void> {
  const campaign = await env.DB.prepare(
    `SELECT id, business_id, total_recipients, sent_count, failed_count, status
     FROM whatsapp_campaigns WHERE id = ? LIMIT 1`,
  )
    .bind(campaignId)
    .first<CampaignRow>();

  if (!campaign) return;
  if (campaign.status === 'COMPLETED' || campaign.status === 'FAILED') return;

  await settleCampaign(
    env,
    campaign,
    'FAILED',
    campaign.sent_count,
    campaign.failed_count,
    reason,
    Math.max(0, campaign.total_recipients - campaign.sent_count),
  );
}

/**
 * Processes the next batch of a broadcast: sends up to BATCH_SIZE template
 * messages with a 150 ms gap between Meta calls, persists progress in D1 and
 * either asks for another alarm round ('continue') or settles the campaign
 * (COMPLETED, refunding failed sends; FAILED, refunding everything unsent).
 * The round stops early with 'continue' once `roundBudgetMs` is spent.
 * Exported so tests can drive rounds without a Durable Object alarm; the
 * batch size and round budget are injectable for faster tests.
 */
export async function processBroadcastBatch(
  env: Env,
  campaignId: string,
  batchSize = BATCH_SIZE,
  roundBudgetMs = ROUND_BUDGET_MS,
): Promise<BatchOutcome> {
  const deadline = Date.now() + roundBudgetMs;
  const campaign = await env.DB.prepare(
    `SELECT id, business_id, template_name, template_language, variables, recipients,
            total_recipients, sent_count, failed_count, status, message_delay_ms
     FROM whatsapp_campaigns WHERE id = ? LIMIT 1`,
  )
    .bind(campaignId)
    .first<CampaignRow>();

  if (!campaign) return 'failed';
  if (campaign.status === 'COMPLETED' || campaign.status === 'FAILED') return 'failed';

  if (campaign.status === 'PENDING') {
    await env.DB.prepare(
      `UPDATE whatsapp_campaigns SET status = 'PROCESSING', updated_at = ? WHERE id = ? AND status = 'PENDING'`,
    )
      .bind(new Date().toISOString(), campaignId)
      .run();
  }

  const recipients = parseRecipients(campaign.recipients);
  const cursor = campaign.sent_count + campaign.failed_count;

  if (recipients.length === 0 || cursor >= recipients.length) {
    // Nothing left to send — refund any reservation still held for undelivered
    // messages (also covers a corrupt recipients payload).
    await settleCampaign(
      env,
      campaign,
      'COMPLETED',
      campaign.sent_count,
      campaign.failed_count,
      null,
      Math.max(0, campaign.total_recipients - cursor),
    );
    return 'completed';
  }

  const delay = campaign.message_delay_ms && campaign.message_delay_ms > 0 ? campaign.message_delay_ms : MESSAGE_DELAY_MS;
  const batch = recipients.slice(cursor, cursor + effectiveBatchSize(batchSize, delay));
  let variables: string[] = [];
  try {
    const parsed = campaign.variables ? (JSON.parse(campaign.variables) as unknown) : [];
    if (Array.isArray(parsed)) variables = parsed.map(String);
  } catch {
    variables = [];
  }

  // Running totals include the progress previous rounds already persisted, so
  // the per-message checkpoint below is the single source of truth for counts.
  let sent = campaign.sent_count;
  let failed = campaign.failed_count;
  let lastError: string | null = null;
  let authFailed = false;
  let templateBlocked = false;
  let interrupted = false;

  const pacing = pacingGateFor(env);

  // Checkpoint after every message: a crash now replays at most one send
  // instead of the whole round, and refreshed updated_at keeps the cron
  // reconciler away from live campaigns.
  const checkpointStatement = () =>
    env.DB.prepare(
      `UPDATE whatsapp_campaigns
       SET sent_count = ?, failed_count = ?, last_error = ?, updated_at = ?
       WHERE id = ? AND status NOT IN ('COMPLETED', 'FAILED')`,
    ).bind(sent, failed, lastError, new Date().toISOString(), campaignId);

  for (let index = 0; index < batch.length; index += 1) {
    // Round budget: stop with counts checkpointed so the alarm re-arms and
    // finishes the leftover in the next round.
    if (Date.now() >= deadline) {
      interrupted = true;
      break;
    }

    if (index > 0) await sleep(delay);

    // Platform-wide pacing + circuit breaker: the shared Meta credential must
    // not be hammered by concurrent broadcasts or a 429 storm.
    const slot = await pacing.acquire();
    if (!slot.allowed) {
      interrupted = true;
      break;
    }

    const result = await sendTemplateMessage(env, {
      to: batch[index].phone,
      templateName: campaign.template_name,
      language: campaign.template_language,
      variables,
    });

    if (result.ok) {
      sent += 1;
      // Progress + wamid log in one batched round trip: the log lets webhook
      // status callbacks (delivered/read) roll up per-campaign counters.
      const statements = [checkpointStatement()];
      if (result.messageId) {
        statements.push(
          env.DB.prepare(
            `INSERT OR IGNORE INTO whatsapp_message_log (id, wamid, campaign_id, phone, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'sent', ?, ?)`,
          ).bind(crypto.randomUUID(), result.messageId, campaignId, batch[index].phone, new Date().toISOString(), new Date().toISOString()),
        );
      }
      await env.DB.batch(statements);
      continue;
    }

    if (result.status === 429) {
      // Meta is rate-limiting the number: open the circuit and retry this
      // recipient in a later round instead of burning it as "failed".
      await pacing.reportRateLimit(result.retryAfterMs);
      interrupted = true;
      break;
    }

    failed += 1;
    lastError = result.error ?? 'Send failed.';
    await checkpointStatement().run();
    if (result.authFailed) {
      authFailed = true;
      break;
    }
    if (result.templateBlocked) {
      // The template is dead for every recipient — the rest of the round
      // would fail identically, so stop now and let the campaign settle
      // with everything unsent refunded.
      templateBlocked = true;
      break;
    }
  }

  const finalSent = sent;
  const finalFailed = failed;
  const processed = finalSent + finalFailed;

  if (authFailed || templateBlocked) {
    await settleCampaign(
      env,
      campaign,
      'FAILED',
      finalSent,
      finalFailed,
      lastError ??
        (templateBlocked ? 'Meta rejected the message template.' : 'Meta rejected the credentials.'),
      campaign.total_recipients - finalSent,
    );
    return 'failed';
  }

  if (interrupted) {
    // Pacing or the circuit breaker paused the round — counts are already
    // checkpointed, the caller re-arms with the gate's remaining wait.
    return 'continue';
  }

  if (processed >= recipients.length) {
    await settleCampaign(
      env,
      campaign,
      'COMPLETED',
      finalSent,
      finalFailed,
      lastError,
      // Only successfully delivered messages keep their reservation.
      Math.max(0, campaign.total_recipients - finalSent),
    );
    return 'completed';
  }

  return 'continue';
}
