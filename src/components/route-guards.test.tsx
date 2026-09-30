import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { RedirectIfAuthenticated, RequireAuth } from '@/components/route-guards';
import { AppProvider } from '@/contexts/app-context';

const AUTH_KEY = 'campaign-engage-auth';

function seedSession() {
  window.localStorage.setItem(
    AUTH_KEY,
    JSON.stringify({
      token: 'cf_abc.def',
      user: { id: 'u1', email: 'a@b.co', firstName: 'Ada', lastName: 'Lovelace', role: 'merchant' },
    }),
  );
}

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

  it('redirects unauthenticated visitors away from the dashboard', () => {
    renderAt('/dashboard/settings');
    expect(screen.getByText('login form')).toBeInTheDocument();
    expect(screen.queryByText('secret dashboard')).not.toBeInTheDocument();
  });

  it('lets authenticated users render the dashboard on first paint', () => {
    seedSession();
    renderAt('/dashboard/settings');
    expect(screen.getByText('secret dashboard')).toBeInTheDocument();
    expect(screen.queryByText('login form')).not.toBeInTheDocument();
  });

  it('redirects authenticated users away from the auth pages', () => {
    seedSession();
    renderAt('/auth/login');
    expect(screen.getByText('overview page')).toBeInTheDocument();
    expect(screen.queryByText('login form')).not.toBeInTheDocument();
  });

  it('clears a corrupt session payload instead of crashing', () => {
    window.localStorage.setItem(AUTH_KEY, '{not json');
    expect(() => renderAt('/dashboard/settings')).not.toThrow();
    expect(screen.getByText('login form')).toBeInTheDocument();
    expect(window.localStorage.getItem(AUTH_KEY)).toBeNull();
  });
});
