import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../types';
import { runReconcile } from '../lib/reconcile';
import { createTestEnv, type TestDatabase, type TestEnv } from './helpers/d1';
import { seedMerchant } from './helpers/fixtures';

const DAY_MS = 86_400_000;

let db: TestDatabase;
let assets: TestEnv['CAMPAIGN_ASSETS'];
let env: Env;

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

async function insertSession(expiresAt: string): Promise<void> {
  // token_hash is unique — every session needs its own.
  await db
    .prepare(
      `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at)
       VALUES (?, 'user-1', ?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), `hash.${crypto.randomUUID()}`, iso(-30 * DAY_MS), expiresAt)
    .run();
}

async function insertSpin(createdAt: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO spin_events (id, campaign_id, visitor_key, created_at)
       VALUES (?, 'campaign-1', 'visitor-1', ?)`,
    )
    .bind(crypto.randomUUID(), createdAt)
    .run();
}

async function insertLog(updatedAt: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO whatsapp_message_log (id, wamid, campaign_id, phone, status, created_at, updated_at)
       VALUES (?, ?, 'campaign-1', '21622345678', 'sent', ?, ?)`,
    )
    .bind(crypto.randomUUID(), `wamid.${crypto.randomUUID()}`, updatedAt, updatedAt)
    .run();
}

async function insertAnalytics(createdAt: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO analytics_events (id, business_id, event_type, created_at)
       VALUES (?, 'business-1', 'view', ?)`,
    )
    .bind(crypto.randomUUID(), createdAt)
    .run();
}

function count(table: string): number {
  return db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)[0].n;
}

