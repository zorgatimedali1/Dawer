import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LandingGate, RedirectIfAuthenticated, RequireAuth } from '@/components/route-guards';
import { AppProvider } from '@/contexts/app-context';

const AUTH_KEY = 'campaign-engage-auth';
const cachedUser = {
  id: 'u1',
  email: 'a@b.co',
  firstName: 'Ada',
  lastName: 'Lovelace',
  role: 'merchant' as const,
};

function seedSession() {
  window.localStorage.setItem(AUTH_KEY, JSON.stringify({ user: cachedUser }));
}

function stubSession(handler: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(handler));
}

const okSession = async () =>
  new Response(JSON.stringify({ success: true, user: cachedUser }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const deadSession = async () =>
  new Response(JSON.stringify({ success: false, error: 'Your session has expired. Sign in again.' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });

function renderAt(path: string) {
  return render(
    <AppProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<div>home page</div>} />
          <Route
            path="/dashboard/*"
            element={
              <RequireAuth>
                <div>secret dashboard</div>
              </RequireAuth>
            }
          />
          <Route path="/dashboard/overview" element={<div>overview page</div>} />
          <Route
            path="/auth/login"
            element={
              <RedirectIfAuthenticated>
                <div>login form</div>
              </RedirectIfAuthenticated>
            }
          />
        </Routes>
      </MemoryRouter>
    </AppProvider>,
  );
}

describe('route guards', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('redirects unauthenticated visitors away from the dashboard', () => {
    renderAt('/dashboard/settings');
    expect(screen.getByText('home page')).toBeInTheDocument();
    expect(screen.queryByText('secret dashboard')).not.toBeInTheDocument();
  });

  it('holds the loader while the bootstrap session check is in flight', () => {
    seedSession();
    stubSession(() => new Promise<Response>(() => undefined));
    renderAt('/dashboard/settings');
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('secret dashboard')).not.toBeInTheDocument();
    expect(screen.queryByText('login form')).not.toBeInTheDocument();
  });

  it('lets authenticated users render the dashboard once the session check passes', async () => {
    seedSession();
    stubSession(okSession);
    renderAt('/dashboard/settings');
    expect(await screen.findByText('secret dashboard')).toBeInTheDocument();
    expect(screen.queryByText('login form')).not.toBeInTheDocument();
  });

  it('bounces to the home page when the cached session has expired', async () => {
    seedSession();
    stubSession(deadSession);
    renderAt('/dashboard/settings');
    expect(await screen.findByText('home page')).toBeInTheDocument();
    expect(screen.queryByText('secret dashboard')).not.toBeInTheDocument();
  });

  it('redirects authenticated users away from the auth pages', async () => {
    seedSession();
    stubSession(okSession);
    renderAt('/auth/login');
    expect(await screen.findByText('overview page')).toBeInTheDocument();
    expect(screen.queryByText('login form')).not.toBeInTheDocument();
  });

  it('clears a corrupt session payload instead of crashing', () => {
    window.localStorage.setItem(AUTH_KEY, '{not json');
    expect(() => renderAt('/dashboard/settings')).not.toThrow();
    expect(screen.getByText('home page')).toBeInTheDocument();
    expect(window.localStorage.getItem(AUTH_KEY)).toBeNull();
  });
});

describe('LandingGate', () => {
  const okBilling = (canManage: boolean) => async () =>
    new Response(
      JSON.stringify({
        success: true,
        plans: [],
        subscription: null,
        access: {
          state: canManage ? 'active' : 'trial',
          canManage,
          startsAt: null,
          endsAt: null,
          plan: {
            id: 'p1',
            name: 'Pro',
            slug: 'pro',
            priceCents: 34900,
            interval: 'month',
            features: { limits: { campaigns: 10, customers: 1000 }, features: [] },
          },
        },
        pendingRequest: null,
        usage: { campaigns: 0, customers: 0 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );

  function renderLanding() {
    return render(
      <AppProvider>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route
              path="/"
              element={
                <LandingGate>
                  <div>landing page</div>
                </LandingGate>
              }
            />
            <Route path="/dashboard" element={<div>dashboard page</div>} />
          </Routes>
        </MemoryRouter>
      </AppProvider>,
    );
  }

  it('shows the landing page to anonymous visitors without fetching billing', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => okBilling(false)());
    vi.stubGlobal('fetch', fetchMock);
    renderLanding();
    expect(await screen.findByText('landing page')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/billing'))).toBe(false);
  });

  it('sends paid-plan merchants straight to the dashboard', async () => {
    seedSession();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/auth/session')) return okSession();
        return okBilling(true)();
      }),
    );
    renderLanding();
    expect(await screen.findByText('dashboard page')).toBeInTheDocument();
    expect(screen.queryByText('landing page')).not.toBeInTheDocument();
  });

  it('keeps trial users on the landing page', async () => {
    seedSession();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/auth/session')) return okSession();
        return okBilling(false)();
      }),
    );
    renderLanding();
    expect(await screen.findByText('landing page')).toBeInTheDocument();
  });
});
