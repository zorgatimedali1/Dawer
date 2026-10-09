import { settleInterruptedCampaign } from '../durable/whatsapp-batch';
import { settleInterruptedEmailCampaign } from './email';
import { settleInterruptedWebCampaign } from '../routes/whatsapp-web';
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
    table: 'analytics_events',
    ageMs: 400 * DAY_MS,
    sql: 'DELETE FROM analytics_events WHERE rowid IN (SELECT rowid FROM analytics_events WHERE created_at < ? LIMIT ?)',
  },
  {
    table: 'oauth_states',
    ageMs: 30 * 60_000,
    sql: 'DELETE FROM oauth_states WHERE rowid IN (SELECT rowid FROM oauth_states WHERE created_at < ? LIMIT ?)',
  },
];

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

  await runGc(env);
}
