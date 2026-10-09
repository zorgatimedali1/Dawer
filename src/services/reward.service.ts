import { apiRequest, buildQuery } from './http';

export interface RewardSummary {
  id: string;
  campaignId: string;
  campaignName: string;
  name: string;
  type: string;
  value: number;
  description: string;
  quantity: number;
  quantityInitial: number | null;
  weight: number;
  active: boolean;
  issuedCount: number;
  updatedAt: string;
}

interface RewardRow {
  id: string;
  campaign_id: string;
  campaign_name: string | null;
  name: string;
  type: string;
  value: string | null;
  description: string | null;
  quantity: number;
  quantity_initial: number | null;
  weight: number;
  active: number;
  issued_count?: number;
  updated_at: string;
}

function mapReward(row: RewardRow): RewardSummary {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    campaignName: row.campaign_name ?? 'Campaign',
    name: row.name,
    type: row.type,
    value: Number(row.value ?? 0),
    description: row.description ?? '',
    quantity: Number(row.quantity ?? 0),
    quantityInitial: row.quantity_initial === null ? null : Number(row.quantity_initial),
    weight: Number(row.weight ?? 0),
    active: Number(row.active ?? 1) === 1,
    issuedCount: Number(row.issued_count ?? 0),
    updatedAt: row.updated_at,
  };
}

export class RewardService {
  static async list(
    options: { campaignId?: string | undefined; search?: string | undefined; active?: boolean | undefined } = {},
  ): Promise<RewardSummary[]> {
    const query = buildQuery({
      campaignId: options.campaignId,
      search: options.search,
      active: options.active === undefined ? undefined : String(options.active),
    });

    const result = await apiRequest<{ success: boolean; rewards: RewardRow[] }>(
      'GET',
      `/api/business/rewards${query}`,
      undefined,
      'Unable to load rewards.',
    );

    return (result.rewards ?? []).map(mapReward);
  }

  static async update(
    rewardId: string,
    changes: { name?: string; description?: string; active?: boolean; quantity?: number; weight?: number },
  ): Promise<RewardSummary> {
    const result = await apiRequest<{ success: boolean; reward: RewardRow }>(
      'PATCH',
      `/api/business/rewards/${encodeURIComponent(rewardId)}`,
      changes,
      'Unable to update the reward.',
    );

    return mapReward(result.reward);
  }

  static async delete(rewardId: string): Promise<void> {
    await apiRequest<{ success: boolean; id: string }>(
      'DELETE',
      `/api/business/rewards/${encodeURIComponent(rewardId)}`,
      undefined,
      'Unable to delete the reward.',
    );
  }
}
