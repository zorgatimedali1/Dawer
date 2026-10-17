import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OverviewPage from '@/app/dashboard/overview/page';
import { DashboardBillingProvider } from '@/contexts/billing-context';

const AUTH_KEY = 'campaign-engage-auth';

describe('overview plan features', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(AUTH_KEY, JSON.stringify({ token: 'cf_abc.def' }));
  });

  it('shows the active Starter plan without analytics-only widgets or requests', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/business/campaigns')) {
        return new Response(JSON.stringify({ success: true, campaigns: [] }), { status: 200 });
      }
      if (url.startsWith('/api/business/rewards')) {
        return new Response(JSON.stringify({ success: true, rewards: [] }), { status: 200 });
      }
      if (url === '/api/billing') {
        return new Response(JSON.stringify({
          success: true,
          plans: [],
          subscription: null,
          pendingRequest: null,
          usage: { campaigns: 0, customers: 0 },
          access: {
            state: 'active',
            canManage: true,
            startsAt: '2026-10-01T00:00:00.000Z',
            endsAt: '2027-01-01T00:00:00.000Z',
            plan: {
              id: 'plan_starter',
              name: 'Starter',
              slug: 'starter',
              priceCents: 14900,
              interval: '3_months',
              features: { limits: { campaigns: -1, customers: 200 }, features: ['Accès complet à la roue'] },
            },
          },
        }), { status: 200 });
      }
      throw new Error(`Unexpected analytics request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter>
        <DashboardBillingProvider>
          <OverviewPage />
        </DashboardBillingProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Starter · Actif' })).toBeInTheDocument();
    expect(screen.getByText('• Accès complet à la roue')).toBeInTheDocument();
    expect(screen.getByText('• 200 clients')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: "Ouvrir l'analytique" })).toBeNull();
    expect(screen.queryByText('Total customers')).toBeNull();
    expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith('/api/analytics'))).toBe(false);
    // The shell owns the single /api/billing read; the page must not repeat it.
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === '/api/billing')).toHaveLength(1);
  });
});