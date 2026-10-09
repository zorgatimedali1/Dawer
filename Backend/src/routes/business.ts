import { z } from 'zod';
import { getAuthenticatedUser, getPrimaryBusinessId } from '../lib/tenant';
import { errorResponse, jsonResponse } from '../lib/http';
import { businessCreateSchema } from '../lib/validation';
import { createBusinessForUser, userHasBusiness } from '../lib/business';
import { getBusinessAccess } from '../lib/subscription-access';
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

/**
 * Creates the caller's first business. Google sign-in and registration both
 * allow an account to exist without one, and this is the only way back.
 */
async function handleCreateBusiness(request: Request, env: Env, userId: string): Promise<Response> {
  if (await userHasBusiness(userId, env)) {
    return errorResponse('A business is already linked to this account.', 409);
  }

  let payload: { name: string };

  try {
    payload = businessCreateSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse('Validation failed.', 400, error.flatten());
    }
    return errorResponse('Invalid JSON body.', 400);
  }

  const business = await createBusinessForUser(userId, payload.name, env);
  return jsonResponse({ success: true, business }, 201);
}

export async function handleBusinessRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/api/business' || path.startsWith('/api/business/')) {
    const user = await getAuthenticatedUser(request, env);

    if (!user) {
      return errorResponse('Authentication required.', 401);
    }

    if (path === '/api/business') {
      if (request.method === 'POST') {
        return handleCreateBusiness(request, env, user.id);
      }

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

    if (request.method !== 'GET') {
      const businessId = await getPrimaryBusinessId(user.id, env);
      const access = businessId ? await getBusinessAccess(env, businessId) : null;
      if (businessId && !access?.canManage) {
        return errorResponse('This account is read-only. Activate a plan from Billing to manage your business.', 403);
      }
    }

    if (RECORD_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
      return handleRecordRoute(request, env, user);
    }

    return handleCampaignRoute(request, env, user);
  }

  return errorResponse('Route not found.', 404);
}
