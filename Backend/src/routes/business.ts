import { getAuthenticatedUser } from '../lib/tenant';
import { errorResponse, jsonResponse } from '../lib/http';
import { handleCampaignRoute } from './campaigns';
import { handleRecordRoute } from './records';
import type { Env } from '../types';

const RECORD_PREFIXES = [
  '/api/business/customers',
  '/api/business/coupons',
  '/api/business/rewards',
  '/api/business/qr-codes',
  '/api/business/posters',
];

export async function handleBusinessRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/api/business' || path.startsWith('/api/business/')) {
    const user = await getAuthenticatedUser(request, env);

    if (!user) {
      return errorResponse('Authentication required.', 401);
    }

    if (path === '/api/business') {
      if (request.method !== 'GET') {
        return errorResponse('Method not allowed.', 405);
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

      return jsonResponse({ success: true, businesses: businesses.results });
    }

    if (RECORD_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
      return handleRecordRoute(request, env, user);
    }

    return handleCampaignRoute(request, env, user);
  }

  return errorResponse('Route not found.', 404);
}
