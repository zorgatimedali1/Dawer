import { apiRequest } from './http';

export interface AnalyticsTotals {
  event_type: string;
  count: number;
}

export interface AnalyticsSummary {
  participations: number;
  coupons: number;
  customers: number;
}

export interface OverviewAnalytics {
  totals: AnalyticsTotals[];
  summary: AnalyticsSummary;
}

export interface CampaignEvent {
  id: string;
  event_type: string;
  event_data: string | null;
  created_at: string;
}

export type RangeDays = 7 | 30 | 90;

export interface TimeseriesPoint {
  day: string;
  participations: number;
  rewardsClaimed: number;
  couponsRedeemed: number;
  total: number;
}

export interface FunnelStage {
  key: string;
  label: string;
  value: number;
  rateFromPrevious: number;
}

export interface FunnelConversion {
  participations: number;
  rewardsClaimed: number;
  couponsRedeemed: number;
  uniqueCustomers: number;
  rewardRate: number;
  redemptionRate: number;
  overallRate: number;
}

export interface FunnelResult {
  stages: FunnelStage[];
  conversion: FunnelConversion;
}

export interface RankedCampaign {
  id: string;
  name: string;
  status: string;
  participations: number;
  customers: number;
}

export interface RankedReward {
  id: string;
  name: string;
  type: string;
  value: number;
  claims: number;
  campaignRewardCount: number;
}

export interface Rankings {
  campaigns: RankedCampaign[];
  rewards: RankedReward[];
}

const EVENT_KEY: Record<string, string> = {
  PARTICIPATION: 'participations',
  COUPON_REDEEMED: 'coupons',
  REWARD_CLAIMED: 'rewards',
  QR_SCANNED: 'scans',
};

export class AnalyticsService {
  static async overview(): Promise<OverviewAnalytics> {
    const result = await apiRequest<{ success: boolean; totals: AnalyticsTotals[]; summary: AnalyticsSummary }>(
      'GET',
      '/api/analytics/overview',
      undefined,
      'Unable to load analytics.',
    );

    const summary = result.summary ?? { participations: 0, coupons: 0, customers: 0 };
    const counts: Record<string, number> = { ...summary };

    for (const row of result.totals ?? []) {
      const key = EVENT_KEY[row.event_type];
      if (key) counts[key] = (counts[key] ?? 0) + Number(row.count);
    }

    return { totals: result.totals ?? [], summary: { ...summary, ...counts } as AnalyticsSummary };
  }

  static async timeSeries(days: 7 | 30 | 90 = 30): Promise<TimeseriesPoint[]> {
    const result = await apiRequest<{ success: boolean; series: TimeseriesPoint[] }>(
      'GET',
      `/api/analytics/timeseries?days=${days}`,
      undefined,
      'Unable to load the activity timeline.',
    );
    return result.series ?? [];
  }

  static async funnel(days: 7 | 30 | 90 = 30): Promise<FunnelResult> {
    const result = await apiRequest<{ success: boolean; stages: FunnelStage[]; conversion: FunnelConversion }>(
      'GET',
      `/api/analytics/funnel?days=${days}`,
      undefined,
      'Unable to load the conversion funnel.',
    );

    return {
      stages: result.stages ?? [],
      conversion: result.conversion ?? {
        participations: 0,
        rewardsClaimed: 0,
        couponsRedeemed: 0,
        uniqueCustomers: 0,
        rewardRate: 0,
        redemptionRate: 0,
        overallRate: 0,
      },
    };
  }

  static async rankings(days: 7 | 30 | 90 = 30): Promise<Rankings> {
    const result = await apiRequest<{ success: boolean; campaigns: RankedCampaign[]; rewards: RankedReward[] }>(
      'GET',
      `/api/analytics/rankings?days=${days}`,
      undefined,
      'Unable to load rankings.',
    );

    return { campaigns: result.campaigns ?? [], rewards: result.rewards ?? [] };
  }

  static async campaignEvents(campaignId: string): Promise<CampaignEvent[]> {
    const result = await apiRequest<{ success: boolean; events: CampaignEvent[] }>(
      'GET',
      `/api/analytics/campaigns/${encodeURIComponent(campaignId)}`,
      undefined,
      'Unable to load campaign analytics.',
    );

    return result.events ?? [];
  }
}
