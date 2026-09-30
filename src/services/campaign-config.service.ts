export type RewardType =
  | 'percentage_discount'
  | 'fixed_discount'
  | 'free_product'
  | 'free_service'
  | 'custom_reward'
  | 'none';

export type CampaignStatus = 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ARCHIVED';

export interface RewardConfiguration {
  id?: string | undefined;
  name: string;
  description?: string | undefined;
  type?: RewardType | undefined;
  value?: number | undefined;
  weight: number;
  quantity?: number | undefined;
  active?: boolean | undefined;
}

export interface CampaignConfigurationInput {
  title: string;
  description: string;
  googleMapsName: string;
  googleMapsUrl: string;
  googlePlaceId: string;
  facebookUrl: string;
  instagramUrl: string;
  action: 'google-review' | 'instagram' | 'facebook' | 'newsletter' | 'purchase' | 'none';
  campaignId?: string | undefined;
  status?: CampaignStatus | undefined;
  startAt?: string | undefined;
  endAt?: string | undefined;
  rewards?: RewardConfiguration[] | undefined;
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
  status?: string;
  start_at?: string | null;
  end_at?: string | null;
}

interface RewardRecord {
  id: string;
  name: string;
  type: string;
  value: string | null;
  description: string | null;
  quantity: number;
  quantity_initial: number | null;
  weight: number;
  active: number;
}

export function getSessionToken(): string {
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

async function request<T>(method: 'GET' | 'PUT' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: {
      authorization: `Bearer ${getSessionToken()}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  const result = (text ? JSON.parse(text) : {}) as T & { message?: string; error?: string };

  if (!response.ok) {
    throw new Error(result.message ?? result.error ?? 'Unable to load campaign settings.');
  }

  return result;
}

function mapReward(record: RewardRecord): RewardConfiguration {
  return {
    id: record.id,
    name: record.name,
    description: record.description ?? '',
    type: (record.type as RewardType) ?? 'custom_reward',
    value: Number(record.value ?? 0),
    weight: Number(record.weight ?? 0),
    quantity: Number(record.quantity ?? 0),
    active: Number(record.active ?? 1) === 1,
  };
}

export class CampaignConfigService {
  static async load(campaignId?: string): Promise<SavedCampaignConfiguration | null> {
    const query = campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : '';
    const result = await request<{ success: boolean; campaign: CampaignRecord | null; rewards?: RewardRecord[] }>(
      'GET',
      `/api/business/campaign-config${query}`,
    );
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
      action:
        (campaign.require_action?.toLowerCase().replace(/_/g, '-') as CampaignConfigurationInput['action']) ?? 'none',
      status: campaign.status as CampaignStatus | undefined,
      startAt: campaign.start_at ?? undefined,
      endAt: campaign.end_at ?? undefined,
      rewards: (result.rewards ?? []).map(mapReward),
    };
  }

  static async save(config: CampaignConfigurationInput): Promise<SavedCampaignConfiguration> {
    const result = await request<{ success: boolean; campaign: { id: string; publicCode: string } }>(
      'PUT',
      '/api/business/campaign-config',
      config,
    );

    return { ...config, ...result.campaign };
  }
}
