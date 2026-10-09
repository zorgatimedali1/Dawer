import { apiRequest } from './http';

export type RewardType =
  | 'percentage_discount'
  | 'fixed_discount'
  | 'free_product'
  | 'free_service'
  | 'custom_reward'
  | 'none';

export type CampaignStatus = 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ARCHIVED';

/** Mirrors the backend `playRulesSchema`: anti-fraud rules stored on the campaign. */
export interface PlayRules {
  mode: 'once' | 'windowed';
  /** Spins allowed per rolling 24 h per identity (windowed mode only). */
  perDay: number;
  /** Minimum minutes between two spins (windowed mode only). */
  cooldownMinutes: number;
  /** Spins allowed per network per rolling 24 h; 0 disables the cap. */
  maxPlaysPerIpDay: number;
  /** Wins allowed per rolling 24 h per identity; 0 disables the budget. */
  winBudget: number;
}

export const DEFAULT_PLAY_RULES: PlayRules = {
  mode: 'once',
  perDay: 1,
  cooldownMinutes: 0,
  maxPlaysPerIpDay: 0,
  winBudget: 1,
};

function parsePlayRules(raw: string | null | undefined): PlayRules | undefined {
  if (!raw) return undefined;

  try {
    const value = JSON.parse(raw) as Partial<PlayRules>;
    if (value.mode !== 'once' && value.mode !== 'windowed') return undefined;

    return {
      mode: value.mode,
      perDay: Number(value.perDay ?? DEFAULT_PLAY_RULES.perDay),
      cooldownMinutes: Number(value.cooldownMinutes ?? DEFAULT_PLAY_RULES.cooldownMinutes),
      maxPlaysPerIpDay: Number(value.maxPlaysPerIpDay ?? DEFAULT_PLAY_RULES.maxPlaysPerIpDay),
      winBudget: Number(value.winBudget ?? DEFAULT_PLAY_RULES.winBudget),
    };
  } catch {
    return undefined;
  }
}

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
  action: 'google-review' | 'instagram' | 'facebook' | 'none';
  campaignId?: string | undefined;
  status?: CampaignStatus | undefined;
  startAt?: string | undefined;
  endAt?: string | undefined;
  rewards?: RewardConfiguration[] | undefined;
  playRules?: PlayRules | undefined;
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
  play_rules?: string | null;
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
    const result = await apiRequest<{ success: boolean; campaign: CampaignRecord | null; rewards?: RewardRecord[] }>(
      'GET', `/api/business/campaign-config${query}`,
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
      playRules: parsePlayRules(campaign.play_rules),
    };
  }

  static async save(config: CampaignConfigurationInput): Promise<SavedCampaignConfiguration> {
    const result = await apiRequest<{ success: boolean; campaign: { id: string; publicCode: string } }>(
      'PUT',
      '/api/business/campaign-config',
      config,
    );

    return { ...config, ...result.campaign };
  }
}
