import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RedirectIfAuthenticated, RequireAuth } from '@/components/route-guards';
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
    expect(screen.getByText('login form')).toBeInTheDocument();
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

  it('bounces to sign-in when the cached session has expired', async () => {
    seedSession();
    stubSession(deadSession);
    renderAt('/dashboard/settings');
    expect(await screen.findByText('login form')).toBeInTheDocument();
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
    expect(screen.getByText('login form')).toBeInTheDocument();
    expect(window.localStorage.getItem(AUTH_KEY)).toBeNull();
  });
});
