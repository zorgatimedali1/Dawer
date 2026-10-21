import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../types';
import { createTestEnv, type TestDatabase } from './helpers/d1';
import { handleVisitRoute } from '../routes/visits';
import { handleStatsRoute } from '../platform/routes/stats';
import {
  jsonRequest,
  operatorRequest,
  seedOperator,
  type SeededOperator,
} from './helpers/fixtures';

let db: TestDatabase;
let env: Env;
let operator: SeededOperator;

async function body(response: Response) {
  return (await response.json()) as Record<string, any>;
}

function visitRequest(
  path: string,
  options: {
    ip?: string;
    userAgent?: string;
    referer?: string;
    method?: string;
    body?: unknown;
  } = {},
) {
  return new Request(`https://example.test/api/public/visit`, {
    method: options.method ?? 'POST',
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': options.ip ?? '41.226.10.1',
      'user-agent': options.userAgent ?? 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
      ...(options.referer ? { referer: options.referer } : {}),
    },
    ...(options.method === 'GET' ? {} : { body: JSON.stringify(options.body ?? { path }) }),
  });
}

beforeEach(async () => {
  const testEnv = createTestEnv();
  db = testEnv.DB;
  env = testEnv as unknown as Env;
  await seedOperator(db).then((seeded) => {
    operator = seeded;
  });
});

afterEach(() => {
  db.close();
});

describe('public visit beacon', () => {
  it('records a page view with referrer host, device and a per-day visitor hash', async () => {
    const response = await handleVisitRoute(
      visitRequest('/', { referer: 'https://www.google.com/search?q=dawer' }),
      env,
    );
    expect(response.status).toBe(204);

    const row = await db
      .prepare('SELECT path, referrer, visitor, device FROM site_visits LIMIT 1')
      .first<{ path: string; referrer: string; visitor: string; device: string }>();
    expect(row?.path).toBe('/');
    expect(row?.referrer).toBe('www.google.com');
    expect(row?.device).toBe('mobile');
    expect(row?.visitor).toMatch(/^[0-9a-f]{16}$/);
  });

  it('collapses queries and fragments out of the path', async () => {
    await handleVisitRoute(visitRequest('/dashboard/analytics?tab=2#foot'), env);

    const row = await db.prepare('SELECT path FROM site_visits LIMIT 1').first<{ path: string }>();
    expect(row?.path).toBe('/dashboard/analytics');
  });

  it('hashes the same visitor identically for one day and different IPs apart', async () => {
    await handleVisitRoute(visitRequest('/', { ip: '41.226.10.1' }), env);
    await handleVisitRoute(visitRequest('/dashboard', { ip: '41.226.10.1' }), env);
    await handleVisitRoute(visitRequest('/', { ip: '197.14.5.9' }), env);

    const rows = await db
      .prepare('SELECT visitor, COUNT(*) AS hits FROM site_visits GROUP BY visitor ORDER BY hits DESC')
      .all<{ visitor: string; hits: number }>();
    expect(rows.results).toHaveLength(2);
    expect(Number(rows.results[0]?.hits ?? 0)).toBe(2);
    expect(Number(rows.results[1]?.hits ?? 0)).toBe(1);
  });

  it('classifies desktop and bot user agents', async () => {
    await handleVisitRoute(
      visitRequest('/', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0' }),
      env,
    );
    await handleVisitRoute(visitRequest('/', { userAgent: 'python-requests/2.31.0' }), env);

    const rows = await db
      .prepare("SELECT device FROM site_visits ORDER BY created_at ASC")
      .all<{ device: string }>();
    expect(rows.results.map((row) => row.device)).toEqual(['desktop', 'bot']);
  });

  it('rejects malformed payloads and wrong methods', async () => {
    expect((await handleVisitRoute(visitRequest('/', { method: 'GET' }), env)).status).toBe(405);
    expect(
      (await handleVisitRoute(visitRequest('/x', { body: { path: 123 } }), env)).status,
    ).toBe(400);
    expect(
      (await handleVisitRoute(visitRequest('/x', { body: {} }), env)).status,
    ).toBe(400);
    expect(
      (await handleVisitRoute(visitRequest('not-a-path', { body: { path: 'https://evil.example' } }), env)).status,
    ).toBe(400);
    await handleVisitRoute(visitRequest(`/${'a'.repeat(400)}`), env);
    const longest = await db
      .prepare('SELECT MAX(LENGTH(path)) AS size FROM site_visits')
      .first<{ size: number }>();
    expect(Number(longest?.size ?? 0)).toBe(200);
  });
});

describe('operator website-traffic stats', () => {
  it('aggregates home vs dashboard vs other plus referrers and recent list', async () => {
    await handleVisitRoute(visitRequest('/', { ip: '41.226.10.1' }), env);
    await handleVisitRoute(visitRequest('/dashboard/overview', { ip: '41.226.10.1' }), env);
    await handleVisitRoute(visitRequest('/dashboard/campaigns', { ip: '41.226.10.1' }), env);
    await handleVisitRoute(visitRequest('/wheels/demo', { ip: '197.14.5.9', userAgent: 'Chrome/120.0' }), env);
    await handleVisitRoute(visitRequest('/privacy', { ip: '197.14.5.9', referer: 'https://tawassol.tn' }), env);

    const response = await handleStatsRoute(
      operatorRequest('/api/admin/stats/visits?days=7', 'GET', undefined, operator.token),
      env,
    );
    expect(response.status).toBe(200);
    const payload = await body(response);

    expect(payload.days).toBe(7);
    expect(payload.totals).toEqual({ total: 5, home: 1, dashboard: 2, other: 2, unique: 3 });
    expect(payload.series).toHaveLength(7);
    const today = payload.series.at(-1);
    expect(today).toEqual({ day: expect.any(String), home: 1, dashboard: 2, other: 2 });
    expect(payload.topPaths).toContainEqual({ path: '/dashboard/overview', total: 1 });
    expect(payload.topPaths).toHaveLength(5);
    // Empty referrers collapse under "(direct)".
    expect(payload.referrers).toContainEqual({ referrer: '(direct)', total: 4 });
    expect(payload.referrers).toContainEqual({ referrer: 'tawassol.tn', total: 1 });
    expect(payload.devices).toContainEqual({ device: 'mobile', total: 4 });
    expect(payload.devices).toContainEqual({ device: 'desktop', total: 1 });
    expect(payload.recent).toHaveLength(5);
    expect(payload.recent[0]).toMatchObject({ path: expect.any(String), device: expect.any(String) });
  });

  it('zero-fills empty days and rejects a missing operator session', async () => {
    const empty = await handleStatsRoute(
      operatorRequest('/api/admin/stats/visits?days=3', 'GET', undefined, operator.token),
      env,
    );
    const payload = await body(empty);
    expect(payload.series).toEqual([
      { day: expect.any(String), home: 0, dashboard: 0, other: 0 },
      { day: expect.any(String), home: 0, dashboard: 0, other: 0 },
      { day: expect.any(String), home: 0, dashboard: 0, other: 0 },
    ]);

    const noSession = await handleStatsRoute(jsonRequest('/api/admin/stats/visits', 'GET'), env);
    expect(noSession.status).toBe(401);
  });
});
