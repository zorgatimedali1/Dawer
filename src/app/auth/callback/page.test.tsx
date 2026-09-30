import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AuthCallbackPage from '@/app/auth/callback/page';
import { AppProvider } from '@/contexts/app-context';

const AUTH_KEY = 'campaign-engage-auth';

function renderPage() {
  return render(
    <AppProvider>
      <MemoryRouter initialEntries={['/auth/callback']}>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/dashboard/overview" element={<div>overview destination</div>} />
        </Routes>
      </MemoryRouter>
    </AppProvider>,
  );
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('oauth callback page', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('exchanges the session cookie and signs the user in', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('/api/auth/session');
      expect(init?.credentials).toBe('same-origin');
      return jsonResponse({
        success: true,
        token: 'cf_abc.def',
        user: { id: 'u1', email: 'ada@example.test', firstName: 'Ada', lastName: 'Lovelace', role: 'merchant' },
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    renderPage();

    await screen.findByText('overview destination');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const stored = window.localStorage.getItem(AUTH_KEY);
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored ?? '{}')).toMatchObject({ token: 'cf_abc.def' });
  });

  it('shows a recoverable error when the cookie is missing or expired', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: false, message: 'Your session has expired. Sign in again.' }, 401)),
    );

    renderPage();

    await screen.findByText(/sign in failed/i);
    expect(screen.getByText(/session has expired/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /back to sign in/i })).toBeTruthy();
    expect(window.localStorage.getItem(AUTH_KEY)).toBeNull();
  });
});
