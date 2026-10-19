import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RewardsPage from '@/app/dashboard/rewards/page';
import { invalidateCachedResource } from '@/hooks/useCachedResource';

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

function campaignRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    name: 'Coffee Spin',
    description: '',
    status: 'ACTIVE',
    public_code: 'ABC123',
    start_at: null,
    end_at: null,
    participant_count: 0,
    reward_count: 0,
    redemption_count: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('rewards page', () => {
  beforeEach(() => {
    invalidateCachedResource();
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

      if (String(input).includes('/api/business/campaigns')) {
        return jsonResponse({ success: true, campaigns: [campaignRow()] });
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
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/api/business/campaigns')) {
        return jsonResponse({ success: true, campaigns: [campaignRow()] });
      }
      return jsonResponse({ success: true, rewards: [rewardRow()] });
    });
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

      if (String(input).includes('/api/business/campaigns')) {
        return jsonResponse({ success: true, campaigns: [campaignRow()] });
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

  it('shows effective odds: a sold-out reward drops to 0% and its weight lands on Prochaine fois', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/business/campaigns')) {
        return jsonResponse({ success: true, campaigns: [campaignRow()] });
      }
      return jsonResponse({
        success: true,
        rewards: [
          rewardRow({ id: 'r1', name: 'Rare', quantity: 0, quantity_initial: 1, weight: 70 }),
          rewardRow({ id: 'r2', name: 'Always on', quantity: 3, quantity_initial: null, weight: 30 }),
          rewardRow({
            id: 'r3',
            name: 'Prochaine fois',
            type: 'none',
            quantity: 0,
            quantity_initial: 0,
            weight: 0,
            active: 1,
          }),
        ],
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<RewardsPage />);

    await screen.findByText('Rare');
    // Rare (70) is sold out: 0% for it; the 70 lands on the hidden none slice.
    // "Always on" keeps its 30% share of the total weight (100).
    const chances = await screen.findAllByText(/%$/);
    expect(chances.map((node) => node.textContent)).toEqual(['0%', '30%']);
  });

  it('keeps the raw distribution when nothing is sold out', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/business/campaigns')) {
        return jsonResponse({ success: true, campaigns: [campaignRow()] });
      }
      return jsonResponse({
        success: true,
        rewards: [
          rewardRow({ id: 'r1', name: 'Free coffee', quantity: 5, quantity_initial: 5, weight: 70 }),
          rewardRow({ id: 'r2', name: 'Prochaine fois', type: 'none', quantity: 0, quantity_initial: 0, weight: 30 }),
        ],
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<RewardsPage />);

    await screen.findByText('Free coffee');
    const chances = await screen.findAllByText(/%$/);
    expect(chances.map((node) => node.textContent)).toEqual(['70%']);
  });

  it('hides the Prochaine fois (type none) reward from the list and the type filter', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/business/campaigns')) {
        return jsonResponse({ success: true, campaigns: [campaignRow()] });
      }
      return jsonResponse({
        success: true,
        rewards: [
          rewardRow({ id: 'r1', name: 'Free coffee' }),
          rewardRow({ id: 'r2', name: 'Prochaine fois', type: 'none', weight: 30 }),
        ],
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<RewardsPage />);

    await screen.findByText('Free coffee');
    expect(screen.queryByText('Prochaine fois')).toBeNull();

    const typeFilter = screen.getByRole('combobox', { name: /type de récompense/i });
    expect(within(typeFilter).queryByRole('option', { name: 'Aucune récompense' })).toBeNull();
  });

  it('shows one chip per non-archived campaign and defaults to the newest one', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/business/campaigns')) {
        return jsonResponse({
          success: true,
          campaigns: [
            campaignRow(),
            campaignRow({ id: 'c2', name: 'Pizza Spin' }),
            campaignRow({ id: 'c3', name: 'Old Spin', status: 'ARCHIVED' }),
          ],
        });
      }
      return jsonResponse({
        success: true,
        rewards: [rewardRow({ id: 'r1', campaign_id: 'c1', campaign_name: 'Coffee Spin', name: 'Free coffee' })],
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<RewardsPage />);

    const coffeeChip = await screen.findByRole('button', { name: 'Coffee Spin' });
    expect(screen.getByRole('button', { name: 'Pizza Spin' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Old Spin' })).toBeNull();
    await waitFor(() => expect(coffeeChip.getAttribute('aria-pressed')).toBe('true'));

    await screen.findByText('Free coffee');
    expect(screen.queryByRole('heading', { name: 'Coffee Spin' })).toBeNull();
  });

  it('filters rewards by campaign through the API when one is selected', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/business/campaigns')) {
        return jsonResponse({
          success: true,
          campaigns: [campaignRow(), campaignRow({ id: 'c2', name: 'Pizza Spin' })],
        });
      }
      if (url.includes('campaignId=c2')) {
        return jsonResponse({
          success: true,
          rewards: [rewardRow({ id: 'r2', campaign_id: 'c2', campaign_name: 'Pizza Spin', name: 'Free pizza' })],
        });
      }
      return jsonResponse({
        success: true,
        rewards: [rewardRow({ id: 'r1', campaign_id: 'c1', campaign_name: 'Coffee Spin', name: 'Free coffee' })],
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<RewardsPage />);

    await screen.findByText('Free coffee');

    await userEvent.click(screen.getByRole('button', { name: 'Pizza Spin' }));

    await screen.findByText('Free pizza');
    expect(screen.queryByText('Free coffee')).toBeNull();
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes('/api/business/rewards?campaignId=c2')),
    ).toBe(true);
  });

  it('computes odds per campaign, not across the whole list', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/business/campaigns')) {
        return jsonResponse({
          success: true,
          campaigns: [campaignRow(), campaignRow({ id: 'c2', name: 'Pizza Spin' })],
        });
      }
      return jsonResponse({
        success: true,
        rewards: [
          rewardRow({ id: 'r1', campaign_id: 'c1', campaign_name: 'Coffee Spin', name: 'Coffee prize', weight: 70 }),
          rewardRow({
            id: 'n1',
            campaign_id: 'c1',
            campaign_name: 'Coffee Spin',
            name: 'Prochaine fois',
            type: 'none',
            weight: 30,
          }),
          rewardRow({ id: 'r2', campaign_id: 'c2', campaign_name: 'Pizza Spin', name: 'Pizza prize', weight: 10 }),
          rewardRow({
            id: 'n2',
            campaign_id: 'c2',
            campaign_name: 'Pizza Spin',
            name: 'Prochaine fois',
            type: 'none',
            weight: 90,
          }),
        ],
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<RewardsPage />);

    await screen.findByText('Coffee prize');
    // Per campaign: Coffee prize is 70/100 = 70%, Pizza prize is 10/100 = 10%.
    // A global mix would have shown 35% and 5%.
    const chances = await screen.findAllByText(/%$/);
    expect(chances.map((node) => node.textContent)).toEqual(['70%', '10%']);
  });
});
