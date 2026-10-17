import { apiRequest } from './http';

export interface AnalyticsTotals {
  event_type: string;
  count: number;
}

export interface AnalyticsSummary {
  participations: number;
  coupons: number;
  redeemed: number;
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

/**
 * The backend caches each analytics response in KV for 1h (≤ 7-day windows)
 * or 3h (longer). `fresh: true` appends `fresh=1`, which bypasses that cache,
 * recomputes from D1 and re-arms the window — the server's Refresh escape
 * hatch when a merchant wants numbers newer than the cached snapshot.
 */
export interface AnalyticsFetchOptions {
  fresh?: boolean | undefined;
}

function withFresh(path: string, options?: AnalyticsFetchOptions): string {
  if (!options?.fresh) return path;
  // The overview endpoint has no query string of its own, so blindly prefixing
  // '&fresh=1' produced the path '/overview&fresh=1' → 404. Pick the right
  // separator for whatever the caller's path already contains.
  return `${path}${path.includes('?') ? '&' : '?'}fresh=1`;
}

export interface TimeseriesPoint {
  day: string;
  participations: number;
  rewardsClaimed: number;
  couponsRedeemed: number;
  scans: number;
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

export class AnalyticsService {
  static async overview(options?: AnalyticsFetchOptions): Promise<OverviewAnalytics> {
    const result = await apiRequest<{ success: boolean; totals: AnalyticsTotals[]; summary: AnalyticsSummary }>(
      'GET',
      withFresh('/api/analytics/overview', options),
      undefined,
      'Unable to load analytics.',
    );

    // Summary is the backend's own table count — event totals are a separate
    // list. Merging them used to add the same participations/coupons twice.
    const summary = result.summary;
    return {
      totals: result.totals ?? [],
      summary: {
        participations: Number(summary?.participations ?? 0),
        coupons: Number(summary?.coupons ?? 0),
        redeemed: Number(summary?.redeemed ?? 0),
        customers: Number(summary?.customers ?? 0),
      },
    };
  }

  static async timeSeries(days: number = 30, options?: AnalyticsFetchOptions): Promise<TimeseriesPoint[]> {
    const result = await apiRequest<{ success: boolean; series: TimeseriesPoint[] }>(
      'GET',
      withFresh(`/api/analytics/timeseries?days=${days}`, options),
      undefined,
      'Unable to load the activity timeline.',
    );
    return result.series ?? [];
  }

  static async funnel(days: number = 30, options?: AnalyticsFetchOptions): Promise<FunnelResult> {
    const result = await apiRequest<{ success: boolean; stages: FunnelStage[]; conversion: FunnelConversion }>(
      'GET',
      withFresh(`/api/analytics/funnel?days=${days}`, options),
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

  static async rankings(days: number = 30, options?: AnalyticsFetchOptions): Promise<Rankings> {
    const result = await apiRequest<{ success: boolean; campaigns: RankedCampaign[]; rewards: RankedReward[] }>(
      'GET',
      withFresh(`/api/analytics/rankings?days=${days}`, options),
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
