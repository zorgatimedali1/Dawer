import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BillingPage from '@/app/dashboard/billing/page';

const AUTH_KEY = 'campaign-engage-auth';

const plans = [
  {
    id: 'plan_starter',
    name: 'Starter',
    slug: 'starter',
    priceCents: 14900,
    interval: '3_months',
    features: { limits: { campaigns: -1, customers: 100 }, features: ['200 e-mails marketing inclus', 'Sans engagement'] },
  },
  {
    id: 'plan_growth',
    name: 'Pro',
    slug: 'growth',
    priceCents: 34900,
    interval: 'year',
    features: { limits: { campaigns: -1, customers: 1000 }, features: ['Vue d’ensemble et analytics de base'] },
  },
  {
    id: 'plan_scale',
    name: 'Business',
    slug: 'scale',
    priceCents: 79900,
    interval: '3_years',
    features: { limits: { campaigns: -1, customers: 10000 }, features: ['Analytics avancées'] },
  },
  {
    id: 'plan_premium',
    name: 'Enterprise',
    slug: 'premium',
    priceCents: 149900,
    interval: '3_years',
    features: { limits: { campaigns: -1, customers: -1 }, features: ['Accompagnement dédié'] },
  },
];

function billingPayload(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    plans,
    subscription: null,
    pendingRequest: null,
    usage: { campaigns: 2, customers: 30 },
    access: {
      state: 'none',
      canManage: false,
      startsAt: null,
      endsAt: null,
      plan: plans[0],
    },
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
  const card = heading.closest('.rounded-lg');
  expect(card).not.toBeNull();
  return card as HTMLElement;
}

describe('billing page', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(
      AUTH_KEY,
      JSON.stringify({ token: 'cf_abc.def', user: { id: 'u1', email: 'a@b.co', role: 'merchant' } }),
    );
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the current plan and the request still waiting', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          billingPayload({
            subscription: {
              id: 's1',
              status: 'active',
              currentPeriodStart: '2026-08-01T00:00:00.000Z',
              currentPeriodEnd: '2026-11-01T00:00:00.000Z',
              plan: { id: 'plan_starter', name: 'Starter', slug: 'starter', priceCents: 14900, interval: '3_months' },
            },
            access: {
              state: 'active',
              canManage: true,
              startsAt: '2026-08-01T00:00:00.000Z',
              endsAt: '2026-11-01T00:00:00.000Z',
              plan: plans[0],
            },
            pendingRequest: { id: 'req-1', plan: { name: 'Enterprise', slug: 'premium' }, createdAt: '2026-01-01T00:00:00.000Z' },
          }),
        ),
      ),
    );
    const { container } = render(<BillingPage />);

    expect(await screen.findByText(/Starter\s*·\s*Abonnement actif/)).toBeInTheDocument();
    expect(screen.getByText(/Début\s*:/)).toBeInTheDocument();
    expect(screen.getByText(/Fin\s*:/)).toBeInTheDocument();
    expect(container.querySelector('time[datetime="2026-08-01T00:00:00.000Z"]')).not.toBeNull();
    expect(container.querySelector('time[datetime="2026-11-01T00:00:00.000Z"]')).not.toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Demande en attente pour le plan Enterprise.');
    expect(await within(await cardOf('Starter')).findByRole('button', { name: 'Plan actuel' })).toBeDisabled();
    expect(await within(await cardOf('Enterprise')).findByRole('button', { name: 'Demande envoyée' })).toBeDisabled();
  });

  it('explains the full-access Starter trial and its end date', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(billingPayload({
      subscription: {
        id: 'trial-1',
        status: 'trialing',
        currentPeriodStart: '2026-10-02T00:00:00.000Z',
        currentPeriodEnd: '2026-10-09T00:00:00.000Z',
        plan: { id: 'plan_starter', name: 'Starter', slug: 'starter', priceCents: 14900, interval: '3_months' },
      },
      access: {
        state: 'trial',
        canManage: true,
        startsAt: '2026-10-02T00:00:00.000Z',
        endsAt: '2026-10-09T00:00:00.000Z',
        plan: plans[0],
      },
    }))));

    render(<BillingPage />);

    expect(await screen.findByText(/Essai Starter de 7 jours/)).toBeInTheDocument();
    expect(screen.getByText(/toutes les permissions du plan Starter/)).toBeInTheDocument();
    expect(screen.queryByText(/Mode lecture seule/)).not.toBeInTheDocument();
    expect(screen.getByText(/200 e-mails marketing inclus/)).toBeInTheDocument();
    expect(screen.getByText(/Sans engagement/)).toBeInTheDocument();
    expect(document.body).toHaveTextContent('Clients : 30/100');
  });

  it('tells the merchant his free trial ended and to contact support', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(billingPayload({
      subscription: {
        id: 'trial-1',
        status: 'trialing',
        currentPeriodStart: '2026-09-02T00:00:00.000Z',
        currentPeriodEnd: '2026-09-09T00:00:00.000Z',
        plan: { id: 'plan_starter', name: 'Starter', slug: 'starter', priceCents: 14900, interval: '3_months' },
      },
      access: {
        state: 'trial_expired',
        canManage: false,
        startsAt: '2026-09-02T00:00:00.000Z',
        endsAt: '2026-09-09T00:00:00.000Z',
        plan: plans[0],
      },
    }))));

    render(<BillingPage />);

    expect(await screen.findByText(/Essai terminé · lecture seule/)).toBeInTheDocument();
    expect(screen.getByText(/Votre essai gratuit de 7 jours est terminé\. Contactez le support/)).toBeInTheDocument();
    expect(screen.getByText(/Essai terminé$/)).toBeInTheDocument();
    expect(screen.getByText(/Contactez le support WhatsApp pour acheter un plan/)).toBeInTheDocument();
    expect(screen.getByText(/Fin\s*:/)).toBeInTheDocument();
    expect(await within(await cardOf('Starter')).findByRole('button', { name: 'Acheter' })).toBeEnabled();
  });

  it('asks for a plan and opens WhatsApp with the owner number', async () => {
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

    render(<BillingPage />);
    await userEvent.click(within(await cardOf('Enterprise')).getByRole('button', { name: 'Acheter' }));

    await waitFor(() => expect(open).toHaveBeenCalledWith('https://wa.me/21699744593?text=commande', '_blank', 'noopener'));
    expect(await screen.findByText('Demande envoyée pour le plan Enterprise.')).toBeInTheDocument();
  });

  it('surfaces the failure message when the server refuses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/billing') return jsonResponse(billingPayload());
        return jsonResponse({ success: false, message: 'A request is already awaiting validation.' }, 409);
      }),
    );
    vi.spyOn(window, 'open').mockReturnValue({} as Window);

    render(<BillingPage />);
    await userEvent.click(within(await cardOf('Enterprise')).getByRole('button', { name: 'Acheter' }));

    expect(await screen.findByText('A request is already awaiting validation.')).toBeInTheDocument();
  });
});
