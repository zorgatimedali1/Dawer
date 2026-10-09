import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ResetPasswordPage from '@/app/auth/reset-password/page';

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function renderPage(initialEntry = '/auth/reset-password?token=cfr_abc123def') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillAndSubmit(container: HTMLElement, password: string, confirm: string) {
  await userEvent.type(container.querySelector('#password')!, password);
  await userEvent.type(container.querySelector('#confirm')!, confirm);
  await userEvent.click(screen.getByRole('button', { name: /enregistrer/i }));
}

describe('reset password page', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('redeems the token carried by the emailed link', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ success: true }));
    vi.stubGlobal('fetch', fetchMock);

    const { container } = renderPage();
    await fillAndSubmit(container, 'NewPass123!', 'NewPass123!');

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('/api/auth/reset-password');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      token: 'cfr_abc123def',
      password: 'NewPass123!',
    });

    await screen.findByText(/mot de passe a bien été réinitialisé/i);
  });

  it('surfaces a server rejection when the token is invalid or expired', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          { success: false, message: 'This reset link is invalid or has expired. Request a new one.' },
          400,
        ),
      ),
    );

    const { container } = renderPage();
    await fillAndSubmit(container, 'NewPass123!', 'NewPass123!');

    await screen.findByText(/échoué/i);
  });

  it('refuses to submit mismatched passwords', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true }));
    vi.stubGlobal('fetch', fetchMock);

    const { container } = renderPage();
    await fillAndSubmit(container, 'NewPass123!', 'Different123!');

    // Shown both inline (Field) and in the form-level error slot.
    expect((await screen.findAllByText(/ne correspondent pas/i)).length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never posts when the link carries no token', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true }));
    vi.stubGlobal('fetch', fetchMock);

    const { container } = renderPage('/auth/reset-password');
    await fillAndSubmit(container, 'NewPass123!', 'NewPass123!');

    await screen.findByText(/échoué/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
