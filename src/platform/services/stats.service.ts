import { apiRequest, buildQuery } from '@/platform/lib/http';

export interface PlatformFeatures {
  whatsappEnabled: boolean;
  emailEnabled: boolean;
  wheelDesignEnabled: boolean;
}

export interface RevenueOverview {
  collectedAllTimeCents: number;
  collectedThisMonthCents: number;
  collectedLastMonthCents: number;
  growthPercent: number;
  monthlyRecurringCents: number;
  pipelineCents: number;
  currency: string;
}

export interface PlatformOverview {
  overview: {
    revenue: RevenueOverview;
    accounts: {
      totalUsers: number;
      activeUsers: number;
      suspendedUsers: number;
      newUsers30d: number;
      totalBusinesses: number;
    };
    activity: { totalCampaigns: number; totalCustomers: number; participations: number };
    subscriptions: { active: number; topPlans: Array<{ name: string; slug: string; subs: number }> };
  };
}

export interface RevenuePoint {
  month: string;
  collectedCents: number;
  approvals: number;
}

export interface PlanStat {
  id: string;
  name: string;
  slug: string;
  priceCents: number;
  interval: string;
  activeSubscriptions: number;
  collectedCents: number;
  approvals: number;
}

export interface GrowthSeries {
  days: number;
  series: {
    signups: Array<{ day: string; total: number }>;
    businesses: Array<{ day: string; total: number }>;
    campaigns: Array<{ day: string; total: number }>;
  };
}

export interface UsersStats {
  totals: {
    totalUsers: number;
    activeUsers: number;
    suspendedUsers: number;
    newUsers7d: number;
    newUsers30d: number;
    totalBusinesses: number;
    tenantsWithMembers: number;
  };
  planDistribution: Array<{ name: string; slug: string; activeSubscriptions: number }>;
  recentUsers: Array<{ id: string; email: string; firstName: string; lastName: string; status: string; createdAt: string }>;
  topBusinesses: Array<{ id: string; name: string; slug: string; campaigns: number; customers: number; participations: number }>;
}

export interface ActivityStats {
  days: number;
  totals: {
    participations: number;
    rewardsClaimed: number;
    couponsIssued: number;
    couponsRedeemed: number;
    customers: number;
    redemptionRate: number;
  };
  series: {
    participations: Array<{ day: string; total: number }>;
    rewardsClaimed: Array<{ day: string; total: number }>;
    couponsIssued: Array<{ day: string; total: number }>;
    newCustomers: Array<{ day: string; total: number }>;
  };
}

export interface MarketingStats {
  whatsapp: {
    cloud: {
      campaigns: number;
      recipients: number;
      sent: number;
      failed: number;
      delivered: number;
      read: number;
      deliveryRate: number;
    };
    web: { campaigns: number; recipients: number; sent: number; failed: number; failureRate: number };
    totalSent: number;
  };
  email: {
    campaigns: number;
    recipients: number;
    sent: number;
    failed: number;
    sentLast30Days: number;
    campaignsLast30Days: number;
    failureRate: number;
    suppressed: number;
  };
}

export class StatsService {
  static async overview(): Promise<PlatformOverview> {
    return apiRequest<PlatformOverview>('GET', '/api/admin/stats/overview', undefined, 'Unable to load the overview.');
  }

  static async revenue(months = 12): Promise<{ months: number; series: RevenuePoint[]; currency: string }> {
    return apiRequest('GET', `/api/admin/stats/revenue${buildQuery({ months })}`, undefined, 'Unable to load revenue.');
  }

  static async plans(): Promise<{ currency: string; plans: PlanStat[] }> {
    return apiRequest('GET', '/api/admin/stats/plans', undefined, 'Unable to load plans.');
  }

  static async growth(days = 90): Promise<GrowthSeries> {
    return apiRequest('GET', `/api/admin/stats/growth${buildQuery({ days })}`, undefined, 'Unable to load growth.');
  }

  static async users(limit = 10): Promise<UsersStats> {
    return apiRequest('GET', `/api/admin/stats/users${buildQuery({ limit })}`, undefined, 'Unable to load user stats.');
  }

  static async activity(days = 90): Promise<ActivityStats> {
    return apiRequest('GET', `/api/admin/stats/activity${buildQuery({ days })}`, undefined, 'Unable to load activity.');
  }

  static async marketing(): Promise<MarketingStats> {
    return apiRequest('GET', '/api/admin/stats/marketing', undefined, 'Unable to load marketing stats.');
  }

  static async platformFeatures(): Promise<{ features: PlatformFeatures }> {
    return apiRequest('GET', '/api/admin/platform-features', undefined, 'Unable to load platform switches.');
  }

  static async setPlatformFeatures(features: Partial<PlatformFeatures>): Promise<{ features: PlatformFeatures }> {
    return apiRequest('POST', '/api/admin/platform-features', features, 'Unable to update platform switches.');
  }
}

/** TND amounts are stored in cents; the catalog displays whole dinars. */
export function formatTND(cents: number): string {
  const value = cents / 100;
  return value.toLocaleString('en-TN', { maximumFractionDigits: 0 });
}

export function formatTNDCompact(cents: number): string {
  const value = cents / 100;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M DT`;
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k DT`;
  return `${value.toLocaleString('en-TN', { maximumFractionDigits: 0 })} DT`;
}
