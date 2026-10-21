import { errorResponse } from '../lib/http';
import { sha256Hex } from '../lib/crypto';
import type { Env } from '../types';

const MAX_PATH_LENGTH = 200;

interface VisitBody {
  path?: unknown;
}

const BOT_PATTERN = /bot|crawl|spider|slurp|headless|curl|wget|python-requests/i;
const MOBILE_PATTERN = /iPhone|Windows Phone|Android(?:[^;)]*Mobile)|iPod/i;
const TABLET_PATTERN = /iPad|Tablet|Android(?!.*Mobile)/i;

function classifyDevice(userAgent: string): string {
  if (BOT_PATTERN.test(userAgent)) return 'bot';
  if (MOBILE_PATTERN.test(userAgent)) return 'mobile';
  if (TABLET_PATTERN.test(userAgent)) return 'tablet';
  return 'desktop';
}

/**
 * Pseudonymous visitor key: one day of IP + user agent through SHA-256,
 * truncated to 16 hex chars. Counts uniques but holds nothing reversible, and
 * it rotates at UTC midnight so an old hash never links to a new one.
 */
async function visitorHash(ip: string, userAgent: string, day: string): Promise<string> {
  const digest = await sha256Hex(`${ip}\u0000${userAgent}\u0000${day}`);
  return digest.slice(0, 16);
}

function parseReferrer(request: Request): string | null {
  const raw = request.headers.get('referer');
  if (!raw) return null;
  try {
    // Hostname only: full referrer URLs carry page paths we don't need.
    const host = new URL(raw).hostname;
    return host ? host.slice(0, MAX_PATH_LENGTH) : null;
  } catch {
    return null;
  }
}

/**
 * Unauthenticated page-view beacon fired once per route change by the SPA
 * (`src/components/visit-beacon.tsx`). Mounted ahead of the TN geofence with
 * the public rate-limit bucket so visits from anywhere are counted.
 */
export async function handleVisitRoute(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);

  try {
    let body: VisitBody;
    try {
      body = (await request.json()) as VisitBody;
    } catch {
      return errorResponse('Invalid JSON body.', 400);
    }
    if (typeof body?.path !== 'string') return errorResponse('A path string is required.', 400);

    // Queries and fragments never reached the SPA route, and a hostile caller
    // gets a hard truncation instead of a write of unbounded size.
    let path = body.path.replace(/[?#].*$/, '').slice(0, MAX_PATH_LENGTH);
    if (!path.startsWith('/')) return errorResponse('A path starting with / is required.', 400);

    const userAgent = request.headers.get('user-agent') ?? '';
    const referrer = parseReferrer(request);
    const now = new Date().toISOString();
    const visitor = await visitorHash(request.headers.get('cf-connecting-ip') ?? 'unknown', userAgent, now.slice(0, 10));

    await env.DB.prepare(
      'INSERT INTO site_visits (id, path, referrer, visitor, device, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(crypto.randomUUID(), path, referrer, visitor, classifyDevice(userAgent), now)
      .run();

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('Visit beacon route failed.', error);
    return errorResponse('Unable to record the visit.', 500);
  }
}
