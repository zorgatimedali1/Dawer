import { partnerCreateSchema } from '../../lib/validation';
import { errorResponse, jsonResponse } from '../../lib/http';
import { writeAuditLog } from '../../lib/tenant';
import { renderRouteError, requireOperator } from '../lib/guard';
import type { Env } from '../../types';

const LIST_PATH = '/api/admin/partners';
const ITEM_PATTERN = /^\/api\/admin\/partners\/([^/]+)$/;

/** R2 object key for a partner logo; the public route derives the same key. */
export function partnerLogoKey(partnerId: string): string {
  return `partners/${partnerId}`;
}

/** Public serving path stored in `partners.logo_url`. */
export function partnerLogoPath(partnerId: string): string {
  return `/api/public/partners/${partnerId}/logo`;
}

interface PartnerRow {
  id: string;
  name: string;
  logo_url: string;
  created_at: string;
}

interface PartnerDto {
  id: string;
  name: string;
  logoUrl: string;
  createdAt: string;
}

function describePartner(row: PartnerRow): PartnerDto {
  return { id: row.id, name: row.name, logoUrl: row.logo_url, createdAt: row.created_at };
}

const PARTNER_COLUMNS = 'id, name, logo_url, created_at';

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function listPartners(request: Request, env: Env): Promise<Response> {
  await requireOperator(request, env);
  const result = await env.DB.prepare(
    `SELECT ${PARTNER_COLUMNS} FROM partners ORDER BY created_at ASC`,
  ).all<PartnerRow>();
  return jsonResponse({ success: true, partners: (result.results ?? []).map(describePartner) });
}

async function createPartner(request: Request, env: Env): Promise<Response> {
  const operator = await requireOperator(request, env);
  const input = partnerCreateSchema.parse(await request.json());

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const bytes = decodeBase64(input.dataBase64);

  // Bytes go to R2 first: a row whose object never landed would render a
  // broken logo on the public landing page.
  await env.PARTNER_LOGOS.put(partnerLogoKey(id), bytes, {
    httpMetadata: { contentType: input.mimeType },
  });

  const logoUrl = partnerLogoPath(id);
  await env.DB.prepare(
    `INSERT INTO partners (id, name, logo_url, created_at) VALUES (?, ?, ?, ?)`,
  )
    .bind(id, input.name, logoUrl, now)
    .run();

  await writeAuditLog(env, {
    businessId: null,
    userId: null,
    platformOperatorId: operator.id,
    action: 'ADMIN_PARTNER_CREATED',
    entityType: 'partner',
    entityId: id,
    metadata: { name: input.name },
  });

  const partner: PartnerDto = { id, name: input.name, logoUrl, createdAt: now };
  return jsonResponse({ success: true, partner }, 201);
}

async function deletePartner(request: Request, env: Env, partnerId: string): Promise<Response> {
  const operator = await requireOperator(request, env);
  const row = await env.DB.prepare(
    `SELECT ${PARTNER_COLUMNS} FROM partners WHERE id = ? LIMIT 1`,
  )
    .bind(partnerId)
    .first<PartnerRow>();

  if (!row) return errorResponse('Partner not found.', 404);

  await env.PARTNER_LOGOS.delete(partnerLogoKey(partnerId));
  await env.DB.prepare('DELETE FROM partners WHERE id = ?').bind(partnerId).run();

  await writeAuditLog(env, {
    businessId: null,
    userId: null,
    platformOperatorId: operator.id,
    action: 'ADMIN_PARTNER_DELETED',
    entityType: 'partner',
    entityId: partnerId,
    metadata: { name: row.name },
  });

  return jsonResponse({ success: true });
}

/** Operator console CRUD for the landing-page partner marquee. */
export async function handlePartnerAdminRoute(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);

    if (url.pathname === LIST_PATH) {
      if (request.method === 'GET') return await listPartners(request, env);
      if (request.method === 'POST') return await createPartner(request, env);
      return errorResponse('Method not allowed.', 405);
    }

    const itemMatch = ITEM_PATTERN.exec(url.pathname);
    if (itemMatch?.[1]) {
      if (request.method === 'DELETE') return await deletePartner(request, env, itemMatch[1]);
      return errorResponse('Method not allowed.', 405);
    }

    return errorResponse('Route not found.', 404);
  } catch (error) {
    return renderRouteError(error, 'Partners admin route failed.');
  }
}
