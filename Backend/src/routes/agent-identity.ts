import { hashPassword, secureRandomHex } from '../lib/crypto';
import { errorResponse, jsonResponse } from '../lib/http';
import { SITE_URL } from './oauth';
import type { Env } from '../types';

/**
 * Anonymous agent identity registration — the one auth.md registration method
 * this service offers as its full "anonymous" archetype:
 *
 *   discover (RFC 8414/9728) -> POST /api/agent/identity {type: anonymous}
 *   -> password grant at POST /api/oauth/token -> API -> revoke (/api/auth/logout).
 *
 * Honest limits kept intact:
 *  - The account starts UNOWNED: no business, no e-mail campaigns (verified
 *    e-mail is required for those elsewhere), and the human operator claims
 *    ownership by signing in once at /auth/login with the issued credentials
 *    (claim_url/claim_uri) — that first sign-in auto-starts the Starter trial
 *    through the normal registration-time entitlement path.
 *  - No tokens are minted here: the password grant remains the only token
 *    surface, and the POST accepts nothing besides {"type": "anonymous"}.
 *  - Abuse containment: the mount shares the AUTH_RATE_LIMITER bucket
 *    (fail-closed, ip-only) with /api/auth, since this is exactly an
 *    account-creation surface.
 */

/** Placeholder inbox domain owned by dawer.tn — intentionally non-deliverable. */
const AGENT_EMAIL_SUFFIX = '@agents.dawer.tn';

export async function handleAgentIdentityRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === '/api/agent/identity' && request.method === 'POST') {
    let body: { type?: unknown } | null = null;
    try {
      body = JSON.parse(await request.text()) as { type?: unknown };
    } catch {
      return errorResponse('Invalid JSON body.', 400);
    }

    if (!body || body.type !== 'anonymous') {
      return errorResponse(
        `Unsupported registration type. Dawer accepts only {"type": "anonymous"} — see ${SITE_URL}/auth.md.`,
        400,
      );
    }

    const userId = crypto.randomUUID();
    const email = `agent-${crypto.randomUUID().slice(0, 8)}${AGENT_EMAIL_SUFFIX}`;
    const password = `Anon_${secureRandomHex(16)}`;
    const { hash, salt } = await hashPassword(password);
    const now = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO users (id, email, password_hash, salt, first_name, last_name, email_verified, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'Agent', 'Dawer', 0, ?, ?)`,
    )
      .bind(userId, email, hash, salt, now, now)
      .run();

    return jsonResponse({
      registration_id: `reg_${userId}`,
      registration_type: 'anonymous',
      // The password grant consumes exactly this pair; it is disclosed once,
      // at creation time (the machine's own secret, RFC 8628-ceremony shape).
      credentials: { username: email, password },
      pre_claim_scopes: ['api'],
      post_claim_scopes: ['api'],
      token_endpoint: `${SITE_URL}/api/oauth/token`,
      grant_types_supported: ['password'],
      // Ownership claim: the merchant signs in once with these credentials.
      claim_url: `${SITE_URL}/auth/login`,
      claim_uri: `${SITE_URL}/auth/login`,
      revocation_uri: `${SITE_URL}/api/auth/logout`,
      auth_md: `${SITE_URL}/auth.md`,
    });
  }

  return errorResponse('Route not found.', 404);
}
