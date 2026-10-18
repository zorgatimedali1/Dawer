import type { WheelTheme } from '@/lib/wheel-theme';

export interface PublicReward {
  id: string;
  name: string;
  description: string | null;
  type: string;
  value: string | null;
  weight: number;
  quantity: number;
}

export interface PublicCampaign {
  id: string;
  name: string;
  description: string | null;
  public_code: string;
  status: string;
  start_at: string | null;
  end_at: string | null;
  game_type: string;
  require_action: string | null;
  require_customer_information: number;
  google_maps_name: string | null;
  google_maps_url: string | null;
  google_place_id: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  business_name: string | null;
  business_logo: string | null;
  play_rules: string | null;
  /** Effective wheel design (plan + operator override already resolved). */
  wheel_theme?: WheelTheme | null;
  /** Center-hub image URL; present when the theme asks for a center logo. */
  wheel_logo?: string | null;
  /** Resolved place coordinates; null when the merchant set no location (P2-7). */
  latitude: number | null;
  longitude: number | null;
}

export interface ParticipationInput {
  firstName?: string | undefined;
  lastName?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  marketingConsent?: boolean | undefined;
  anonymousId?: string | undefined;
  deviceHash?: string | undefined;
  latitude?: number | undefined;
  longitude?: number | undefined;
}

export interface CustomerDetailsInput {
  firstName: string;
  lastName?: string;
  email: string;
  phone: string;
  marketingConsent?: boolean | undefined;
}

export interface ParticipationResult {
  participationId: string;
  reward: {
    id: string;
    name: string;
    description: string | null;
    type: string;
    value: string | null;
    weight: number;
  };
  couponCode: string;
}

async function parseError(response: Response): Promise<never> {
  let message = 'Something went wrong. Please try again.';
  try {
    const payload = (await response.json()) as { message?: string; error?: string };
    message = payload.message ?? payload.error ?? message;
  } catch {
    // Non-JSON error body; keep the fallback message.
  }
  throw new Error(message);
}

/**
 * Signed action tickets come from the campaign GET and are consumed by the
 * single /action claim — kept in module state (never storage) so the ticket
 * only exists while this page is open, exactly like the server-side TTL.
 */
const actionTickets = new Map<string, string>();

export class PublicCampaignService {
  static async load(publicCode: string): Promise<{
    campaign: PublicCampaign;
    rewards: PublicReward[];
  } | null> {
    const response = await fetch(`/api/public/campaigns/${encodeURIComponent(publicCode)}`);

    if (response.status === 404) return null;
    if (!response.ok) await parseError(response);

    const payload = (await response.json()) as {
      campaign: PublicCampaign;
      rewards: PublicReward[];
      actionTicket?: string;
    };

    if (payload.actionTicket) actionTickets.set(publicCode, payload.actionTicket);
    else actionTickets.delete(publicCode);

    return {
      campaign: payload.campaign,
      rewards: payload.rewards ?? [],
    };
  }

  static async participate(publicCode: string, input: ParticipationInput): Promise<ParticipationResult> {
    const response = await fetch(`/api/public/campaigns/${encodeURIComponent(publicCode)}/participate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });

    if (!response.ok) await parseError(response);

    const payload = (await response.json()) as { participation: ParticipationResult };
    return payload.participation;
  }

  static async recordAction(
    publicCode: string,
    input: {
      anonymousId: string;
      action: string;
      deviceHash?: string | undefined;
    },
  ): Promise<void> {
    const actionTicket = actionTickets.get(publicCode);
    const response = await fetch(`/api/public/campaigns/${encodeURIComponent(publicCode)}/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...input,
        ...(actionTicket ? { actionTicket } : {}),
      }),
    });

    if (!response.ok) await parseError(response);
    // The ticket is one-shot: a replay (or a second gate) must reload the
    // campaign page, which is exactly what the server enforces as well.
    actionTickets.delete(publicCode);
  }

  static async submitCustomerDetails(
    publicCode: string,
    participationId: string,
    input: CustomerDetailsInput,
  ): Promise<string> {
    const response = await fetch(
      `/api/public/campaigns/${encodeURIComponent(publicCode)}/participations/${encodeURIComponent(participationId)}/customer`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      },
    );

    if (!response.ok) await parseError(response);

    const payload = (await response.json()) as { couponCode?: string };
    return payload.couponCode ?? '';
  }
}
