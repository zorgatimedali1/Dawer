import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CampaignCustomerPage from '@/app/customer/[campaignId]/page';

const campaign = {
  id: 'c1',
  name: 'Coffee Spin',
  description: 'Tournez la roue et gagnez',
  public_code: 'ABC123DEF456',
  status: 'ACTIVE',
  start_at: null,
  end_at: null,
  game_type: 'WHEEL',
  require_action: 'GOOGLE_REVIEW',
  require_customer_information: 1,
  google_maps_name: 'Blue Bottle Coffee',
  google_maps_url: 'https://maps.google.com/?cid=1',
  google_place_id: '',
  facebook_url: '',
  instagram_url: '',
  business_name: 'Meridian North',
};

const rewards = [
  { id: 'r1', name: 'Free coffee', description: 'One free coffee', type: 'free_product', value: '1', weight: 70, quantity: 5 },
  { id: 'r2', name: 'Try again', description: null, type: 'none', value: '0', weight: 30, quantity: 0 },
];

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/customer/ABC123DEF456']}>
      <Routes>
        <Route path="/customer/:campaignId" element={<CampaignCustomerPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('public campaign page', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the live campaign, merchant and wheel segments', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: true, campaign, rewards })),
    );

    renderPage();

    await screen.findByRole('heading', { name: 'Coffee Spin' });
    expect(screen.getByText('Meridian North')).toBeTruthy();
    expect(screen.getByText('Free coffee')).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
  });

  it('shows an unavailable state when the campaign is not public', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: false, message: 'Campaign not found.' }, 404)),
    );

    renderPage();

    await screen.findByText(/campaign unavailable/i);
    expect(screen.getByText(/unavailable or has ended/i)).toBeTruthy();
  });

  it('walks details -> spin -> coupon', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();

      if (method === 'GET') return jsonResponse({ success: true, campaign, rewards });

      expect(url).toBe('/api/public/campaigns/ABC123DEF456/participate');
      expect(method).toBe('POST');

      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test' });

      return jsonResponse({ success: true, participation: { reward: rewards[0], couponCode: 'CF-DEADBEEF00112233' } });
    });

    vi.stubGlobal('fetch', fetchMock);

    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Commencer' }));
    await screen.findByRole('heading', { name: 'Action requise' });

    await userEvent.type(screen.getByPlaceholderText('Prénom'), 'Ada');
    await userEvent.type(screen.getByPlaceholderText('Nom'), 'Lovelace');
    await userEvent.type(screen.getByPlaceholderText('Email'), 'ada@example.test');

    await userEvent.click(screen.getByRole('button', { name: /confirmer l’action/i }));
    await screen.findByText(/action complétée/i);

    await userEvent.click(screen.getByRole('button', { name: /tourner la roue/i }));
    await userEvent.click(await screen.findByRole('button', { name: /spin the wheel/i }));

    await waitFor(() => expect(screen.getByText('CF-DEADBEEF00112233')).toBeTruthy(), { timeout: 4000 });
    expect(screen.getByText('Free coffee')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces the API error when the spin is rejected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if ((init?.method ?? 'GET').toUpperCase() === 'GET') {
          return jsonResponse({
            success: true,
            campaign: { ...campaign, require_action: 'NONE', require_customer_information: 0 },
            rewards,
          });
        }
        return jsonResponse({ success: false, message: 'This customer has already participated in this campaign.' }, 409);
      }),
    );

    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Commencer' }));
    await userEvent.click(await screen.findByRole('button', { name: /spin the wheel/i }));

    await screen.findByText(/already participated/i);
  });
});
