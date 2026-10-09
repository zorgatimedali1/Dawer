import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../types';
import { handlePublicPartnerRoute } from '../routes/partners';
import { createTestEnv, type TestDatabase } from './helpers/d1';
import { jsonRequest } from './helpers/fixtures';

let db: TestDatabase;
let env: Env;

async function body(response: Response): Promise<{
  success?: boolean;
  partners?: { id: string; name: string; logoUrl: string }[];
}> {
  return (await response.json()) as {
    success?: boolean;
    partners?: { id: string; name: string; logoUrl: string }[];
  };
}

async function seedPartner(id: string, name: string, logoBytes: Uint8Array, contentType = 'image/png') {
  await env.PARTNER_LOGOS.put(`partners/${id}`, logoBytes, { httpMetadata: { contentType } });
  await db
    .prepare('INSERT INTO partners (id, name, logo_url, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, name, `/api/public/partners/${id}/logo`, new Date().toISOString())
    .run();
}

beforeEach(() => {
  const testEnv = createTestEnv();
  db = testEnv.DB;
  env = testEnv as unknown as Env;
});

afterEach(() => {
  db.close();
});

describe('GET /api/public/partners', () => {
  it('returns an empty list before any partner is configured', async () => {
    const response = await handlePublicPartnerRoute(jsonRequest('/api/public/partners', 'GET'), env);
    expect(response.status).toBe(200);
    expect((await body(response)).partners).toEqual([]);
  });

  it('returns every partner with its public logo url', async () => {
    await seedPartner('p1', 'Acme Corp', new Uint8Array([1, 2, 3]));
    await seedPartner('p2', 'Beta Ltd', new Uint8Array([4, 5, 6]));

    const response = await handlePublicPartnerRoute(jsonRequest('/api/public/partners', 'GET'), env);
    const payload = await body(response);

    expect(payload.success).toBe(true);
    expect(payload.partners).toEqual([
      { id: 'p1', name: 'Acme Corp', logoUrl: '/api/public/partners/p1/logo' },
      { id: 'p2', name: 'Beta Ltd', logoUrl: '/api/public/partners/p2/logo' },
    ]);
  });
});

describe('GET /api/public/partners/:id/logo', () => {
  it('streams the stored bytes with their content type', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    await seedPartner('p1', 'Acme Corp', bytes, 'image/webp');

    const response = await handlePublicPartnerRoute(
      jsonRequest('/api/public/partners/p1/logo', 'GET'),
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(response.headers.get('cache-control')).toContain('public');

    const served = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(served)).toEqual(Array.from(bytes));
  });

  it('404s when the object is missing from R2', async () => {
    const response = await handlePublicPartnerRoute(
      jsonRequest('/api/public/partners/ghost/logo', 'GET'),
      env,
    );
    expect(response.status).toBe(404);
  });
});

describe('method handling', () => {
  it('405s non-GET requests', async () => {
    const response = await handlePublicPartnerRoute(
      jsonRequest('/api/public/partners', 'POST', { name: 'x' }),
      env,
    );
    expect(response.status).toBe(405);
  });

  it('404s unknown paths', async () => {
    const response = await handlePublicPartnerRoute(
      jsonRequest('/api/public/partners/extra', 'GET'),
      env,
    );
    expect(response.status).toBe(404);
  });
});
