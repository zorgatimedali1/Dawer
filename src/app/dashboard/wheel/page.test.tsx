import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import WheelConfigPage from '@/app/dashboard/wheel/page';

const AUTH_KEY = 'campaign-engage-auth';

function renderPage() {
  return render(
    <MemoryRouter>
      <WheelConfigPage />
    </MemoryRouter>,
  );
}

describe('wheel configuration page', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(
      AUTH_KEY,
      JSON.stringify({
        token: 'cf_abc.def',
        user: { id: 'u1', email: 'a@b.co', firstName: 'Ada', lastName: 'Lovelace', role: 'merchant' },
      }),
    );
    vi.restoreAllMocks();
  });

  it('wires the save button to the campaign-config PUT request', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();

      if (method === 'GET') {
        return new Response(JSON.stringify({ success: true, campaign: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      expect(url).toBe('/api/business/campaign-config');
      expect(method).toBe('PUT');
      expect(init?.headers).toMatchObject({ authorization: 'Bearer cf_abc.def' });

      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({ title: 'Tentez votre chance 🎉' });

      return new Response(JSON.stringify({ success: true, campaign: { id: 'c1', publicCode: 'ABCDEF012345' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    renderPage();

    const saveButton = await screen.findByRole('button', { name: /enregistrer la configuration/i });
    expect(saveButton).toBeEnabled();

    await userEvent.click(saveButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await screen.findByText(/public campaign link is ready/i);
  });

  it('blocks saving while the total probability exceeds 100%', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ success: true, campaign: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    renderPage();

    const saveButton = await screen.findByRole('button', { name: /enregistrer la configuration/i });
    expect(saveButton).toBeEnabled();

    const addReward = await screen.findByRole('button', { name: /add reward|ajouter/i });
    await userEvent.click(addReward);

    await waitFor(() => expect(saveButton).toBeDisabled(), { timeout: 2000 });
  });
});
