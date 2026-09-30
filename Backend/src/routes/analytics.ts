import { errorResponse, jsonResponse } from '../lib/http';
import { findCampaignForUser, getAuthenticatedUser, getBusinessIds } from '../lib/tenant';
import type { Env } from '../types';

export async function handleAnalyticsRoute(request: Request, env: Env): Promise<Response> {
  const user = await getAuthenticatedUser(request, env);

  if (!user) {
    return errorResponse('Authentication required.', 401);
  }

  const url = new URL(request.url);
  const businessIds = await getBusinessIds(user.id, env);

  if (request.method === 'GET' && url.pathname === '/api/analytics/overview') {
    if (businessIds.length === 0) {
      return jsonResponse({
        success: true,
        totals: [],
        summary: { participations: 0, coupons: 0, customers: 0 },
      });
    }

    const placeholders = businessIds.map(() => '?').join(', ');
    const counts = await env.DB.prepare(
      `SELECT event_type, COUNT(*) AS count
       FROM analytics_events
       WHERE business_id IN (${placeholders})
       GROUP BY event_type
       ORDER BY event_type ASC`,
    )
      .bind(...businessIds)
      .all();

    const summary = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM participations p INNER JOIN campaigns c ON c.id = p.campaign_id
           WHERE c.business_id IN (${placeholders})) AS participations,
         (SELECT COUNT(*) FROM coupons cp WHERE cp.business_id IN (${placeholders})) AS coupons,
         (SELECT COUNT(*) FROM customers cu WHERE cu.business_id IN (${placeholders})) AS customers`,
    )
      .bind(...businessIds, ...businessIds, ...businessIds)
      .first();

    return jsonResponse({
      success: true,
      totals: counts.results ?? [],
      summary: summary ?? { participations: 0, coupons: 0, customers: 0 },
    });
  }

  if (request.method === 'GET' && url.pathname.startsWith('/api/analytics/campaigns/')) {
    const campaignId = url.pathname.slice('/api/analytics/campaigns/'.length);

    if (!campaignId || campaignId.includes('/')) {
      return errorResponse('Campaign id is required.', 400);
    }

    const campaign = await findCampaignForUser(campaignId, businessIds, env);

    if (!campaign) {
      return errorResponse('Campaign not found.', 404);
    }

    const placeholders = businessIds.map(() => '?').join(', ');
    const events = await env.DB.prepare(
      `SELECT id, event_type, event_data, created_at
       FROM analytics_events
       WHERE business_id IN (${placeholders}) AND campaign_id = ?
       ORDER BY created_at DESC
       LIMIT 50`,
    )
      .bind(...businessIds, campaign.id)
      .all();

    return jsonResponse({
      success: true,
      events: events.results ?? [],
    });
  }

  return errorResponse('Route not found.', 404);
}
