import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../types';
import { handlePartnerAdminRoute } from '../routes/partners';
import { createTestEnv, type TestDatabase } from '../../tests/helpers/d1';
import {
  jsonRequest,
  operatorRequest,
  seedOperator,
  type SeededOperator,
} from '../../tests/helpers/fixtures';

let db: TestDatabase;
let env: Env;
let operator: SeededOperator;

type PartnerPayload = {
  success?: boolean;
  message?: string;
  error?: string;
  partner?: { id: string; name: string; logoUrl: string; createdAt: string };
  partners?: { id: string; name: string; logoUrl: string; createdAt: string }[];
};

async function body(response: Response): Promise<PartnerPayload> {
  return (await response.json()) as PartnerPayload;
}

const LOGO_BASE64 = btoa('fake-png-bytes');

/** The R2 test stub exposes a keys() helper the real binding does not. */
function logoStore(): { keys(): string[] } {
  return env.PARTNER_LOGOS as unknown as { keys(): string[] };
}

function createRequest(token?: string) {
  return operatorRequest(
    '/api/admin/partners',
    'POST',
    { name: 'Acme Corp', mimeType: 'image/png', dataBase64: LOGO_BASE64 },
    token,
  );
}

beforeEach(async () => {
  const testEnv = createTestEnv();
  db = testEnv.DB;
  env = testEnv as unknown as Env;
  operator = await seedOperator(db);
});

afterEach(() => {
  db.close();
});

describe('partner admin authorization', () => {
  it('401s the list without a session cookie', async () => {
    const response = await handlePartnerAdminRoute(jsonRequest('/api/admin/partners', 'GET'), env);
    expect(response.status).toBe(401);
  });

  it('401s a create without a session cookie', async () => {
    const response = await handlePartnerAdminRoute(createRequest(), env);
    expect(response.status).toBe(401);
    expect((await body(response)).error).toContain('Authentication required');
  });

  it('401s a delete without a session cookie', async () => {
    const response = await handlePartnerAdminRoute(
      jsonRequest('/api/admin/partners/some-id', 'DELETE'),
      env,
    );
    expect(response.status).toBe(401);
  });
});

describe('POST /api/admin/partners', () => {
  it('stores the logo in R2 and the row in D1', async () => {
    const response = await handlePartnerAdminRoute(createRequest(operator.token), env);
    expect(response.status).toBe(201);

    const payload = await body(response);
    expect(payload.success).toBe(true);
    expect(payload.partner?.name).toBe('Acme Corp');
    expect(payload.partner?.logoUrl).toBe(`/api/public/partners/${payload.partner?.id}/logo`);

    const row = await db
      .prepare('SELECT id, name, logo_url FROM partners WHERE id = ?')
      .bind(payload.partner?.id)
      .first<{ id: string; name: string; logo_url: string }>();
    expect(row?.name).toBe('Acme Corp');
    expect(row?.logo_url).toBe(payload.partner?.logoUrl);

    const keys = logoStore().keys();
    expect(keys).toContain(`partners/${payload.partner?.id}`);
  });

  it('400s an empty partner name', async () => {
    const response = await handlePartnerAdminRoute(
      operatorRequest(
        '/api/admin/partners',
        'POST',
        { name: '   ', mimeType: 'image/png', dataBase64: LOGO_BASE64 },
        operator.token,
      ),
      env,
    );
    expect(response.status).toBe(400);
    expect((await body(response)).message).toContain('Validation failed');
  });

  it('400s an unsupported image type', async () => {
    const response = await handlePartnerAdminRoute(
      operatorRequest(
        '/api/admin/partners',
        'POST',
        { name: 'Acme', mimeType: 'application/pdf', dataBase64: LOGO_BASE64 },
        operator.token,
      ),
      env,
    );
    expect(response.status).toBe(400);
  });
});

describe('GET /api/admin/partners', () => {
  it('lists partners oldest first', async () => {
    await handlePartnerAdminRoute(createRequest(operator.token), env);
    await handlePartnerAdminRoute(
      operatorRequest(
        '/api/admin/partners',
        'POST',
        { name: 'Beta Ltd', mimeType: 'image/png', dataBase64: LOGO_BASE64 },
        operator.token,
      ),
      env,
    );

    const response = await handlePartnerAdminRoute(
      operatorRequest('/api/admin/partners', 'GET', undefined, operator.token),
      env,
    );
    expect(response.status).toBe(200);

    const payload = await body(response);
    expect((payload.partners ?? []).map((partner) => partner.name)).toEqual([
      'Acme Corp',
      'Beta Ltd',
    ]);
    expect(payload.partners?.[0]?.createdAt).toBeTruthy();
  });
});

describe('DELETE /api/admin/partners/:id', () => {
  it('removes the row and the R2 object', async () => {
    const created = await body(await handlePartnerAdminRoute(createRequest(operator.token), env));
    const id = created.partner?.id;
    expect(id).toBeTruthy();

    const response = await handlePartnerAdminRoute(
      operatorRequest(`/api/admin/partners/${id}`, 'DELETE', undefined, operator.token),
      env,
    );
    expect(response.status).toBe(200);

    const row = await db.prepare('SELECT id FROM partners WHERE id = ?').bind(id).first();
    expect(row).toBeNull();
    expect(logoStore().keys()).not.toContain(`partners/${id}`);
  });

  it('404s an unknown partner', async () => {
    const response = await handlePartnerAdminRoute(
      operatorRequest('/api/admin/partners/does-not-exist', 'DELETE', undefined, operator.token),
      env,
    );
    expect(response.status).toBe(404);
  });
});

describe('method handling', () => {
  it('405s unsupported methods on the collection', async () => {
    const response = await handlePartnerAdminRoute(
      operatorRequest('/api/admin/partners', 'PUT', { name: 'x' }, operator.token),
      env,
    );
    expect(response.status).toBe(405);
  });

  it('404s unknown paths', async () => {
    const response = await handlePartnerAdminRoute(
      operatorRequest('/api/admin/partners/abc/edit', 'GET', undefined, operator.token),
      env,
    );
    expect(response.status).toBe(404);
  });
});
