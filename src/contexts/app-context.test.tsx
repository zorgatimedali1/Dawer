import { render, screen } from '@testing-library/react';
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
    renderProbeWithSessionResponse(async () =>
      new Response(JSON.stringify({ success: true, user: cachedUser }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(await screen.findByText('authed')).toBeInTheDocument();
    expect(window.localStorage.getItem('campaign-engage-auth')).not.toBeNull();
  });

  it('clears the cached user when the server session has expired (401)', async () => {
    renderProbeWithSessionResponse(async () =>
      new Response(JSON.stringify({ success: false, error: 'Your session has expired. Sign in again.' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );

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
      vi.fn(async () =>
        new Response(JSON.stringify({ success: true, partners: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    render(
      <AppProvider>
        <Probe />
      </AppProvider>,
    );

    expect(await screen.findByText('anonymous')).toBeInTheDocument();
  });
});
