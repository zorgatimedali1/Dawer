import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WhatsAppPage from '@/app/dashboard/whatsapp/page';

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type StubOptions = {
  allowed?: boolean;
  configured?: boolean;
  reachable?: boolean;
  gatewayState?: string;
  qr?: string | null;
  sent?: number;
  batchLimit?: number;
  winners?: unknown[];
  customers?: unknown[];
  broadcasts?: unknown[];
  postStatus?: number;
  postError?: string;
};

function stubFetch(options: StubOptions = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (url.startsWith('/api/whatsapp-web/status')) {
      const allowed = options.allowed ?? true;
      const limit = allowed ? 200 : 0;
      const sent = options.sent ?? 0;
      return jsonResponse({
        success: true,
        status: {
          allowed,
          planSlug: allowed ? 'growth' : 'starter',
          planName: allowed ? 'Pro' : 'Starter',
          monthlyLimit: limit,
          batchLimit: options.batchLimit ?? 100,
          sentThisMonth: sent,
          remaining: Math.max(0, limit - sent),
          gateway: {
            configured: options.configured ?? true,
            reachable: options.reachable ?? true,
            state: options.gatewayState ?? 'READY',
            qr: options.qr ?? null,
            pairUrl: 'https://gateway.test/pair?key=secret',
          },
        },
      });
    }

    if (url.startsWith('/api/whatsapp-web/winners')) {
      return jsonResponse({
        success: true,
        winners: options.winners ?? [
          {
            id: 'coupon-1',
            name: 'Ada Lovelace',
            phone: '22345678',
            prize: 'Free coffee',
            campaign: 'Wheel week',
            wonAt: '2026-10-01T10:00:00.000Z',
          },
          {
            id: 'coupon-2',
            name: 'Bob',
            phone: '22345679',
            prize: '10% off',
            campaign: 'Wheel week',
            wonAt: '2026-10-01T11:00:00.000Z',
          },
        ],
      });
    }

    if (method === 'POST' && url.startsWith('/api/whatsapp-web/broadcast')) {
      if (options.postStatus) {
        return jsonResponse({ success: false, error: options.postError ?? 'Request failed.' }, options.postStatus);
      }
      return jsonResponse(
        {
          success: true,
          campaign: {
            id: 'ww-campaign-1',
            totalRecipients: 1,
            sent: 0,
            failed: 0,
            status: 'PROCESSING',
            message: 'hello',
            lastError: null,
            createdAt: '2026-10-01T10:00:00.000Z',
            updatedAt: '2026-10-01T10:00:00.000Z',
          },
        },
        202,
      );
    }

    if (url.startsWith('/api/whatsapp-web/campaigns/ww-campaign-1')) {
      return jsonResponse({
        success: true,
        campaign: {
          id: 'ww-campaign-1',
          totalRecipients: 1,
          sent: 1,
          failed: 0,
          status: 'COMPLETED',
          message: 'hello',
          lastError: null,
          createdAt: '2026-10-01T10:00:00.000Z',
          updatedAt: '2026-10-01T10:01:00.000Z',
        },
      });
    }

    if (url.startsWith('/api/whatsapp-web/broadcast')) {
      return jsonResponse({ success: true, campaigns: options.broadcasts ?? [] });
    }

    if (url.startsWith('/api/business/customers')) {
      const customers = options.customers ?? [];
      return jsonResponse({ success: true, customers, total: customers.length, page: 1, limit: 100 });
    }

    return jsonResponse({ success: true });
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/dashboard/whatsapp?tab=web']}>
      <WhatsAppPage />
    </MemoryRouter>,
  );
}

