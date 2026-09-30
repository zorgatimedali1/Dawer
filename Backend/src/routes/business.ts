import { z } from 'zod';
import { getAuthenticatedUser } from '../lib/tenant';
import { errorResponse, jsonResponse } from '../lib/http';
import { secureRandomHex } from '../lib/crypto';
import { campaignConfigSchema } from '../lib/validation';
import type { Env } from '../types';

export async function handleBusinessRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const user = await getAuthenticatedUser(request, env);

  if (url.pathname === '/api/business/campaign-config') {
    if (!user) {
      return errorResponse('Authentication required.', 401);
    }

    if (request.method === 'GET') {
      const campaign = await env.DB.prepare(
        `SELECT id, name, description, public_code, require_action, google_maps_name,
                google_maps_url, google_place_id, facebook_url, instagram_url
         FROM campaigns
         WHERE business_id IN (SELECT business_id FROM business_members WHERE user_id = ?)
         ORDER BY updated_at DESC
         LIMIT 1`,
      )
        .bind(user.id)
        .first();

      return jsonResponse({ success: true, campaign: campaign ?? null });
    }

    if (request.method === 'PUT') {
      try {
        const config = campaignConfigSchema.parse(await request.json());
        const business = await env.DB.prepare(
          `SELECT business_id FROM business_members WHERE user_id = ? ORDER BY created_at ASC LIMIT 1`,
        )
          .bind(user.id)
          .first<{ business_id: string }>();

        if (!business) {
          return errorResponse('Create a business before saving a campaign.', 404);
        }

        const existing = await env.DB.prepare(
          `SELECT id, public_code FROM campaigns WHERE business_id = ? ORDER BY updated_at DESC LIMIT 1`,
        )
          .bind(business.business_id)
          .first<{ id: string; public_code: string }>();

        const now = new Date().toISOString();
        const values = [
          config.title,
          config.description,
          config.action === 'none' ? 'NONE' : config.action.toUpperCase().replace('-', '_'),
          config.googleMapsName || null,
          config.googleMapsUrl || null,
          config.googlePlaceId || null,
          config.facebookUrl || null,
          config.instagramUrl || null,
          now,
        ] as const;

        let campaignId: string;
        let publicCode: string;

        if (existing) {
          campaignId = existing.id;
          publicCode = existing.public_code;
          await env.DB.prepare(
            `UPDATE campaigns
             SET name = ?, description = ?, require_action = ?, google_maps_name = ?, google_maps_url = ?, google_place_id = ?,
                 facebook_url = ?, instagram_url = ?, updated_at = ?
             WHERE id = ? AND business_id = ?`,
          )
            .bind(...values, campaignId, business.business_id)
            .run();
        } else {
          campaignId = crypto.randomUUID();
          publicCode = secureRandomHex(6).toUpperCase();
          await env.DB.prepare(
            `INSERT INTO campaigns (
              id, business_id, name, description, public_code, status, require_action,
              google_maps_name, google_maps_url, google_place_id, facebook_url, instagram_url, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
            .bind(
              campaignId,
              business.business_id,
              config.title,
              config.description,
              publicCode,
              config.action === 'none' ? 'NONE' : config.action.toUpperCase().replace('-', '_'),
              config.googleMapsName || null,
              config.googleMapsUrl || null,
              config.googlePlaceId || null,
              config.facebookUrl || null,
              config.instagramUrl || null,
              now,
              now,
            )
            .run();
        }

        return jsonResponse({
          success: true,
          campaign: { id: campaignId, publicCode },
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return errorResponse('Validation failed.', 400, error.flatten());
        }

        return errorResponse('Unable to save campaign configuration.', 500);
      }
    }

    return errorResponse('Method not allowed.', 405);
  }

  if (request.method === 'GET' && url.pathname === '/api/business') {
    if (!user) {
      return errorResponse('Authentication required.', 401);
    }

    const businesses = await env.DB.prepare(
      `SELECT b.*
       FROM businesses b
       INNER JOIN business_members bm ON bm.business_id = b.id
       WHERE bm.user_id = ?
       ORDER BY b.created_at DESC`,
    )
      .bind(user.id)
      .all();

    return jsonResponse({
      success: true,
      businesses: businesses.results,
    });
  }

  return errorResponse('Route not found.', 404);
}
