import { hmacSha256Hex, secureRandomHex, timingSafeEqualString } from './crypto';

/**
 * Signed action tickets (P2-3): the `/action` claim used to be self-asserted
 * — any script could POST it without performing the action. The ticket ties
 * the claim to a real campaign-page load:
 *
 *   * minted only on GET /api/public/campaigns/:code, bound to the visitor's
 *     signed cookie identity and that campaign id;
 *   * carries its issue time, so the server enforces a minimum dwell (the
 *     page must have been open) and an expiry;
 *   * verifiable with a constant-time MAC compare — nothing extra is stored.
 */
export const ACTION_TICKET_MIN_DWELL_MS = 3_000;
export const ACTION_TICKET_TTL_MS = 600_000;

function ticketMessage(campaignId: string, visitorId: string, issuedAt: string, jti: string): string {
  return `action:${campaignId}:${visitorId}:${issuedAt}:${jti}`;
}

export async function mintActionTicket(
  secret: string,
  campaignId: string,
  visitorId: string,
  nowMs: number = Date.now(),
): Promise<string> {
  const issuedAt = String(nowMs);
  const jti = secureRandomHex(16);
  const signature = await hmacSha256Hex(secret, ticketMessage(campaignId, visitorId, issuedAt, jti));
  return `${issuedAt}.${jti}.${signature}`;
}

export type ActionTicketCheck = 'ok' | 'invalid' | 'too_fast' | 'expired';

export async function verifyActionTicket(
  secret: string,
  campaignId: string,
  visitorId: string,
  ticket: string,
  nowMs: number = Date.now(),
): Promise<ActionTicketCheck> {
  const parts = ticket.split('.');
  if (parts.length !== 3) return 'invalid';

  const [issuedAt, jti, signature] = parts;
  if (!/^\d{1,15}$/.test(issuedAt ?? '') || !/^[0-9a-f]{32}$/.test(jti ?? '')) return 'invalid';

  const expected = await hmacSha256Hex(secret, ticketMessage(campaignId, visitorId, issuedAt, jti));
  if (!timingSafeEqualString(signature ?? '', expected)) return 'invalid';

  const age = nowMs - Number(issuedAt);
  if (age < ACTION_TICKET_MIN_DWELL_MS) return 'too_fast';
  if (age > ACTION_TICKET_TTL_MS) return 'expired';
  return 'ok';
}
