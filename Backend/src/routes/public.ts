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
    const campaign = await env.DB.prepare(
      `SELECT c.id, c.name, c.description, c.public_code, c.status, c.start_at, c.end_at, c.game_type,
              c.require_action, c.google_maps_name, c.google_maps_url, c.google_place_id, c.facebook_url, c.instagram_url,
              b.name AS business_name
       FROM campaigns c
       LEFT JOIN businesses b ON b.id = c.business_id
       WHERE c.public_code = ? AND c.status = 'ACTIVE'
       LIMIT 1`,
    )
      .bind(campaignMatch[1])
      .first();

    if (!campaign) {
      return errorResponse('Campaign not found.', 404);
    }

    return jsonResponse({ success: true, campaign });
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

    const campaign = await env.DB.prepare(
      `SELECT * FROM campaigns WHERE public_code = ? LIMIT 1`,
    )
      .bind(publicCode)
      .first<any>();

    if (!campaign) {
      return errorResponse('Campaign not found.', 404);
    }

    if (campaign.status !== 'ACTIVE') {
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
      `SELECT id, name, weight FROM rewards WHERE campaign_id = ? AND active = 1`,
    )
      .bind(campaign.id)
      .all<any>();

    const selectedReward = pickWeightedReward(
      (rewardRows.results ?? []).map((reward: any) => ({
        id: reward.id,
        name: reward.name,
        weight: Number(reward.weight ?? 0),
      })),
    );

    if (!selectedReward) {
      return errorResponse('No reward available for this campaign.', 400);
    }

    const couponCode = `CF-${secureRandomHex(8).toUpperCase()}`;
    const participationId = crypto.randomUUID();
    const now = new Date().toISOString();

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
