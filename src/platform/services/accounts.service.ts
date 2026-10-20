import { apiRequest, buildQuery } from '@/platform/lib/http';
import type { WheelTheme } from '@/lib/wheel-theme';

export type AccountStatus = 'ACTIVE' | 'SUSPENDED';

export interface PlatformAccount {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  status: AccountStatus;
  createdAt: string;
  lastSeenAt: string | null;
  businessCount: number;
  sessionCount: number;
}

export interface PlatformPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PlatformAccountList {
  accounts: PlatformAccount[];
  pagination: PlatformPagination;
}

export interface PlatformBusiness {
  id: string;
  name: string;
  slug: string;
  role: string;
  playPolicy: AccountPlayPolicy;
  whatsappEnabled: boolean;
  emailEnabled: boolean;
  planSlug: string;
  createdAt: string;
}

export interface PlatformSession {
  id: string;
  createdAt: string;
  expiresAt: string;
}

export interface PlatformIdentity {
  provider: string;
  providerAccountId: string;
  email: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

export interface PlatformAuditEntry {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: string | null;
  createdAt: string;
}

export type AccountPlayPolicy = { mode: 'off' } | { mode: 'once' } | { mode: 'windowed'; perDay: number; cooldownMinutes: number };

export interface PlatformAccountDetail {
  account: PlatformAccount;
  playPolicy: AccountPlayPolicy;
  featureAccess: { whatsappEnabled: boolean; emailEnabled: boolean; wheelDesignEnabled: boolean; rewardsEnabled: boolean };
  /** Merchant-authored wheel theme (first non-null across the account). */
  wheelTheme: WheelTheme | null;
  /** Operator-authored override; when set it wins over `wheelTheme`. */
  wheelThemeOverride: WheelTheme | null;
  planSlug: string;
  /** False when the plan carries no wheel-design flag: default design only. */
  designAllowed: boolean;
  businesses: PlatformBusiness[];
  sessions: PlatformSession[];
  identities: PlatformIdentity[];
  auditTrail: PlatformAuditEntry[];
}

export class AccountsService {
  static async listAccounts(params: {
    search?: string | undefined;
    status?: AccountStatus | undefined;
    page?: number | undefined;
    limit?: number | undefined;
  } = {}): Promise<PlatformAccountList> {
    const result = await apiRequest<PlatformAccountList & { success: boolean }>(
      'GET',
      `/api/admin/accounts${buildQuery(params as Record<string, string | number | undefined>)}`,
      undefined,
      'Unable to load accounts.',
    );

    return { accounts: result.accounts ?? [], pagination: result.pagination };
  }

  static async getAccount(accountId: string): Promise<PlatformAccountDetail> {
    return apiRequest<PlatformAccountDetail & { success: boolean }>(
      'GET',
      `/api/admin/accounts/${encodeURIComponent(accountId)}`,
      undefined,
      'Unable to load the account.',
    );
  }

  static async suspend(accountId: string, reason: string): Promise<{ revokedSessions: number }> {
    return apiRequest<{ success: boolean; revokedSessions: number }>(
      'POST',
      `/api/admin/accounts/${encodeURIComponent(accountId)}/suspend`,
      { reason },
      'Unable to suspend the account.',
    );
  }

  static async activate(accountId: string): Promise<{ success: boolean }> {
    return apiRequest<{ success: boolean }>(
      'POST',
      `/api/admin/accounts/${encodeURIComponent(accountId)}/activate`,
      {},
      'Unable to activate the account.',
    );
  }

  static async revokeSessions(accountId: string): Promise<{ revokedSessions: number }> {
    return apiRequest<{ success: boolean; revokedSessions: number }>(
      'POST',
      `/api/admin/accounts/${encodeURIComponent(accountId)}/revoke-sessions`,
      {},
      'Unable to revoke sessions.',
    );
  }

  static async setPlayPolicy(accountId: string, playPolicy: AccountPlayPolicy): Promise<{ playPolicy: AccountPlayPolicy }> {
    const body =
      playPolicy.mode === 'windowed'
        ? { mode: playPolicy.mode, perDay: playPolicy.perDay, cooldownMinutes: playPolicy.cooldownMinutes }
        : { mode: playPolicy.mode, perDay: 1, cooldownMinutes: 0 };

    return apiRequest<{ success: boolean; playPolicy: AccountPlayPolicy }>(
      'POST',
      `/api/admin/accounts/${encodeURIComponent(accountId)}/play-policy`,
      body,
      'Unable to update the play policy.',
    );
  }

  /** Turns WhatsApp / email marketing, wheel design and rewards on or off for every business of the account. */
  static async setFeatureAccess(
    accountId: string,
    features: { whatsappEnabled?: boolean; emailEnabled?: boolean; wheelDesignEnabled?: boolean; rewardsEnabled?: boolean },
  ): Promise<{
    featureAccess: {
      whatsappEnabled?: boolean;
      emailEnabled?: boolean;
      wheelDesignEnabled?: boolean;
      rewardsEnabled?: boolean;
    };
    updatedBusinesses: number;
  }> {
    return apiRequest(
      'POST',
      `/api/admin/accounts/${encodeURIComponent(accountId)}/features`,
      features,
      'Unable to update feature access.',
    );
  }

  /** Pins an operator-authored wheel design over the merchant's own theme. */
  static async setWheelTheme(accountId: string, theme: WheelTheme): Promise<{ wheelThemeOverride: WheelTheme | null }> {
    return apiRequest(
      'POST',
      `/api/admin/accounts/${encodeURIComponent(accountId)}/wheel-theme`,
      { theme },
      'Unable to apply the wheel design.',
    );
  }

  /** Hands wheel-design control back to the merchant's own theme. */
  static async clearWheelTheme(accountId: string): Promise<{ wheelThemeOverride: WheelTheme | null }> {
    return apiRequest(
      'POST',
      `/api/admin/accounts/${encodeURIComponent(accountId)}/wheel-theme`,
      { clear: true },
      'Unable to clear the wheel design.',
    );
  }

  static async remove(accountId: string, reason: string): Promise<{ email: string }> {
    return apiRequest<{ success: boolean; email: string }>(
      'DELETE',
      `/api/admin/accounts/${encodeURIComponent(accountId)}`,
      { reason },
      'Unable to delete the account.',
    );
  }
}