describe('WhatsApp Web broadcast panel', () => {
  beforeEach(() => {
    window.localStorage.setItem('campaign-engage-auth', JSON.stringify({ token: 'ww-test-token' }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('shows the shared monthly usage and gateway state', async () => {
    stubFetch({ sent: 10 });
    renderPage();

    expect(await screen.findByText('10 / 200 messages utilisés')).toBeTruthy();
    expect(screen.getByText('190 restants')).toBeTruthy();
    expect(screen.getByText('Passerelle connectée')).toBeTruthy();
  });

  it('locks Starter accounts behind the billing page', async () => {
    stubFetch({ allowed: false });
    renderPage();

    expect(
      await screen.findByText('Les diffusions sont réservées aux plans Pro et Business'),
    ).toBeTruthy();
    const upgrade = screen.getByRole('link', { name: 'Voir les plans' });
    expect(upgrade.getAttribute('href')).toBe('/dashboard/billing');
    expect(screen.queryByText('Gagnants à contacter')).toBeNull();
  });

  it('warns when the gateway is offline and blocks the send button', async () => {
    stubFetch({ reachable: false });
    renderPage();

    expect(
      (await screen.findAllByText('Passerelle hors ligne — les envois sont impossibles pour le moment.'))
        .length,
    ).toBeGreaterThan(0);
    const send = await screen.findByRole('button', { name: 'Envoyer' });
    expect(send.hasAttribute('disabled')).toBe(true);
  });

  it('shows the pairing QR and blocks sending until the phone is linked', async () => {
    stubFetch({ gatewayState: 'PAIRING', qr: 'data:image/png;base64,QQ==' });
    renderPage();

    expect(await screen.findByText('Lier votre téléphone')).toBeTruthy();
    expect(screen.getAllByText('Non appairé').length).toBeGreaterThan(0);
    expect(screen.getByAltText('Code QR d’appairage WhatsApp').getAttribute('src')).toBe(
      'data:image/png;base64,QQ==',
    );
    expect(screen.getByRole('link', { name: 'Ouvrir la page d’appairage' }).getAttribute('href')).toBe(
      'https://gateway.test/pair?key=secret',
    );

    await userEvent.click(await screen.findByRole('button', { name: /Ada Lovelace/ }));
    expect(screen.getByRole('button', { name: 'Envoyer à 1 contacts' }).hasAttribute('disabled')).toBe(true);
  });

  it('sends selected winners with the composed message', { timeout: 15_000 }, async () => {
    const fetchMock = stubFetch();
    renderPage();

    const winnerChip = await screen.findByRole('button', { name: /Ada Lovelace/ });
    await userEvent.click(winnerChip);

    await userEvent.click(screen.getByRole('button', { name: 'Envoyer à 1 contacts' }));
    expect(
      screen.getByText(
        'Vous êtes sur le point d’envoyer 1 messages. Cela utilisera 1 de votre limite mensuelle. Envoi estimé : moins d’une minute.',
      ),
    ).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Envoyer' }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        (call) =>
          String((call as unknown as [RequestInfo, RequestInit])[0]).startsWith('/api/whatsapp-web/broadcast') &&
          ((call as unknown as [RequestInfo, RequestInit])[1]?.method ?? 'GET') === 'POST',
      );
      expect(post).toBeTruthy();
      const body = JSON.parse(String((post as unknown as [RequestInfo, RequestInit])[1]?.body));
      expect(body.recipients).toEqual([{ name: 'Ada Lovelace', prize: 'Free coffee', phone: '22345678' }]);
      expect(body.message).toContain('{prize}');
    });

    expect(await screen.findByText('Diffusion en cours')).toBeTruthy();
    expect(await screen.findByText('Terminée', undefined, { timeout: 5000 })).toBeTruthy();
  });

  it('offers customers with a phone number as recipients', async () => {
    stubFetch({
      customers: [
        {
          id: 'cust-1',
          first_name: 'Grace',
          last_name: 'Hopper',
          email: 'grace@example.test',
          phone: '98765432',
          birthday: null,
          marketing_consent: 1,
          created_at: '2026-10-01T10:00:00.000Z',
          last_activity_at: null,
        },
        {
          id: 'cust-2',
          first_name: 'No',
          last_name: 'Phone',
          email: 'nophone@example.test',
          phone: '',
          birthday: null,
          marketing_consent: 0,
          created_at: '2026-10-01T10:00:00.000Z',
          last_activity_at: null,
        },
      ],
    });
    renderPage();

    const chip = await screen.findByRole('button', { name: /Grace Hopper/ });
    expect(screen.queryByRole('button', { name: /No Phone/ })).toBeNull();

    await userEvent.click(chip);
    expect(await screen.findByRole('button', { name: 'Envoyer à 1 contacts' })).toBeTruthy();
  });

  it('blocks sending above the per-broadcast batch limit', async () => {
    const manyWinners = Array.from({ length: 101 }, (_, index) => ({
      id: `coupon-${index}`,
      name: `Winner ${index}`,
      phone: `2234${String(5600 + index)}`,
      prize: 'Free coffee',
      campaign: 'Wheel week',
      wonAt: '2026-10-01T10:00:00.000Z',
    }));
    stubFetch({ batchLimit: 100, winners: manyWinners });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Tout sélectionner' }));

    expect(await screen.findByText('Le plan PRO autorise 100 destinataires par diffusion.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Envoyer à 101 contacts' }).hasAttribute('disabled')).toBe(true);
  });

  it('surfaces the plan-limit copy from the API', async () => {
    stubFetch({
      postStatus: 403,
      postError: 'PRO plan limit reached. Upgrade to Business for 1000 messages',
    });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: /Ada Lovelace/ }));

    await userEvent.click(screen.getByRole('button', { name: 'Envoyer à 1 contacts' }));
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer' }));

    expect(
      await screen.findByText('Limite du plan PRO atteinte. Passez au plan Business pour 1000 messages.'),
    ).toBeTruthy();
  });

  it('offers resume on failed broadcasts in the history', async () => {
    stubFetch({
      broadcasts: [
        {
          id: 'ww-old',
          totalRecipients: 10,
          sent: 4,
          failed: 1,
          status: 'FAILED',
          message: 'hello',
          lastError: 'Web gateway is offline.',
          createdAt: '2026-09-30T10:00:00.000Z',
          updatedAt: '2026-09-30T10:05:00.000Z',
        },
      ],
    });
    renderPage();

    expect(await screen.findByText('Échouée')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reprendre' })).toBeTruthy();
  });
});
