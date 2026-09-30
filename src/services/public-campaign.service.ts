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
}

export interface ParticipationInput {
  firstName?: string | undefined;
  lastName?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  marketingConsent?: boolean | undefined;
}

export interface ParticipationResult {
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

export class PublicCampaignService {
  static async load(publicCode: string): Promise<{ campaign: PublicCampaign; rewards: PublicReward[] } | null> {
    const response = await fetch(`/api/public/campaigns/${encodeURIComponent(publicCode)}`);

    if (response.status === 404) return null;
    if (!response.ok) await parseError(response);

    const payload = (await response.json()) as { campaign: PublicCampaign; rewards: PublicReward[] };
    return { campaign: payload.campaign, rewards: payload.rewards ?? [] };
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
}
