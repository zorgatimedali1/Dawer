import { settleInterruptedCampaign } from '../durable/whatsapp-batch';
import { settleInterruptedEmailCampaign } from './email';
import { settleInterruptedWebCampaign } from '../routes/whatsapp-web';
import { settleInterruptedSmsCampaign } from '../routes/sms';
import type { Env } from '../types';

/**
 * A campaign with no sender left behind it (DO alarm exhausted its retries,
 * schedule() failed after the row was written, platform glitch) would sit in
 * PENDING/PROCESSING forever: the broadcast endpoints 409 on every retry and
 * the quota reservation is never released. This runs on a cron trigger every
 * 10 minutes and settles anything that has not progressed for 30 minutes —
 * FAILED with a refund of every unsent message. The guarded status
 * transition makes the refund fire at most once even if a slow sender is
 * still alive.
 */
const STALE_AFTER_MS = 30 * 60_000;
const SETTLE_BATCH_LIMIT = 50;

const SETTLE_ERROR = 'The campaign stopped making progress. Unsent messages were refunded.';

const DAY_MS = 86_400_000;
/**
 * Row cap per table per run: D1 has no DELETE ... LIMIT, so the sweep goes
 * through a rowid subselect. At one run per 10 minutes the cap still clears
 * far more than any workload can produce while keeping each write small.
 */
const GC_BATCH_LIMIT = 5_000;

const GC_RULES: Array<{ table: string; ageMs: number; sql: string }> = [
  {
    table: 'sessions',
    ageMs: 7 * DAY_MS,
    sql: 'DELETE FROM sessions WHERE rowid IN (SELECT rowid FROM sessions WHERE expires_at < ? LIMIT ?)',
  },
  {
    table: 'spin_events',
    ageMs: 90 * DAY_MS,
    sql: 'DELETE FROM spin_events WHERE rowid IN (SELECT rowid FROM spin_events WHERE created_at < ? LIMIT ?)',
  },
  {
    table: 'whatsapp_message_log',
    ageMs: 180 * DAY_MS,
    sql: 'DELETE FROM whatsapp_message_log WHERE rowid IN (SELECT rowid FROM whatsapp_message_log WHERE updated_at < ? LIMIT ?)',
  },
  {
    table: 'whatsapp_web_message_log',
    ageMs: 180 * DAY_MS,
    sql: 'DELETE FROM whatsapp_web_message_log WHERE rowid IN (SELECT rowid FROM whatsapp_web_message_log WHERE created_at < ? LIMIT ?)',
  },
  {
    table: 'sms_message_log',
    ageMs: 180 * DAY_MS,
    sql: 'DELETE FROM sms_message_log WHERE rowid IN (SELECT rowid FROM sms_message_log WHERE updated_at < ? LIMIT ?)',
  },
  {
    table: 'analytics_events',
    ageMs: 400 * DAY_MS,
    sql: 'DELETE FROM analytics_events WHERE rowid IN (SELECT rowid FROM analytics_events WHERE created_at < ? LIMIT ?)',
  },
  {
    table: 'analytics_events',
    ageMs: 400 * DAY_MS,
    sql: 'DELETE FROM analytics_events WHERE rowid IN (SELECT rowid FROM analytics_events WHERE created_at < ? LIMIT ?)',
  },
  {
    table: 'site_visits',
    ageMs: 180 * DAY_MS,
    sql: 'DELETE FROM site_visits WHERE rowid IN (SELECT rowid FROM site_visits WHERE created_at < ? LIMIT ?)',
  },
];

/**
 * Uploaded-but-never-attached assets (tabs closed mid-compose, dropped
 * uploads) would otherwise sit in R2 forever: attachment ownership lives in
 * object metadata, not in a database row the sweeper could truncate.
 * Referenced objects are never touched regardless of age — their keys are
 * embedded in e-mails already delivered, and deleting the bytes would 404
 * every attachment link still sitting in a recipient's inbox.
 */
const ASSET_PREFIX = 'email-assets/';
const ASSET_GRACE_MS = 24 * 60 * 60_000;
const ASSET_LIST_LIMIT = 50;

/**
 * Bounded garbage collection for tables that only grow: expired sessions,
 * spin history, message logs and analytics events past their retention
 * window, and consumed OAuth states. A failing table is logged and skipped —
 * GC must never take the sweeper down with it.
 */
async function runGc(env: Env): Promise<void> {
  const deleted: Record<string, number> = {};

  for (const rule of GC_RULES) {
    const cutoff = new Date(Date.now() - rule.ageMs).toISOString();
    try {
      const result = await env.DB.prepare(rule.sql).bind(cutoff, GC_BATCH_LIMIT).run();
      const count = Number(result.meta.changes ?? 0);
      if (count > 0) deleted[rule.table] = count;
    } catch (error) {
      console.error('Reconciler GC failed.', rule.table, error);
    }
  }

  if (Object.keys(deleted).length > 0) {
    console.log('Reconciler GC.', JSON.stringify(deleted));
  }
}

