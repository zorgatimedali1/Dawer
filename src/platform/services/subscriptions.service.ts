import { apiRequest, buildQuery } from '@/platform/lib/http';

export type SubscriptionRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface SubscriptionRequest {
  id: string;
  status: SubscriptionRequestStatus;
  durationDays: number | null;
  rejectReason: string | null;
  requestedAt: string;
  resolvedAt: string | null;
  userId: string;
  businessId: string;
  email: string;
  businessName: string | null;
  plan: { name: string; slug: string };
  priceCents: number;
  interval: string;
}

export interface PlatformPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** Mirrors the server presets, including the three-year Business and Enterprise terms. */
export const APPROVE_DURATION_DAYS = [30, 90, 180, 365, 1095] as const;
export type ApproveDurationDays = (typeof APPROVE_DURATION_DAYS)[number];

export const DURATION_LABELS: Record<ApproveDurationDays, string> = {
  30: '1 mois',
  90: '3 mois',
  180: '6 mois',
  365: '12 mois',
  1095: '3 ans',
};

export class SubscriptionsService {
  static async listRequests(params: {
    search?: string | undefined;
    status?: SubscriptionRequestStatus | undefined;
    page?: number | undefined;
    limit?: number | undefined;
  } = {}): Promise<{ requests: SubscriptionRequest[]; pagination: PlatformPagination }> {
    const result = await apiRequest<{ success: boolean; requests?: SubscriptionRequest[]; pagination: PlatformPagination }>(
      'GET',
      `/api/admin/subscriptions${buildQuery(params as Record<string, string | number | undefined>)}`,
      undefined,
      'Unable to load subscription requests.',
    );

    return { requests: result.requests ?? [], pagination: result.pagination };
  }

  static async approve(requestId: string, durationDays: ApproveDurationDays): Promise<{ currentPeriodEnd: string }> {
    return apiRequest<{ success: boolean; currentPeriodEnd: string }>(
      'POST',
      `/api/admin/subscriptions/requests/${encodeURIComponent(requestId)}/approve`,
      { durationDays },
      'Unable to activate the subscription.',
    );
  }

  static async reject(requestId: string, reason: string): Promise<{ success: boolean }> {
    return apiRequest<{ success: boolean }>(
      'POST',
      `/api/admin/subscriptions/requests/${encodeURIComponent(requestId)}/reject`,
      { reason },
      'Unable to reject the request.',
    );
  }
}
