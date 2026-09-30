export interface CampaignConfigurationInput {
  title: string;
  description: string;
  googleMapsName: string;
  googleMapsUrl: string;
  googlePlaceId: string;
  facebookUrl: string;
  instagramUrl: string;
  action: 'google-review' | 'instagram' | 'facebook' | 'newsletter' | 'purchase' | 'none';
}

export interface SavedCampaignConfiguration extends CampaignConfigurationInput {
  id: string;
  publicCode: string;
}

interface CampaignRecord {
  id: string;
  name: string;
  description: string | null;
  public_code: string;
  require_action: string | null;
  google_maps_name: string | null;
  google_maps_url: string | null;
  google_place_id: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
}

function getSessionToken(): string {
  const session = window.localStorage.getItem('campaign-engage-auth');
  if (!session) throw new Error('Sign in to save campaign settings.');

  try {
    const token = (JSON.parse(session) as { token?: unknown }).token;
    if (typeof token === 'string' && token) return token;
  } catch {
    window.localStorage.removeItem('campaign-engage-auth');
  }

  throw new Error('Your session has expired. Sign in again.');
}

async function request<T>(method: 'GET' | 'PUT', body?: CampaignConfigurationInput): Promise<T> {
  const response = await fetch('/api/business/campaign-config', {
    method,
    headers: {
      authorization: `Bearer ${getSessionToken()}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json() as T & { message?: string; error?: string };

  if (!response.ok) {
    throw new Error(result.message ?? result.error ?? 'Unable to load campaign settings.');
  }

  return result;
}

export class CampaignConfigService {
  static async load(): Promise<SavedCampaignConfiguration | null> {
    const result = await request<{ success: boolean; campaign: CampaignRecord | null }>('GET');
    if (!result.campaign) return null;

    const campaign = result.campaign;
    return {
      id: campaign.id,
      publicCode: campaign.public_code,
      title: campaign.name,
      description: campaign.description ?? '',
      googleMapsName: campaign.google_maps_name ?? '',
      googleMapsUrl: campaign.google_maps_url ?? '',
      googlePlaceId: campaign.google_place_id ?? '',
      facebookUrl: campaign.facebook_url ?? '',
      instagramUrl: campaign.instagram_url ?? '',
      action: campaign.require_action?.toLowerCase().replace('_', '-') as CampaignConfigurationInput['action'] ?? 'none',
    };
  }

  static async save(config: CampaignConfigurationInput): Promise<SavedCampaignConfiguration> {
    const result = await request<{
      success: boolean;
      campaign: { id: string; publicCode: string };
    }>('PUT', config);

    return { ...config, ...result.campaign };
  }
}
