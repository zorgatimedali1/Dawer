import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CouponsPage from '@/app/dashboard/coupons/page';
import { invalidateCachedResource } from '@/hooks/useCachedResource';
import { DashboardBillingProvider } from '@/contexts/billing-context';

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const couponRow = {
  id: 'coupon-1',
  code: 'CAFÉ-1234',
  status: 'ISSUED',
  issued_at: '2026-10-01T10:00:00.000Z',
  expires_at: null,
  redeemed_at: null,
  campaign_id: 'campaign-1',
  campaign_name: 'Coffee Spin',
  reward_name: 'Café offert',
  first_name: 'Ada',
  last_name: 'Lovelace',
  email: 'ada@example.com',
};

function stubFetch({ planSlug = 'starter' }: { planSlug?: string } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url === '/api/billing') {
      return jsonResponse({
        success: true,
        plans: [],
        subscription: null,
        pendingRequest: null,
        usage: { campaigns: 1, customers: 0 },
        access: {
          state: 'active',
          canManage: true,
          startsAt: '2026-10-01T00:00:00.000Z',
          endsAt: '2027-01-01T00:00:00.000Z',
          plan: {
            id: `plan_${planSlug}`,
            name: 'Plan',
            slug: planSlug,
            priceCents: 14900,
            interval: '3_months',
            features: {
              limits: { campaigns: 4, customers: 200 },
              features: planSlug === 'starter'
                ? ['Accès complet à la roue']
                : ['Accès complet à la roue', 'Statistiques & analytics'],
            },
          },
        },
      });
    }

    if (url.startsWith('/api/business/coupons')) {
      return jsonResponse({
        success: true,
        coupons: [couponRow],
        total: 3,
        page: 1,
        limit: 50,
      });
    }

    return jsonResponse({ success: true });
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage() {
  return render(
    <DashboardBillingProvider>
      <CouponsPage />
    </DashboardBillingProvider>,
  );
}

describe('Coupons page coupon stats', () => {
  beforeEach(() => {
    invalidateCachedResource();
    window.localStorage.setItem('campaign-engage-auth', JSON.stringify({ token: 'coupons-test-token' }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('hides the stats cards on the Starter plan', async () => {
    stubFetch({ planSlug: 'starter' });
    renderPage();

    await screen.findByText('CAFÉ-1234');
    expect(screen.queryByText('Coupons émis')).toBeNull();
    expect(screen.queryByText('Taux d’encaissement')).toBeNull();
    // Starter merchants only pay for the list request, not the stats calls.
    expect(
      vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith('/api/business/coupons')),
    ).toHaveLength(1);
  });

  it('shows the stats cards from the Pro tier up', async () => {
    stubFetch({ planSlug: 'growth' });
    renderPage();

    await screen.findByText('Coupons émis');
    expect(screen.getByText('Taux d’encaissement')).toBeTruthy();
  });
});
