import { z } from 'zod';
import { pickWeightedReward } from '../lib/reward';
import { errorResponse, jsonResponse } from '../lib/http';
import { participationSchema } from '../lib/validation';
import { secureRandomHex, sha256Hex } from '../lib/crypto';
import type { Env } from '../types';

export async function handlePublicCampaignRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const campaignMatch = /^\/api\/public\/campaigns\/([^/]+)$/.exec(url.pathname);

  if (request.method === 'GET' && campaignMatch) {
    const now = new Date().toISOString();
    const campaign = await env.DB.prepare(
      `SELECT c.id, c.name, c.description, c.public_code, c.status, c.start_at, c.end_at, c.game_type,
              c.require_action, c.require_customer_information,
              c.google_maps_name, c.google_maps_url, c.google_place_id, c.facebook_url, c.instagram_url,
              b.name AS business_name
       FROM campaigns c
       LEFT JOIN businesses b ON b.id = c.business_id
       WHERE (c.public_code = ? OR c.id = ?) AND c.status = 'ACTIVE'
         AND (c.start_at IS NULL OR c.start_at <= ?)
         AND (c.end_at IS NULL OR c.end_at >= ?)
       LIMIT 1`,
    )
      .bind(campaignMatch[1], campaignMatch[1], now, now)
      .first<Record<string, unknown>>();

    if (!campaign) {
      return errorResponse('Campaign not found.', 404);
    }

    const rewards = await env.DB.prepare(
      `SELECT id, name, description, type, value, weight, quantity, quantity_initial
       FROM rewards
       WHERE campaign_id = ? AND active = 1
         AND (quantity_initial IS NULL OR quantity_initial = 0 OR quantity > 0)
       ORDER BY weight DESC, created_at ASC`,
    )
      .bind(campaign.id)
      .all();

    return jsonResponse({ success: true, campaign, rewards: rewards.results ?? [] });
  }

  const match = /^\/api\/public\/campaigns\/([^/]+)\/participate$/.exec(url.pathname);

  if (!match) {
    return errorResponse('Route not found.', 404);
  }

  if (request.method !== 'POST') {
    return errorResponse('Method not allowed.', 405);
  }

  try {
    const publicCode = match[1];
    const body = participationSchema.parse(await request.json());
    const nowIso = new Date().toISOString();

    const campaign = await env.DB.prepare(
      `SELECT * FROM campaigns WHERE public_code = ? LIMIT 1`,
    )
      .bind(publicCode)
      .first<any>();

    if (!campaign) {
      return errorResponse('Campaign not found.', 404);
    }

    const withinWindow =
      (!campaign.start_at || campaign.start_at <= nowIso) &&
      (!campaign.end_at || campaign.end_at >= nowIso);

    if (campaign.status !== 'ACTIVE' || !withinWindow) {
      return errorResponse('Campaign is not accepting spins right now.', 409);
    }

    const customerKey = (body.email ?? body.phone ?? `${body.firstName ?? 'guest'}_${body.lastName ?? 'visitor'}`).trim().toLowerCase();
    const customerId = crypto.randomUUID();

    const customerResult = await env.DB.prepare(
      `SELECT id FROM customers WHERE business_id = ? AND LOWER(COALESCE(email, phone, id)) = ? LIMIT 1`,
    )
      .bind(campaign.business_id, customerKey)
      .first<{ id: string }>();

    const resolvedCustomerId = customerResult?.id ?? customerId;

    if (!customerResult) {
      await env.DB.prepare(
        `INSERT INTO customers (id, business_id, first_name, last_name, email, phone, marketing_consent, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          customerId,
          campaign.business_id,
          body.firstName ?? 'Guest',
          body.lastName ?? 'Visitor',
          body.email ?? null,
          body.phone ?? null,
          body.marketingConsent ? 1 : 0,
          new Date().toISOString(),
          new Date().toISOString(),
        )
        .run();
    }

    const lock = env.CAMPAIGN_LOCK.getByName(`campaign:${campaign.id}:${customerKey}`);
    const lockResult = await (lock as any).claim(campaign.id, customerKey);

    if (!lockResult.allowed) {
      return errorResponse('This customer has already participated in this campaign.', 409);
    }

    const rewardRows = await env.DB.prepare(
      `SELECT id, name, description, type, value, weight, quantity, quantity_initial
       FROM rewards
       WHERE campaign_id = ? AND active = 1
         AND (quantity_initial IS NULL OR quantity_initial = 0 OR quantity > 0)
       ORDER BY weight DESC, created_at ASC`,
    )
      .bind(campaign.id)
      .all<any>();

    const selectedReward = pickWeightedReward(
      (rewardRows.results ?? []).map((reward) => ({
        id: reward.id,
        name: reward.name,
        description: reward.description,
        type: reward.type,
        value: reward.value,
        weight: Number(reward.weight ?? 0),
        quantity: Number(reward.quantity ?? 0),
        quantityInitial: Number(reward.quantity_initial ?? 0),
      })),
    );

    if (!selectedReward) {
      return errorResponse('No reward available for this campaign.', 400);
    }

    // Only rewards that were capped at creation time burn stock; an
    // unconfigured quantity means unlimited availability.
    if (selectedReward.quantityInitial > 0) {
      await env.DB.prepare(
        `UPDATE rewards SET quantity = MAX(quantity - 1, 0), updated_at = ?
         WHERE id = ? AND quantity > 0`,
      )
        .bind(nowIso, selectedReward.id)
        .run();
    }

    const couponCode = `CF-${secureRandomHex(8).toUpperCase()}`;
    const participationId = crypto.randomUUID();
    const now = nowIso;

    await env.DB.prepare(
      `INSERT INTO participations (id, campaign_id, customer_id, reward_id, result, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(participationId, campaign.id, resolvedCustomerId, selectedReward.id, selectedReward.name, now)
      .run();

    await env.DB.prepare(
      `INSERT INTO coupons (id, business_id, campaign_id, customer_id, reward_id, code, status, issued_at)
       VALUES (?, ?, ?, ?, ?, ?, 'ISSUED', ?)`,
    )
      .bind(crypto.randomUUID(), campaign.business_id, campaign.id, resolvedCustomerId, selectedReward.id, couponCode, now)
      .run();

    await env.DB.prepare(
      `INSERT INTO analytics_events (id, business_id, campaign_id, event_type, event_data, created_at)
       VALUES (?, ?, ?, 'PARTICIPATION', ?, ?)`,
    )
      .bind(crypto.randomUUID(), campaign.business_id, campaign.id, JSON.stringify({ rewardId: selectedReward.id, customerKey }), now)
      .run();

    if (selectedReward.type !== 'none') {
      await env.DB.prepare(
        `INSERT INTO analytics_events (id, business_id, campaign_id, event_type, event_data, created_at)
         VALUES (?, ?, ?, 'REWARD_CLAIMED', ?, ?)`,
      )
        .bind(crypto.randomUUID(), campaign.business_id, campaign.id, JSON.stringify({ rewardId: selectedReward.id, couponCode }), now)
        .run();
    }

    if (selectedReward.quantityInitial > 0) {
      const refreshed = await env.DB.prepare(`SELECT quantity FROM rewards WHERE id = ? LIMIT 1`)
        .bind(selectedReward.id)
        .first<{ quantity: number }>();
      selectedReward.quantity = Number(refreshed?.quantity ?? 0);
    }

    return jsonResponse({
      success: true,
      participation: {
        campaignId: campaign.id,
        reward: selectedReward,
        couponCode,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse('Validation failed.', 400, error.flatten());
    }

    return errorResponse('Unable to process participation.', 500);
  }
}
