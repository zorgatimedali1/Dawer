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
