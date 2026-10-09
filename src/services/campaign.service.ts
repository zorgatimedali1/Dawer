import { apiRequest, buildQuery } from './http';

export type CampaignStatusKey =
  | 'draft'
  | 'scheduled'
  | 'active'
  | 'paused'
  | 'completed'
  | 'archived';

export interface Campaign {
  id: string;
  name: string;
  description: string;
  status: CampaignStatusKey;
  publicCode: string;
  startsAt: string;
  endsAt: string;
  participantCount: number;
  rewardCount: number;
  redemptionCount: number;
  conversionRate: number;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignFilters {
  status?: CampaignStatusKey[];
  search?: string;
  page?: number;
  limit?: number;
}

export interface CampaignStats {
  totalCampaigns: number;
  activeCampaigns: number;
  scheduledCampaigns: number;
  completedCampaigns: number;
  totalParticipants: number;
  totalRewardsIssued: number;
  totalCouponsRedeemed: number;
  averageConversionRate: number;
}

interface CampaignRow {
  id: string;
  name: string;
  description: string | null;
  public_code: string;
  status: string;
  start_at: string | null;
  end_at: string | null;
  created_at: string;
  updated_at: string;
  participant_count?: number;
  reward_count?: number;
  redemption_count?: number;
  rewards?: { id: string }[];
}

const STATUS_TO_KEY: Record<string, CampaignStatusKey> = {
  DRAFT: 'draft',
  SCHEDULED: 'scheduled',
  ACTIVE: 'active',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  ARCHIVED: 'archived',
};

const KEY_TO_STATUS: Record<CampaignStatusKey, string> = {
  draft: 'DRAFT',
  scheduled: 'SCHEDULED',
  active: 'ACTIVE',
  paused: 'PAUSED',
  completed: 'COMPLETED',
  archived: 'ARCHIVED',
};

function mapCampaign(row: CampaignRow): Campaign {
  const participantCount = Number(row.participant_count ?? 0);
  const redemptionCount = Number(row.redemption_count ?? 0);

  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    status: STATUS_TO_KEY[row.status] ?? 'draft',
    publicCode: row.public_code ?? '',
    startsAt: row.start_at ?? '',
    endsAt: row.end_at ?? '',
    participantCount,
    rewardCount: Number(row.reward_count ?? row.rewards?.length ?? 0),
    redemptionCount,
    conversionRate: participantCount > 0 ? Math.round((redemptionCount / participantCount) * 1000) / 10 : 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class CampaignService {
  static async getCampaigns(filters: CampaignFilters = {}): Promise<Campaign[]> {
    const status = filters.status?.map((key) => KEY_TO_STATUS[key]).join(',');
    const query = buildQuery({
      status,
      search: filters.search,
      page: filters.page,
      limit: filters.limit,
    });

    const result = await apiRequest<{ success: boolean; campaigns: CampaignRow[] }>(
      'GET',
      `/api/business/campaigns${query}`,
      undefined,
      'Unable to load campaigns.',
    );

    return (result.campaigns ?? []).map(mapCampaign);
  }

  static async getCampaignById(id: string): Promise<Campaign | null> {
    try {
      const result = await apiRequest<{ success: boolean; campaign: CampaignRow }>(
        'GET',
        `/api/business/campaigns/${encodeURIComponent(id)}`,
        undefined,
        'Unable to load the campaign.',
      );
      return mapCampaign(result.campaign);
    } catch (error) {
      if (error instanceof Error && /not found/i.test(error.message)) return null;
      throw error;
    }
  }

  static async createCampaign(data: {
    name: string;
    description?: string;
    startsAt?: string;
    endsAt?: string;
    status?: CampaignStatusKey;
  }): Promise<Campaign> {
    const result = await apiRequest<{ success: boolean; campaign: { id: string; publicCode: string } }>(
      'POST',
      '/api/business/campaigns',
      {
        name: data.name,
        description: data.description ?? '',
        ...(data.status ? { status: KEY_TO_STATUS[data.status] } : {}),
        ...(data.startsAt !== undefined ? { startAt: data.startsAt } : {}),
        ...(data.endsAt !== undefined ? { endAt: data.endsAt } : {}),
      },
      'Unable to create the campaign.',
    );

    const created = await CampaignService.getCampaignById(result.campaign.id);
    if (!created) throw new Error('Campaign was created but could not be loaded.');
    return created;
  }

  static async updateCampaign(id: string, data: Partial<Campaign>): Promise<Campaign> {
    const payload: Record<string, unknown> = {};
    if (data.name !== undefined) payload.name = data.name;
    if (data.description !== undefined) payload.description = data.description;
    if (data.status !== undefined) payload.status = KEY_TO_STATUS[data.status];
    if (data.startsAt !== undefined) payload.startAt = data.startsAt;
    if (data.endsAt !== undefined) payload.endAt = data.endsAt;

    await apiRequest(
      'PATCH',
      `/api/business/campaigns/${encodeURIComponent(id)}`,
      payload,
      'Unable to update the campaign.',
    );

    const updated = await CampaignService.getCampaignById(id);
    if (!updated) throw new Error('Campaign not found.');
    return updated;
  }

  static async deleteCampaign(id: string): Promise<{ archived: boolean }> {
    return apiRequest<{ success: boolean; archived: boolean }>(
      'DELETE',
      `/api/business/campaigns/${encodeURIComponent(id)}`,
      undefined,
      'Unable to delete the campaign.',
    );
  }

  static async duplicateCampaign(id: string): Promise<Campaign> {
    const result = await apiRequest<{ success: boolean; campaign: { id: string; publicCode: string } }>(
      'POST',
      `/api/business/campaigns/${encodeURIComponent(id)}/duplicate`,
      {},
      'Unable to duplicate the campaign.',
    );

    const copy = await CampaignService.getCampaignById(result.campaign.id);
    if (!copy) throw new Error('Campaign was duplicated but could not be loaded.');
    return copy;
  }

  static async getCampaignStats(): Promise<CampaignStats> {
    const campaigns = await CampaignService.getCampaigns({ limit: 100 });

    const totalParticipants = campaigns.reduce((sum, campaign) => sum + campaign.participantCount, 0);
    const totalCouponsRedeemed = campaigns.reduce((sum, campaign) => sum + campaign.redemptionCount, 0);
    const activeCampaigns = campaigns.filter((campaign) => campaign.status === 'active').length;
    const scheduledCampaigns = campaigns.filter((campaign) => campaign.status === 'scheduled').length;
    const completedCampaigns = campaigns.filter((campaign) => campaign.status === 'completed').length;
    const averageConversionRate =
      campaigns.length === 0
        ? 0
        : Math.round(
            (campaigns.reduce((sum, campaign) => sum + campaign.conversionRate, 0) / campaigns.length) * 10,
          ) / 10;

    return {
      totalCampaigns: campaigns.length,
      activeCampaigns,
      scheduledCampaigns,
      completedCampaigns,
      totalParticipants,
      totalRewardsIssued: totalCouponsRedeemed,
      totalCouponsRedeemed,
      averageConversionRate,
    };
  }
}