async function gcUnreferencedAssets(env: Env): Promise<void> {
  const cutoff = Date.now() - ASSET_GRACE_MS;
  let deleted = 0;
  let truncated = true;

  try {
    while (truncated) {
      const page = await env.CAMPAIGN_ASSETS.list({ prefix: ASSET_PREFIX, limit: ASSET_LIST_LIMIT });
      truncated = page.truncated === true;

      const candidates = page.objects.filter((object) => {
        const id = object.key.slice(ASSET_PREFIX.length);
        return /^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(id) && object.uploaded.getTime() < cutoff;
      });
      if (candidates.length === 0) continue;

      const ids = candidates.map((object) => object.key.slice(ASSET_PREFIX.length));
      const referenced = new Set(
        (
          await env.DB.prepare(
            `SELECT DISTINCT asset_id FROM email_campaigns WHERE asset_id IN (${ids.map(() => '?').join(',')})`,
          )
            .bind(...ids)
            .all<{ asset_id: string }>()
        ).results?.map((row) => row.asset_id) ?? [],
      );

      for (const id of ids) {
        if (referenced.has(id)) continue;
        await env.CAMPAIGN_ASSETS.delete(`${ASSET_PREFIX}${id}`);
        deleted += 1;
      }
    }
  } catch (error) {
    console.error('Reconciler asset GC failed.', error);
  }

  if (deleted > 0) {
    console.log('Reconciler GC. unreferenced_email_assets', deleted);
  }
}

export async function runReconcile(env: Env): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();

  const whatsapp = await env.DB.prepare(
    `SELECT id FROM whatsapp_campaigns
     WHERE status IN ('PENDING', 'PROCESSING') AND updated_at < ?
     ORDER BY updated_at ASC LIMIT ?`,
  )
    .bind(cutoff, SETTLE_BATCH_LIMIT)
    .all<{ id: string }>();

  for (const row of whatsapp.results ?? []) {
    try {
      await settleInterruptedCampaign(env, row.id, SETTLE_ERROR);
    } catch (error) {
      console.error('Reconciler could not settle a WhatsApp campaign.', row.id, error);
    }
  }

  const email = await env.DB.prepare(
    `SELECT id FROM email_campaigns
     WHERE status IN ('PENDING', 'PROCESSING') AND updated_at < ?
     ORDER BY updated_at ASC LIMIT ?`,
  )
    .bind(cutoff, SETTLE_BATCH_LIMIT)
    .all<{ id: string }>();

  for (const row of email.results ?? []) {
    try {
      await settleInterruptedEmailCampaign(env, row.id, SETTLE_ERROR);
    } catch (error) {
      console.error('Reconciler could not settle an email campaign.', row.id, error);
    }
  }

  // WhatsApp Web campaigns settle only through gateway callbacks; when the
  // gateway restarts mid-job no callback ever arrives and the row would stay
  // PROCESSING forever, blocking every new broadcast with a 409.
  const whatsappWeb = await env.DB.prepare(
    `SELECT id FROM whatsapp_web_campaigns
     WHERE status IN ('QUEUED', 'PROCESSING') AND updated_at < ?
     ORDER BY updated_at ASC LIMIT ?`,
  )
    .bind(cutoff, SETTLE_BATCH_LIMIT)
    .all<{ id: string }>();

  for (const row of whatsappWeb.results ?? []) {
    try {
      await settleInterruptedWebCampaign(env, row.id, SETTLE_ERROR);
    } catch (error) {
      console.error('Reconciler could not settle a WhatsApp Web campaign.', row.id, error);
    }
  }

  // SMS campaigns settle unconditionally: the gateway has no retry queue, so
  // a dispatch loop that died mid-flight will never make progress again and
  // every still-PENDING row is refunded (reserved quota back to the merchant).
  const sms = await env.DB.prepare(
    `SELECT id FROM sms_campaigns
     WHERE status IN ('QUEUED', 'PROCESSING') AND updated_at < ?
     ORDER BY updated_at ASC LIMIT ?`,
  )
    .bind(cutoff, SETTLE_BATCH_LIMIT)
    .all<{ id: string }>();

  for (const row of sms.results ?? []) {
    try {
      await settleInterruptedSmsCampaign(env, row.id, SETTLE_ERROR);
    } catch (error) {
      console.error('Reconciler could not settle an SMS campaign.', row.id, error);
    }
  }

  await runGc(env);
  await gcUnreferencedAssets(env);
}
