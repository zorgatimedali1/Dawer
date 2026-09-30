import { getAuthenticatedUser } from '../lib/tenant';
import { errorResponse, jsonResponse } from '../lib/http';
import type { Env } from '../types';

export async function handleAnalyticsRoute(request: Request, env: Env): Promise<Response> {
  const user = await getAuthenticatedUser(request, env);

  if (!user) {
    return errorResponse('Authentication required.', 401);
  }

  const url = new URL(request.url);

  if (request.method === 'GET' && url.pathname === '/api/analytics/overview') {
    const counts = await env.DB.prepare(
      `SELECT event_type, COUNT(*) AS count
       FROM analytics_events
       GROUP BY event_type
       ORDER BY event_type ASC`,
    ).all();

    return jsonResponse({
      success: true,
      totals: counts.results,
    });
  }

  if (request.method === 'GET' && /^\/api\/analytics\/campaigns\/.*/.test(url.pathname)) {
    const match = /^\/api\/analytics\/campaigns\/([^/]+)$/.exec(url.pathname);
    const campaignId = match?.[1];

    if (!campaignId) {
      return errorResponse('Campaign id is required.', 400);
    }

    const events = await env.DB.prepare(
      `SELECT * FROM analytics_events WHERE campaign_id = ? ORDER BY created_at DESC LIMIT 50`,
    )
      .bind(campaignId)
      .all();

    return jsonResponse({
      success: true,
      events: events.results,
    });
  }

  return errorResponse('Route not found.', 404);
}