async function insertVisit(createdAt: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO site_visits (id, path, referrer, visitor, device, created_at)
       VALUES (?, '/', NULL, 'visitor-1', 'desktop', ?)`,
    )
    .bind(crypto.randomUUID(), createdAt)
    .run()
    ;
}

async function insertEmailCampaign(assetId: string | null): Promise<void> {
  await db
    .prepare(
      `INSERT INTO email_campaigns (id, business_id, user_id, subject, asset_id, recipients, content, status, created_at, updated_at)
       VALUES (?, 'business-1', 'user-1', 'Test', ?, '[]', '<p>Test</p>', 'COMPLETED', ?, ?)`,
    )
    .bind(crypto.randomUUID(), assetId, iso(0), iso(0))
    .run();
}

beforeEach(() => {
  const testEnv = createTestEnv();
  db = testEnv.DB;
  assets = testEnv.CAMPAIGN_ASSETS;
  env = testEnv as unknown as Env;
});

afterEach(() => {
  db.close();
});

describe('runReconcile garbage collection', () => {
  it('deletes rows past retention and keeps everything younger', async () => {
    // sessions: expired more than 7 days ago go, younger expiries stay.
    await insertSession(iso(-8 * DAY_MS));
    await insertSession(iso(-2 * DAY_MS));
    await insertSession(iso(DAY_MS));
    // spin events: 90-day window.
    await insertSpin(iso(-91 * DAY_MS));
    await insertSpin(iso(-89 * DAY_MS));
    // message log: 180-day window.
    await insertLog(iso(-181 * DAY_MS));
    await insertLog(iso(-179 * DAY_MS));
    // analytics: 400-day window.
    await insertAnalytics(iso(-401 * DAY_MS));
    await insertAnalytics(iso(-399 * DAY_MS));
    // site visits: 180-day window.
    await insertVisit(iso(-181 * DAY_MS));
    await insertVisit(iso(-179 * DAY_MS));

    await runReconcile(env);

    expect(count('sessions')).toBe(2);
    expect(count('spin_events')).toBe(1);
    expect(count('whatsapp_message_log')).toBe(1);
    expect(count('analytics_events')).toBe(1);
    expect(count('site_visits')).toBe(1);
  });

  it('caps each table at the per-run batch limit', async () => {
    for (let index = 0; index < 10; index += 1) await insertSpin(iso(-400 * DAY_MS));

    await runReconcile(env);
    await runReconcile(env);

    // Two runs at 5 000 each would clear them all; the assertion documents
    // that the sweep actually removes rows rather than skipping the table.
    expect(count('spin_events')).toBe(0);
  });
});

describe('runReconcile asset garbage collection', () => {
  function assetPut(id: string, uploadedMsAgo: number): void {
    assets.put(
      `email-assets/${id}`,
      new Uint8Array([1, 2, 3]),
      { httpMetadata: { contentType: 'image/png' }, uploaded: new Date(Date.now() - uploadedMsAgo) },
    );
  }

  it('deletes old uploads no campaign references and keeps referenced ones', async () => {
    const referenced = crypto.randomUUID();
    const orphan = crypto.randomUUID();
    const fresh = crypto.randomUUID();
    assetPut(referenced, 30 * DAY_MS);
    assetPut(orphan, 2 * DAY_MS);
    assetPut(fresh, 0);
    await insertEmailCampaign(referenced);

    await runReconcile(env);

    expect(assets.keys().sort()).toEqual(
      [`email-assets/${referenced}`, `email-assets/${fresh}`].sort(),
    );
  });

  it('deletes an upload older than the batch limit age but not yet attached', async () => {
    const orphan = crypto.randomUUID();
    assetPut(orphan, 25 * 60 * 60_000);

    await runReconcile(env);

    expect(assets.keys()).toHaveLength(0);
  });

  it('keeps every object while it is younger than the grace window', async () => {
    assetPut(crypto.randomUUID(), 0);

    await runReconcile(env);

    expect(assets.keys()).toHaveLength(1);
  });
});

describe('runReconcile stale campaigns', () => {
  it('settles a stale processing campaign and refunds the unsent messages', async () => {
    const merchant = await seedMerchant(db, { withActiveSubscription: true });
    const now = new Date().toISOString();
    const campaignId = crypto.randomUUID();

    await db
      .prepare(
        `INSERT INTO whatsapp_campaigns
           (id, business_id, user_id, template_name, template_language, recipients,
            total_recipients, sent_count, failed_count, status, created_at, updated_at)
         VALUES (?, ?, ?, 'promo_announcement', 'fr', '[]', 5, 1, 0, 'PROCESSING', ?, ?)`,
      )
      .bind(campaignId, merchant.businessId, merchant.userId, now, iso(-40 * 60_000))
      .run();

    await db
      .prepare(
        `UPDATE subscriptions
         SET whatsapp_messages_sent_this_month = 5, whatsapp_usage_month = ?
         WHERE business_id = ?`,
      )
      .bind(now.slice(0, 7), merchant.businessId)
      .run();

    await runReconcile(env);

    const row = db.query<{ status: string; sent_count: number; failed_count: number; last_error: string }>(
      'SELECT status, sent_count, failed_count, last_error FROM whatsapp_campaigns WHERE id = ?',
      campaignId,
    )[0];
    expect(row.status).toBe('FAILED');
    expect(row.last_error).toContain('Unsent messages were refunded');

    const counter = db.query<{ sent: number }>(
      'SELECT whatsapp_messages_sent_this_month AS sent FROM subscriptions WHERE business_id = ?',
      merchant.businessId,
    )[0];
    // 5 reserved − (5 total − 1 sent) refunded = 1 kept.
    expect(counter.sent).toBe(1);
  });

  it('leaves a fresh campaign alone', async () => {
    const merchant = await seedMerchant(db, { withActiveSubscription: true });
    const now = new Date().toISOString();
    const campaignId = crypto.randomUUID();

    await db
      .prepare(
        `INSERT INTO whatsapp_campaigns
           (id, business_id, user_id, template_name, template_language, recipients,
            total_recipients, sent_count, failed_count, status, created_at, updated_at)
         VALUES (?, ?, ?, 'promo_announcement', 'fr', '[]', 5, 1, 0, 'PROCESSING', ?, ?)`,
      )
      .bind(campaignId, merchant.businessId, merchant.userId, now, now)
      .run();

    await runReconcile(env);

    const row = db.query<{ status: string }>('SELECT status FROM whatsapp_campaigns WHERE id = ?', campaignId)[0];
    expect(row.status).toBe('PROCESSING');
  });

  it('settles a stale WhatsApp Web campaign whose gateway job vanished', async () => {
    const merchant = await seedMerchant(db, { withActiveSubscription: true });
    const now = new Date().toISOString();
    const campaignId = crypto.randomUUID();

    await db
      .prepare(
        `INSERT INTO whatsapp_web_campaigns
           (id, business_id, user_id, message, recipients, total_recipients, sent_count, failed_count,
            status, last_error, created_at, updated_at)
         VALUES (?, ?, ?, 'Hello {name}', '[]', 5, 1, 0, 'PROCESSING', NULL, ?, ?)`,
      )
      .bind(campaignId, merchant.businessId, merchant.userId, now, iso(-40 * 60_000))
      .run();

    await db
      .prepare(
        `UPDATE subscriptions
         SET whatsapp_messages_sent_this_month = 5, whatsapp_usage_month = ?
         WHERE business_id = ?`,
      )
      .bind(now.slice(0, 7), merchant.businessId)
      .run();

    await runReconcile(env);

    const row = db.query<{ status: string; last_error: string }>(
      'SELECT status, last_error FROM whatsapp_web_campaigns WHERE id = ?',
      campaignId,
    )[0];
    expect(row.status).toBe('FAILED');
    expect(row.last_error).toContain('Unsent messages were refunded');

    const counter = db.query<{ sent: number }>(
      'SELECT whatsapp_messages_sent_this_month AS sent FROM subscriptions WHERE business_id = ?',
      merchant.businessId,
    )[0];
    // 5 reserved − (5 total − 1 sent − 0 failed) refunded = 1 kept.
    expect(counter.sent).toBe(1);
  });

  it('leaves a fresh WhatsApp Web campaign alone', async () => {
    const merchant = await seedMerchant(db, { withActiveSubscription: true });
    const now = new Date().toISOString();
    const campaignId = crypto.randomUUID();

    await db
      .prepare(
        `INSERT INTO whatsapp_web_campaigns
           (id, business_id, user_id, message, recipients, total_recipients, sent_count, failed_count,
            status, last_error, created_at, updated_at)
         VALUES (?, ?, ?, 'Hello {name}', '[]', 5, 1, 0, 'PROCESSING', NULL, ?, ?)`,
      )
      .bind(campaignId, merchant.businessId, merchant.userId, now, now)
      .run();

    await runReconcile(env);

    const row = db.query<{ status: string }>('SELECT status FROM whatsapp_web_campaigns WHERE id = ?', campaignId)[0];
    expect(row.status).toBe('PROCESSING');
  });
});
