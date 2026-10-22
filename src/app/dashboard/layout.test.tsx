import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardLayout from '@/app/dashboard/layout';
import { AppProvider } from '@/contexts/app-context';
import { goToPublicDemo } from '@/lib/public-demo';

vi.mock('@/lib/public-demo', () => ({ goToPublicDemo: vi.fn() }));

const AUTH_KEY = 'campaign-engage-auth';

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function billingPayload(access: Record<string, unknown>) {
  return {
    success: true,
    plans: [],
    subscription: null,
    pendingRequest: null,
    usage: { campaigns: 0, customers: 0 },
    access,
  };
}

function renderDashboard(path: string) {
  window.localStorage.setItem(
    AUTH_KEY,
    JSON.stringify({ token: 'cf_abc.def', user: { id: 'u1', email: 'ada@example.test', firstName: 'Ada', role: 'merchant' } }),
  );

  return render(
    <AppProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/dashboard" element={<DashboardLayout />}>
            <Route path="overview" element={<div>overview page</div>} />
            <Route path="analytics" element={<div>analytics page</div>} />
            <Route path="email" element={<div>email page</div>} />
            <Route path="rewards" element={<div>rewards page</div>} />
            <Route path="billing" element={<div>billing page</div>} />
            <Route path="demo" element={<div>demo page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AppProvider>,
  );
}

describe('dashboard plan access gate', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
    vi.mocked(goToPublicDemo).mockClear();
  });

  it('sends first-time trial users to the Demo page instead of Billing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(billingPayload({
      state: 'trial',
      canManage: false,
      startsAt: '2026-10-02T00:00:00.000Z',
      endsAt: '2026-10-09T00:00:00.000Z',
      plan: {
        id: 'plan_starter', name: 'Starter', slug: 'starter', priceCents: 14900, interval: '3_months',
        features: { limits: { campaigns: -1, customers: 100 }, features: ['Accès complet à la roue'] },
      },
    }))));

    renderDashboard('/dashboard/overview');

    expect(await screen.findByText('demo page')).toBeInTheDocument();
    expect(screen.queryByText('overview page')).toBeNull();
    // The read-only sidebar offers both the demo and Billing.
    expect(screen.getByRole('link', { name: 'Démonstration' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Facturation' })).toBeInTheDocument();
  });

  it('sends expired subscriptions to Billing to renew', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(billingPayload({
      state: 'expired',
      canManage: false,
      startsAt: '2026-07-01T00:00:00.000Z',
      endsAt: '2026-10-01T00:00:00.000Z',
      plan: {
        id: 'plan_starter', name: 'Starter', slug: 'starter', priceCents: 14900, interval: '3_months',
        features: { limits: { campaigns: -1, customers: 100 }, features: ['Accès complet à la roue'] },
      },
    }))));

    renderDashboard('/dashboard/overview');

    expect(await screen.findByText('billing page')).toBeInTheDocument();
    expect(screen.queryByText('demo page')).toBeNull();
  });

  it('does not let an ended trial stay on the Demo page, sends it to Billing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(billingPayload({
      state: 'trial_expired',
      canManage: false,
      startsAt: '2026-09-02T00:00:00.000Z',
      endsAt: '2026-09-09T00:00:00.000Z',
      plan: {
        id: 'plan_starter', name: 'Starter', slug: 'starter', priceCents: 14900, interval: '3_months',
        features: { limits: { campaigns: -1, customers: 100 }, features: ['Accès complet à la roue'] },
      },
    }))));

    renderDashboard('/dashboard/demo');

    expect(await screen.findByText('billing page')).toBeInTheDocument();
    expect(screen.queryByText('demo page')).toBeNull();
  });

  it('allows a paid Pro customer to enter Overview and see Analytics navigation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(billingPayload({
      state: 'active',
      canManage: true,
      startsAt: '2026-10-01T00:00:00.000Z',
      endsAt: '2027-10-01T00:00:00.000Z',
      plan: {
        id: 'plan_growth', name: 'Pro', slug: 'growth', priceCents: 34900, interval: 'year',
        features: { limits: { campaigns: -1, customers: 1000 }, features: ['Vue d’ensemble et analytics de base'] },
      },
    }))));

    renderDashboard('/dashboard/overview');

    expect(await screen.findByText('overview page')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Analytique' })).toBeInTheDocument();
  });

  const paidAccess = {
    state: 'active',
    canManage: true,
    startsAt: '2026-10-01T00:00:00.000Z',
    endsAt: '2027-10-01T00:00:00.000Z',
    plan: {
      id: 'plan_growth', name: 'Pro', slug: 'growth', priceCents: 34900, interval: 'year',
      features: { limits: { campaigns: -1, customers: 1000 }, features: ['Vue d’ensemble et analytics de base', 'Gestion des récompenses'] },
    },
  };

  it('hides the marketing menu entries while the operator switches are off', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      ...billingPayload(paidAccess),
      features: { emailEnabled: false, whatsappEnabled: false },
    })));

    renderDashboard('/dashboard/overview');

    expect(await screen.findByText('overview page')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Marketing e-mail' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Diffusion WhatsApp' })).not.toBeInTheDocument();
    // SMS has no operator switch of its own, so the group keeps its header.
    expect(screen.getByRole('link', { name: 'SMS' })).toBeInTheDocument();
  });

  it('brings the marketing menu entries back when the switches are on', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      ...billingPayload(paidAccess),
      features: { emailEnabled: true, whatsappEnabled: true },
    })));

    renderDashboard('/dashboard/overview');

    expect(await screen.findByText('overview page')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Marketing e-mail' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Diffusion WhatsApp' })).toBeInTheDocument();
  });

  it('redirects away from a marketing page whose switch is off', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      ...billingPayload(paidAccess),
      features: { emailEnabled: false, whatsappEnabled: true },
    })));

    renderDashboard('/dashboard/email');

    expect(await screen.findByText('overview page')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Diffusion WhatsApp' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Marketing e-mail' })).not.toBeInTheDocument();
  });

  it('sends paid Starter users to Billing instead of an unentitled Analytics page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(billingPayload({
      state: 'active',
      canManage: true,
      startsAt: '2026-10-01T00:00:00.000Z',
      endsAt: '2027-01-01T00:00:00.000Z',
      plan: {
        id: 'plan_starter', name: 'Starter', slug: 'starter', priceCents: 14900, interval: '3_months',
        features: { limits: { campaigns: -1, customers: 100 }, features: ['Accès complet à la roue'] },
      },
    }))));

    renderDashboard('/dashboard/analytics');

    expect(await screen.findByText('billing page')).toBeInTheDocument();
    expect(screen.queryByText('analytics page')).toBeNull();
  });

  it('hides the Rewards nav and redirects the route for paid Starter users', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(billingPayload({
      state: 'active',
      canManage: true,
      startsAt: '2026-10-01T00:00:00.000Z',
      endsAt: '2027-01-01T00:00:00.000Z',
      plan: {
        id: 'plan_starter', name: 'Starter', slug: 'starter', priceCents: 14900, interval: '3_months',
        features: { limits: { campaigns: -1, customers: 100 }, features: ['Accès complet à la roue'] },
      },
    }))));

    renderDashboard('/dashboard/rewards');

    expect(await screen.findByText('billing page')).toBeInTheDocument();
    expect(screen.queryByText('rewards page')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Récompenses' })).not.toBeInTheDocument();
  });

  it('shows the Rewards nav link for a paid Pro customer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(billingPayload(paidAccess))));

    renderDashboard('/dashboard/overview');

    expect(await screen.findByText('overview page')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Récompenses' })).toBeInTheDocument();
  });

  it('hides the Rewards nav and redirects the route while the operator rewards switch is off', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      ...billingPayload(paidAccess),
      features: { emailEnabled: true, whatsappEnabled: true, rewardsEnabled: false },
    })));

    renderDashboard('/dashboard/rewards');

    expect(await screen.findByText('overview page')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Récompenses' })).not.toBeInTheDocument();
  });

  it('keeps the Rewards nav link visible when the operator rewards switch is on', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      ...billingPayload(paidAccess),
      features: { emailEnabled: true, whatsappEnabled: true, rewardsEnabled: true },
    })));

    renderDashboard('/dashboard/overview');

    expect(await screen.findByText('overview page')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Récompenses' })).toBeInTheDocument();
  });

  it('redirects to the public demo video section after sign-out', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(billingPayload({
      state: 'active',
      canManage: true,
      startsAt: '2026-10-01T00:00:00.000Z',
      endsAt: '2027-10-01T00:00:00.000Z',
      plan: {
        id: 'plan_growth', name: 'Pro', slug: 'growth', priceCents: 34900, interval: 'year',
        features: { limits: { campaigns: -1, customers: 1000 }, features: ['Vue d’ensemble et analytics de base'] },
      },
    }))));

    renderDashboard('/dashboard/overview');
    await screen.findByText('overview page');

    const logoutButtons = screen.getAllByRole('button', { name: 'Se déconnecter' });
    await userEvent.click(logoutButtons[0]!);

    await waitFor(() => expect(goToPublicDemo).toHaveBeenCalledTimes(1));
  });
});