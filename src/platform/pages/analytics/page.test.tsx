import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AnalyticsPage from '@/platform/pages/analytics/page';

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const users = {
  totals: {
    totalUsers: 42,
    activeUsers: 40,
    suspendedUsers: 2,
    newUsers7d: 3,
    newUsers30d: 7,
    totalBusinesses: 55,
    tenantsWithMembers: 50,
  },
  planDistribution: [{ name: 'Starter', slug: 'starter', activeSubscriptions: 20 }],
  recentUsers: [
    {
      id: 'u1',
      email: 'ada@example.test',
      firstName: 'Ada',
      lastName: 'Lovelace',
      status: 'ACTIVE',
      createdAt: '2026-10-01T00:00:00.000Z',
    },
  ],
  topBusinesses: [
    { id: 'b1', name: 'Merchant Shop', slug: 'merchant-shop', campaigns: 4, customers: 120, participations: 890 },
  ],
};

function activityPayload(days: number) {
  const series = Array.from({ length: days }, (_, index) => ({
    day: `2026-09-${String((index % 28) + 1).padStart(2, '0')}`,
    total: index === days - 1 ? 6 : 2,
  }));
  return {
    days,
    totals: {
      participations: 420,
      rewardsClaimed: 80,
      couponsIssued: 300,
      couponsRedeemed: 210,
      customers: 900,
      redemptionRate: 70,
    },
    series: {
      participations: series,
      rewardsClaimed: series,
      couponsIssued: series,
      newCustomers: series,
    },
  };
}

const marketing = {
  whatsapp: {
    cloud: { campaigns: 5, recipients: 1000, sent: 980, failed: 20, delivered: 900, read: 500, deliveryRate: 92 },
    web: { campaigns: 3, recipients: 200, sent: 190, failed: 10, failureRate: 5 },
    totalSent: 1170,
  },
  email: {
    campaigns: 4,
    recipients: 600,
    sent: 580,
    failed: 30,
    sentLast30Days: 400,
    campaignsLast30Days: 2,
    failureRate: 5,
    suppressed: 12,
  },
};

function growthPayload(days: number) {
  const series = Array.from({ length: days }, (_, index) => ({
    day: `2026-09-${String((index % 28) + 1).padStart(2, '0')}`,
    total: index,
  }));
  return {
    days,
    series: { signups: series, businesses: series, campaigns: series },
  };
}

function daysParam(url: string): number {
  const match = /[?&]days=(\d+)/.exec(url);
  return match ? Number(match[1]) : 30;
}

function createFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.includes('/api/admin/stats/users')) return jsonResponse(users);
    if (url.includes('/api/admin/stats/activity')) {
      return jsonResponse(activityPayload(daysParam(url)));
    }
    if (url.includes('/api/admin/stats/marketing')) return jsonResponse(marketing);
    if (url.includes('/api/admin/stats/growth')) {
      return jsonResponse(growthPayload(daysParam(url)));
    }

    return jsonResponse({ success: false, message: 'Route not found.' }, 404);
  });
}

describe('platform analytics page', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders the account, engagement and marketing stats', async () => {
    vi.stubGlobal('fetch', createFetch());
    render(<AnalyticsPage />);

    expect(await screen.findByText('Recent signups')).toBeInTheDocument();

    expect(screen.getByText('Top businesses')).toBeInTheDocument();
    expect(screen.getByText('Merchant Shop')).toBeInTheDocument();
    expect(screen.getByText('/merchant-shop')).toBeInTheDocument();

    expect(screen.getByText('Marketing volume')).toBeInTheDocument();
    expect(screen.getByText('WhatsApp (Cloud API)')).toBeInTheDocument();
    expect(screen.getByLabelText('Platform growth over time')).toBeInTheDocument();
    expect(screen.getByLabelText('Daily participations')).toBeInTheDocument();

    // Account health: 40 active out of 42.
    expect(screen.getByText('Active accounts')).toBeInTheDocument();
    expect(screen.getByText('Starter')).toBeInTheDocument();
    expect(screen.getByText('ada@example.test')).toBeInTheDocument();
  });

  it('reloads the windowed stats when the range changes', async () => {
    const fetchMock = createFetch();
    vi.stubGlobal('fetch', fetchMock);
    render(<AnalyticsPage />);

    await screen.findByText('Recent signups');
    const initialCalls = fetchMock.mock.calls.length;

    await userEvent.selectOptions(screen.getByLabelText('Date range'), '7');

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(initialCalls));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((call) => String(call[0]).includes('/activity?days=7')),
      ).toBe(true),
    );
    expect(
      fetchMock.mock.calls.some((call) => String(call[0]).includes('/growth?days=7')),
    ).toBe(true);
  });

  it('surfaces an error banner when a stats call fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/admin/stats/users')) {
          return jsonResponse({ success: false, message: 'Stats are unavailable.' }, 500);
        }
        if (url.includes('/api/admin/stats/activity')) return jsonResponse(activityPayload(30));
        if (url.includes('/api/admin/stats/marketing')) return jsonResponse(marketing);
        if (url.includes('/api/admin/stats/growth')) return jsonResponse(growthPayload(30));
        return jsonResponse({ success: false, message: 'Route not found.' }, 404);
      }),
    );

    render(<AnalyticsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Stats are unavailable.');
  });
});
