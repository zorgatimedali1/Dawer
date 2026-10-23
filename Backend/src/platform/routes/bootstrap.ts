import { z } from 'zod';
import { hashPassword, timingSafeEqualString } from '../../lib/crypto';
import { errorResponse, jsonResponse } from '../../lib/http';
import { isCrossSitePost } from '../../lib/security';
import { loginSchema } from '../../lib/validation';
import type { Env } from '../../types';

/**
 * First-run operator provisioning. The committed seed credential was removed
 * from the migrations (a PBKDF2 hash + salt published on a public repo is an
 * offline brute-force oracle), so a fresh install provisions its first
 * operator through this route once, guarded by a secret token. It goes inert
 * by design the moment any operator row exists — no further calls are ever
 * accepted. Mounting it outside the auth limiter is safe: every request pays
 * for the missing token with a 404 and no database work.
 */
const BOOTSTRAP_SCHEMA = loginSchema
  .omit({ turnstileToken: true })
  .extend({
    firstName: z.string().trim().max(60).optional(),
    lastName: z.string().trim().max(60).optional(),
  });

export async function handlePlatformBootstrapRoute(request: Request, env: Env): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (!path.endsWith('/bootstrap')) {
    return errorResponse('Route not found.', 404);
  }
  if (request.method !== 'POST' || isCrossSitePost(request)) {
    return errorResponse('Method not allowed.', 405);
  }

  // Fail closed: with no secret provisioned the route must never exist.
  const expectedToken = env.PLATFORM_BOOTSTRAP_TOKEN;
  const rawToken = request.headers.get('x-bootstrap-token');
  if (!expectedToken || !rawToken || !timingSafeEqualString(rawToken, expectedToken)) {
    return errorResponse('Route not found.', 404);
  }

  try {
    const existing = await env.DB.prepare('SELECT id FROM platform_operators LIMIT 1').first();

    if (existing) {
      return errorResponse('Bootstrap is already complete.', 409);
    }

    const body = BOOTSTRAP_SCHEMA.parse(await request.json());
    const email = body.email.trim().toLowerCase();
    const { salt, hash } = await hashPassword(body.password);
    const now = new Date().toISOString();

    // Two concurrent calls could both see an empty table before this point;
    // the window requires the secret token and a manual one-time step, so the
    // unique email index is the accepted backstop rather than a transaction.
    let inserted = true;
    try {
      await env.DB.prepare(
        `INSERT INTO platform_operators (id, email, password_hash, salt, first_name, last_name, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
      )
        .bind(crypto.randomUUID(), email, hash, salt, body.firstName ?? null, body.lastName ?? null, now, now)
        .run();
    } catch {
      // A same-email duplicate means another bootstrap call won the race.
      inserted = false;
    }

    if (!inserted) {
      return errorResponse('Bootstrap is already complete.', 409);
    }

    return jsonResponse({ success: true }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse('Validation failed.', 400, error.flatten());
    }

    console.error('Operator bootstrap failed.', error);
    return errorResponse('Unable to complete the bootstrap.', 500);
  }
}
