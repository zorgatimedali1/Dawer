import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardBillingProvider, useDashboardBilling } from '@/contexts/billing-context';
import type { BillingAccess, MarketingFeatures } from '@/services/billing.service';

const access: BillingAccess = {
  state: 'active',
  canManage: true,
  startsAt: '2026-10-01T00:00:00.000Z',
  endsAt: '2027-01-01T00:00:00.000Z',
  plan: {
    id: 'plan_pro',
    name: 'Pro',
    slug: 'growth',
    priceCents: 4900,
    interval: 'month',
    features: { limits: { campaigns: 5, customers: 5000 }, features: ['analytics'] },
  },
};

const updatedAccess: BillingAccess = {
  ...access,
  plan: { ...access.plan, id: 'plan_scale', name: 'Scale', slug: 'scale' },
};

const features: MarketingFeatures = { whatsappEnabled: true, emailEnabled: true, rewardsEnabled: true, smsEnabled: true };

function Probe() {
  const { access: current, features: currentFeatures, loading } = useDashboardBilling();
  return (
    <p>
      {loading ? 'checking' : 'ready'}|{current === null ? 'no-access' : current.plan.name}|
      {currentFeatures === null ? 'no-features' : `wa:${currentFeatures.whatsappEnabled ? 1 : 0}`}
    </p>
  );
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function billingResponse() {
  return {
    success: true,
    plans: [access.plan],
    subscription: null,
    access,
    pendingRequest: null,
    usage: { campaigns: 0, customers: 0 },
    features,
  };
}

function writeCache(userId: string, payload: unknown) {
  window.localStorage.setItem(
    `campaign-engage-billing-${userId}`,
    typeof payload === 'string' ? payload : JSON.stringify(payload),
  );
}

function renderWithBilling(handler: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(handler));
  return render(
    <DashboardBillingProvider>
      <Probe />
    </DashboardBillingProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('billing cache hydration', () => {
  it('hydrates from a fresh cache and paints instantly with no checking phase', () => {
    window.localStorage.setItem('campaign-engage-auth', JSON.stringify({ user: { id: 'user-1' } }));
    writeCache('user-1', { access, features, cachedAt: Date.now() });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json(billingResponse()))));

    // Synchronous first render: no spinner, cached plan.
    const { container } = render(
      <DashboardBillingProvider>
        <Probe />
      </DashboardBillingProvider>,
    );
    expect(container.textContent).toBe('ready|Pro|wa:1');
  });

  it('revalidates in the background and repaints with the server plan + rewrites the cache', async () => {
    window.localStorage.setItem('campaign-engage-auth', JSON.stringify({ user: { id: 'user-1' } }));
    writeCache('user-1', { access, features, cachedAt: Date.now() });
    renderWithBilling(async () => json({ ...billingResponse(), access: updatedAccess }));

    expect(screen.getByText('ready|Pro|wa:1')).toBeInTheDocument();

    expect(await screen.findByText('ready|Scale|wa:1')).toBeInTheDocument();
    const raw = window.localStorage.getItem('campaign-engage-billing-user-1');
    expect(JSON.parse(raw!).access.plan.name).toBe('Scale');
  });

  it('ignores a cache older than 24 hours and shows the checking phase', () => {
    window.localStorage.setItem('campaign-engage-auth', JSON.stringify({ user: { id: 'user-1' } }));
    writeCache('user-1', { access, features, cachedAt: Date.now() - 25 * 60 * 60 * 1000 });
    renderWithBilling(() => new Promise<Response>(() => {}));

    expect(screen.getByText('checking|no-access|no-features')).toBeInTheDocument();
  });

  it('ignores a corrupt cache payload', () => {
    window.localStorage.setItem('campaign-engage-auth', JSON.stringify({ user: { id: 'user-1' } }));
    writeCache('user-1', '{not json');
    renderWithBilling(() => new Promise<Response>(() => {}));

    expect(screen.getByText('checking|no-access|no-features')).toBeInTheDocument();
  });

  it('ignores another account cache (per-user keying)', () => {
    window.localStorage.setItem('campaign-engage-auth', JSON.stringify({ user: { id: 'user-2' } }));
    writeCache('user-1', { access, features, cachedAt: Date.now() });
    renderWithBilling(() => new Promise<Response>(() => {}));

    expect(screen.getByText('checking|no-access|no-features')).toBeInTheDocument();
  });

  it('ignores a cache without a signed-in user id', () => {
    window.localStorage.setItem('campaign-engage-auth', JSON.stringify({ token: 'legacy' }));
    writeCache('user-1', { access, features, cachedAt: Date.now() });
    renderWithBilling(() => new Promise<Response>(() => {}));

    expect(screen.getByText('checking|no-access|no-features')).toBeInTheDocument();
  });
});

describe('revalidation failure', () => {
  it('keeps a fresh cache on screen when /api/billing fails offline', async () => {
    window.localStorage.setItem('campaign-engage-auth', JSON.stringify({ user: { id: 'user-1' } }));
    writeCache('user-1', { access, features, cachedAt: Date.now() });
    renderWithBilling(async () => {
      throw new TypeError('Failed to fetch.');
    });

    expect(screen.getByText('ready|Pro|wa:1')).toBeInTheDocument();
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });
    expect(screen.getByText('ready|Pro|wa:1')).toBeInTheDocument();
  });

  it('settles to the read-only fallback (null access) without a cache', async () => {
    renderWithBilling(async () => json({ success: false, error: 'Offline.' }, 500));

    expect(await screen.findByText('ready|no-access|no-features')).toBeInTheDocument();
  });
});

describe('mid-session 401 (session-expired event)', () => {
  it('drops the cached plan and removes the cache entry', async () => {
    window.localStorage.setItem('campaign-engage-auth', JSON.stringify({ user: { id: 'user-1' } }));
    writeCache('user-1', { access, features, cachedAt: Date.now() });
    renderWithBilling(async () => json(billingResponse()));
    expect(await screen.findByText('ready|Pro|wa:1')).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event('session-expired'));
    });

    expect(screen.getByText('checking|no-access|no-features')).toBeInTheDocument();
    expect(window.localStorage.getItem('campaign-engage-billing-user-1')).toBeNull();
  });
});
