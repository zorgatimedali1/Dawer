import { errorResponse, jsonResponse } from '../lib/http';
import type { Env } from '../types';

const LIST_PATH = '/api/public/plans';

interface PlanRow {
  name: string;
  slug: string;
  price_cents: number;
  interval: string;
  features: string | null;
}

/**
 * Unauthenticated landing-page pricing feed: the active plans exactly as the
 * operator maintains them in the console, so an edit shows up here without a
 * redeploy. Only marketing-safe fields leave the database — the bullets the
 * visitor reads — never the internal limit/entitlement blob.
 */
async function listPlans(env: Env): Promise<Response> {
  const result = await env.DB.prepare(
    `SELECT name, slug, price_cents, interval, features
     FROM plans
     WHERE active = 1
     ORDER BY price_cents ASC`,
  ).all<PlanRow>();

  const plans = (result.results ?? []).map((row) => {
    let bullets: string[] = [];
    if (row.features) {
      try {
        const parsed = JSON.parse(row.features) as { features?: unknown };
        if (Array.isArray(parsed.features)) {
          bullets = parsed.features.filter((bullet): bullet is string => typeof bullet === 'string');
        }
      } catch {
        // A malformed features blob must never blank the pricing section:
        // the plan still lists with its name and price, just no bullets.
      }
    }

    return {
      name: row.name,
      slug: row.slug,
      priceCents: row.price_cents,
      interval: row.interval,
      features: bullets,
    };
  });

  return jsonResponse({ success: true, plans });
}

/**
 * Public marketing feed for the landing page, mounted ahead of the TN geofence
 * with the public rate-limit bucket and a 30s edge cache (same treatment as
 * the partner marquee): visitors from anywhere see current pricing, and an
 * operator edit is live within the cache window.
 */
export async function handlePublicPlansRoute(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === LIST_PATH) {
      return await listPlans(env);
    }

    if (request.method !== 'GET') return errorResponse('Method not allowed.', 405);
    return errorResponse('Route not found.', 404);
  } catch (error) {
    console.error('Public plans route failed.', error);
    return errorResponse('Unable to load plans.', 500);
  }
}
