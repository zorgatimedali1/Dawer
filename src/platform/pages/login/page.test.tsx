import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LoginPage from '@/platform/pages/login/page';
import { OperatorProvider } from '@/platform/auth/operator-context';

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const operator = { id: 'op1', email: 'admin@dawer.com', firstName: 'Platform', lastName: 'Admin' };

const sessionOnly = vi.fn(async () =>
  jsonResponse({ success: false, message: 'Your session has expired. Sign in again.' }, 401),
);

async function renderLogin(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock);
  const view = render(
    <OperatorProvider>
      <MemoryRouter initialEntries={['/login']}>
        <LoginPage />
      </MemoryRouter>
    </OperatorProvider>,
  );
  await screen.findByRole('button', { name: 'Sign in' });
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  return view;
}

describe('platform login page', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    sessionOnly.mockClear();
  });

  it('posts the credentials to the operator login endpoint', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/auth/session') return sessionOnly();

      expect(url).toBe('/api/auth/login');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({
        email: 'admin@dawer.com',
        password: 'medali123',
      });
      return jsonResponse({ success: true, operator });
    });

    await renderLogin(fetchMock);

    await userEvent.type(screen.getByLabelText('Email'), 'admin@dawer.com');
    await userEvent.type(screen.getByLabelText('Password'), 'medali123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((call) => String(call[0]) === '/api/auth/login')).toBe(true),
    );
  });

  it('surfaces the backend reason when the credentials are rejected', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/auth/session') return sessionOnly();
      return jsonResponse({ success: false, message: 'Invalid email or password.' }, 401);
    });

    await renderLogin(fetchMock);

    await userEvent.type(screen.getByLabelText('Email'), 'admin@dawer.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
  });
});
