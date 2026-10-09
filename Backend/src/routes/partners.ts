import { errorResponse, jsonResponse } from '../lib/http';
import type { Env } from '../types';

const LIST_PATH = '/api/public/partners';
const LOGO_PATTERN = /^\/api\/public\/partners\/([^/]+)\/logo$/;

// Mirrors partnerLogoKey() in the platform route: the D1 row only carries the
// serving path, the bytes live in R2 under this deterministic key.
function partnerLogoKey(partnerId: string): string {
  return `partners/${partnerId}`;
}

interface PartnerRow {
  id: string;
  name: string;
  logo_url: string;
  created_at: string;
}

async function listPartners(env: Env): Promise<Response> {
  const result = await env.DB.prepare(
    'SELECT id, name, logo_url, created_at FROM partners ORDER BY created_at ASC',
  ).all<PartnerRow>();

  const partners = (result.results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    logoUrl: row.logo_url,
  }));
  return jsonResponse({ success: true, partners });
}

async function servePartnerLogo(env: Env, partnerId: string): Promise<Response> {
  const object = await env.PARTNER_LOGOS.get(partnerLogoKey(partnerId));
  if (!object) return errorResponse('Logo not found.', 404);

  const contentType = object.httpMetadata?.contentType ?? 'image/png';
  // `object.body` streams straight through: the adapter forwards the bytes
  // untouched, so SVG/PNG payloads never round-trip through UTF-8.
  return new Response(object.body, {
    headers: {
      'content-type': contentType,
      'cache-control': 'public, max-age=0, s-maxage=30',
    },
  });
}

/**
 * Unauthenticated landing-page feed: the partner marquee list plus the logo
 * bytes themselves. Mounted ahead of the geofence on the main worker (public
 * marketing content) with its own rate limiter and a 30s edge cache.
 */
export async function handlePublicPartnerRoute(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === LIST_PATH) {
      return await listPartners(env);
    }

    const logoMatch = LOGO_PATTERN.exec(url.pathname);
    if (request.method === 'GET' && logoMatch?.[1]) {
      return await servePartnerLogo(env, logoMatch[1]);
    }

    if (request.method !== 'GET') return errorResponse('Method not allowed.', 405);
    return errorResponse('Route not found.', 404);
  } catch (error) {
    console.error('Public partners route failed.', error);
    return errorResponse('Unable to load partners.', 500);
  }
}
