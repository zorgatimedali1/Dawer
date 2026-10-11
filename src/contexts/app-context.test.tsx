import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppProvider, useAppContext } from '@/contexts/app-context';

const cachedUser = {
  id: 'user-1',
  email: 'merchant@example.test',
  firstName: 'Med',
  lastName: 'Ali',
  role: 'merchant' as const,
};

function Probe() {
  const { isAuthenticated } = useAppContext();
  return <p>{isAuthenticated ? 'authed' : 'anonymous'}</p>;
}

function LogoutProbe() {
  const { isAuthenticated, logout } = useAppContext();
  return (
    <>
      <p>{isAuthenticated ? 'authed' : 'anonymous'}</p>
      <button type="button" onClick={() => void logout()}>
        sign out
      </button>
    </>
  );
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function renderProbeWithSessionResponse(handler: () => Promise<Response>) {
  window.localStorage.setItem('campaign-engage-auth', JSON.stringify({ user: cachedUser }));
  vi.stubGlobal('fetch', vi.fn(handler));
  return render(
    <AppProvider>
      <Probe />
    </AppProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('session revalidation on bootstrap', () => {
  it('keeps the cached user when the server session is still valid', async () => {
    renderProbeWithSessionResponse(async () => json({ success: true, user: cachedUser }, 200));

    expect(await screen.findByText('authed')).toBeInTheDocument();
    expect(window.localStorage.getItem('campaign-engage-auth')).not.toBeNull();
  });

  it('clears the cached user when the server session has expired (401)', async () => {
    renderProbeWithSessionResponse(async () => json({ success: false, error: 'Your session has expired. Sign in again.' }, 401));

    expect(await screen.findByText('anonymous')).toBeInTheDocument();
    expect(window.localStorage.getItem('campaign-engage-auth')).toBeNull();
  });

  it('keeps the cached user when the revalidation request fails offline', async () => {
    renderProbeWithSessionResponse(async () => {
      throw new TypeError('Network connection lost.');
    });

    // The initial render already shows the cached state and the failed
    // revalidation must not flip it.
    expect(screen.getByText('authed')).toBeInTheDocument();
    expect(window.localStorage.getItem('campaign-engage-auth')).not.toBeNull();
  });

  it('stays anonymous for visitors without a cached session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ success: true, partners: [] }, 200)),
    );
    render(
      <AppProvider>
        <Probe />
      </AppProvider>,
    );

    expect(await screen.findByText('anonymous')).toBeInTheDocument();
  });
});

describe('session-expired event (mid-session 401)', () => {
  it('drops the React state so route guards can redirect', async () => {
    renderProbeWithSessionResponse(async () => json({ success: true, user: cachedUser }, 200));
    expect(await screen.findByText('authed')).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event('session-expired'));
    });

    expect(screen.getByText('anonymous')).toBeInTheDocument();
    expect(window.localStorage.getItem('campaign-engage-auth')).toBeNull();
  });
});

describe('logout vs in-flight revalidation race', () => {
  it('never resurrects a session the user signed out of', async () => {
    window.localStorage.setItem('campaign-engage-auth', JSON.stringify({ user: cachedUser }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes('/auth/session')) {
          // Held open until after the logout so the race is deterministic.
          return new Promise<Response>((resolve) => {
            window.setTimeout(() => resolve(json({ success: true, user: cachedUser }, 200)), 0);
          });
        }
        return json({ success: true }, 200);
      }),
    );

    render(
      <AppProvider>
        <LogoutProbe />
      </AppProvider>,
    );

    expect(screen.getByText('authed')).toBeInTheDocument();

    fireEvent.click(screen.getByText('sign out'));
    expect(screen.getByText('anonymous')).toBeInTheDocument();

    // Let the late session 200 land, then assert it was ignored.
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });

    expect(screen.getByText('anonymous')).toBeInTheDocument();
    expect(window.localStorage.getItem('campaign-engage-auth')).toBeNull();
  });
});
