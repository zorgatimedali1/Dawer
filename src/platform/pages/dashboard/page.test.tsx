import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardPage from '@/platform/pages/dashboard/page';

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const overview = {
  success: true,
  overview: {
    revenue: {
      collectedAllTimeCents: 1_245_000,
      collectedThisMonthCents: 149_000,
      collectedLastMonthCents: 100_000,
      growthPercent: 49,
      monthlyRecurringCents: 92_000,
      pipelineCents: 34_900,
      currency: 'TND',
    },
    accounts: { totalUsers: 42, activeUsers: 40, suspendedUsers: 2, newUsers30d: 7, totalBusinesses: 55 },
    activity: { totalCampaigns: 18, totalCustomers: 900, participations: 4200 },
    subscriptions: { active: 31, topPlans: [] },
  },
};

const revenue = {
  months: 3,
  series: [
    { month: '2026-08', collectedCents: 100_000, approvals: 4 },
    { month: '2026-09', collectedCents: 149_000, approvals: 5 },
    { month: '2026-10', collectedCents: 0, approvals: 0 },
  ],
  currency: 'TND',
};

const plans = {
  currency: 'TND',
  plans: [
    {
      id: 'p1',
      name: 'Starter',
      slug: 'starter',
      priceCents: 14_900,
      interval: 'month',
      activeSubscriptions: 20,
      collectedCents: 298_000,
      approvals: 12,
    },
    {
      id: 'p2',
      name: 'Growth',
      slug: 'growth',
      priceCents: 34_900,
      interval: 'month',
      activeSubscriptions: 11,
      collectedCents: 418_800,
      approvals: 9,
    },
  ],
};

const growth = {
  days: 30,
  series: {
    signups: [
      { day: '2026-09-30', total: 2 },
      { day: '2026-10-01', total: 3 },
    ],
    businesses: [
      { day: '2026-09-30', total: 1 },
      { day: '2026-10-01', total: 0 },
    ],
    campaigns: [
      { day: '2026-09-30', total: 4 },
      { day: '2026-10-01', total: 2 },
    ],
  },
};

function createFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url.includes('/api/admin/stats/overview')) return jsonResponse(overview);
    if (url.includes('/api/admin/stats/revenue')) return jsonResponse(revenue);
    if (url.includes('/api/admin/stats/plans')) return jsonResponse(plans);
    if (url.includes('/api/admin/stats/growth')) return jsonResponse(growth);
    if (url.includes('/api/admin/platform-features')) {
      if (init?.method === 'POST') {
        const sent = JSON.parse(String(init.body)) as Record<string, boolean>;
        return jsonResponse({
          features: { whatsappEnabled: true, emailEnabled: true, ...sent },
        });
      }
      return jsonResponse({ features: { whatsappEnabled: true, emailEnabled: true } });
    }

    return jsonResponse({ success: false, message: 'Route not found.' }, 404);
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

describe('platform dashboard page', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders the revenue KPIs and the charts', async () => {
    vi.stubGlobal('fetch', createFetch());
    renderPage();

    expect(await screen.findByText("Chiffre d'affaires")).toBeInTheDocument();

    // Revenue this month: 149000 cents = 1490 DT.
    expect(screen.getByText('1,490 DT')).toBeInTheDocument();
    // Monthly recurring: 92000 cents = 920 DT.
    expect(screen.getByText('920 DT')).toBeInTheDocument();
    // All-time compact: 1_245_000 cents = 12450 DT -> "12k DT".
    expect(screen.getByText('12k DT')).toBeInTheDocument();
    expect(screen.getByText('+49% vs last month')).toBeInTheDocument();

    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByLabelText('Monthly collected revenue')).toBeInTheDocument();
    expect(screen.getByLabelText('Active subscriptions by plan')).toBeInTheDocument();
    expect(screen.getByLabelText('Daily signups and new businesses')).toBeInTheDocument();

    expect(screen.getByText('Revenue by plan')).toBeInTheDocument();
    expect(screen.getAllByText('Starter').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Growth').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('2,980 DT')).toBeInTheDocument();
  });

  it('toggles a platform master switch', async () => {
    const fetchMock = createFetch();
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    const whatsapp = await screen.findByRole('switch', { name: 'WhatsApp marketing' });
    expect(whatsapp).toHaveAttribute('aria-checked', 'true');

    await userEvent.click(whatsapp);

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          (call) =>
            String(call[0]).includes('/api/admin/platform-features') &&
            (call[1] as RequestInit | undefined)?.method === 'POST',
        ),
      ).toBe(true),
    );

    expect(await screen.findByRole('status')).toHaveTextContent(
      'WhatsApp is now disabled platform-wide.',
    );
  });

  it('surfaces an error banner when a stats call fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/admin/stats/overview')) {
          return jsonResponse({ success: false, message: 'Service unavailable.' }, 500);
        }
        if (url.includes('/api/admin/stats/revenue')) return jsonResponse(revenue);
        if (url.includes('/api/admin/stats/plans')) return jsonResponse(plans);
        if (url.includes('/api/admin/stats/growth')) return jsonResponse(growth);
        if (url.includes('/api/admin/platform-features')) {
          return jsonResponse({ features: { whatsappEnabled: true, emailEnabled: true } });
        }
        return jsonResponse({ success: false, message: 'Route not found.' }, 404);
      }),
    );

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Service unavailable.');
  });

  it('links to the full analytics page', async () => {
    vi.stubGlobal('fetch', createFetch());
    renderPage();

    const link = await screen.findByRole('link', { name: 'Full analytics' });
    expect(link).toHaveAttribute('href', '/analytics');
  });
});
