import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RewardsPage from '@/app/dashboard/rewards/page';

const AUTH_KEY = 'campaign-engage-auth';

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function rewardRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rw1',
    campaign_id: 'c1',
    campaign_name: 'Coffee Spin',
    name: 'Free coffee',
    type: 'free_product',
    value: '1',
    description: '',
    quantity: 5,
    quantity_initial: 5,
    weight: 70,
    active: 1,
    issued_count: 0,
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('rewards page', () => {
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

  it('deletes a reward after confirmation and removes it from the list', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();

      if (method === 'DELETE') {
        expect(String(input)).toBe('/api/business/rewards/rw1');
        return jsonResponse({ success: true, id: 'rw1' });
      }

      return jsonResponse({ success: true, rewards: [rewardRow()] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<RewardsPage />);

    await screen.findByText('Free coffee');
    await userEvent.click(screen.getByRole('button', { name: 'Supprimer la récompense Free coffee' }));

    expect(confirmSpy).toHaveBeenCalledWith('Supprimer « Free coffee » ? Cette action est définitive.');

    await waitFor(() => {
      const deleteCall = fetchMock.mock.calls.find(
        ([, init]) => (init?.method ?? 'GET').toUpperCase() === 'DELETE',
      );
      expect(deleteCall).toBeTruthy();
      expect(String(deleteCall?.[0])).toBe('/api/business/rewards/rw1');
    });

    await waitFor(() => expect(screen.queryByText('Free coffee')).toBeNull());
  });

  it('keeps the reward when the confirmation is declined', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ success: true, rewards: [rewardRow()] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<RewardsPage />);

    await screen.findByText('Free coffee');
    await userEvent.click(screen.getByRole('button', { name: 'Supprimer la récompense Free coffee' }));

    expect(screen.getByText('Free coffee')).toBeTruthy();
    expect(
      fetchMock.mock.calls.find(([, init]) => ((init?.method as string | undefined) ?? 'GET').toUpperCase() === 'DELETE'),
    ).toBeUndefined();
  });

  it('surfaces the API error and keeps the row when the delete fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();

      if (method === 'DELETE') {
        return jsonResponse({ success: false, message: 'Unable to delete the reward.' }, 500);
      }

      return jsonResponse({ success: true, rewards: [rewardRow()] });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<RewardsPage />);

    await screen.findByText('Free coffee');
    await userEvent.click(screen.getByRole('button', { name: 'Supprimer la récompense Free coffee' }));

    await screen.findByText(/Impossible de supprimer la récompense/);
    expect(screen.getByText('Free coffee')).toBeTruthy();
  });
});
