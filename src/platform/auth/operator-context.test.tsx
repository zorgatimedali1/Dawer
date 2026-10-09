import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OperatorProvider,
  RedirectIfOperator,
  RequireOperator,
} from '@/platform/auth/operator-context';

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const operator = {
  id: 'op1',
  email: 'ops@example.test',
  firstName: 'Platform',
  lastName: 'Admin',
};

function stubSession(status: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      status === 200
        ? jsonResponse({ success: true, operator })
        : jsonResponse({ success: false, message: 'Your session has expired. Sign in again.' }, 401),
    ),
  );
}

function renderAt(path: string) {
  return render(
    <OperatorProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/login"
            element={
              <RedirectIfOperator>
                <div>login form</div>
              </RedirectIfOperator>
            }
          />
          <Route
            path="/"
            element={
              <RequireOperator>
                <div>operator console</div>
              </RequireOperator>
            }
          />
        </Routes>
      </MemoryRouter>
    </OperatorProvider>,
  );
}

describe('operator route guards', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends anonymous visitors to the login screen', async () => {
    stubSession(401);
    renderAt('/');

    expect(await screen.findByText('login form')).toBeInTheDocument();
    expect(screen.queryByText('operator console')).not.toBeInTheDocument();
  });

  it('renders the console when the operator session resolves', async () => {
    stubSession(200);
    renderAt('/');

    expect(await screen.findByText('operator console')).toBeInTheDocument();
    expect(screen.queryByText('login form')).not.toBeInTheDocument();
  });

  it('keeps an authenticated operator off the login screen', async () => {
    stubSession(200);
    renderAt('/login');

    expect(await screen.findByText('operator console')).toBeInTheDocument();
    expect(screen.queryByText('login form')).not.toBeInTheDocument();
  });

  it('leaves an anonymous visitor on the login screen', async () => {
    stubSession(401);
    renderAt('/login');

    expect(await screen.findByText('login form')).toBeInTheDocument();
  });
});
