import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PricingPage from '@/app/dashboard/pricing/page';

const AUTH_KEY = 'campaign-engage-auth';

function plan(slug: string, name: string, priceCents: number, campaigns: number, interval = 'month') {
  return {
    id: `plan_${slug}`,
    name,
    slug,
    priceCents,
    interval,
    features: { limits: { campaigns, customers: 100 }, features: [`${name} features`] },
  };
}

function billingPayload(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    plans: [
      plan('starter', 'Starter', 14900, -1, '3_months'),
      plan('growth', 'Pro', 34900, -1, 'year'),
      plan('scale', 'Business', 79900, -1, '3_years'),
      plan('premium', 'Enterprise', 149900, -1, '3_years'),
    ],
    subscription: null,
    pendingRequest: null,
    usage: { campaigns: 0, customers: 0 },
    ...overrides,
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function cardOf(name: string): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name });
  const card = heading.closest('.rounded-3xl');
  expect(card).not.toBeNull();
  return card as HTMLElement;
}

describe('pricing page', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(
      AUTH_KEY,
      JSON.stringify({ token: 'cf_abc.def', user: { id: 'u1', email: 'a@b.co', role: 'merchant' } }),
    );
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders all four plans served by the API with Tunisian prices', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(billingPayload())));
    render(<PricingPage />);

    expect(await screen.findByRole('heading', { name: 'Starter' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pro' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Business' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Enterprise' })).toBeInTheDocument();
    expect(screen.getByText('349 DT')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Acheter' })).toHaveLength(4);
  });

  it('records the request and opens the owner on WhatsApp', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/billing') return jsonResponse(billingPayload());

      expect(url).toBe('/api/billing/subscribe-request');
      expect(JSON.parse(String(init?.body))).toEqual({ planSlug: 'premium' });
      return jsonResponse({
        success: true,
        requestId: 'req-1',
        plan: { id: 'plan_premium', name: 'Enterprise', slug: 'premium' },
        whatsappUrl: 'https://wa.me/21699744593?text=commande',
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window);

    render(<PricingPage />);
    await userEvent.click(within(await cardOf('Enterprise')).getByRole('button', { name: 'Acheter' }));

    await waitFor(() => expect(open).toHaveBeenCalledWith('https://wa.me/21699744593?text=commande', '_blank', 'noopener'));
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/api/billing/subscribe-request'))).toBe(true);
  });

  it('locks the plan the merchant already pays for', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          billingPayload({
            subscription: {
              id: 's1',
              status: 'active',
              currentPeriodEnd: null,
              plan: { id: 'plan_premium', name: 'Enterprise', slug: 'premium', priceCents: 149900, interval: '3_years' },
            },
          }),
        ),
      ),
    );
    render(<PricingPage />);

    const button = await within(await cardOf('Enterprise')).findByRole('button', { name: 'Plan actuel' });
    expect(button).toBeDisabled();
  });

  it('shows a request that is still waiting for the owner', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          billingPayload({
            pendingRequest: { id: 'req-1', plan: { name: 'Enterprise', slug: 'premium' }, createdAt: '2026-01-01T00:00:00.000Z' },
          }),
        ),
      ),
    );
    render(<PricingPage />);

    const button = await within(await cardOf('Enterprise')).findByRole('button', { name: 'Demande envoyée' });
    expect(button).toBeDisabled();
  });
});
