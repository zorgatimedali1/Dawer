import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EmailPage from '@/app/dashboard/email/page';

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const CUSTOMERS_WITH_EMAIL = [
  {
    id: 'cust-ada',
    first_name: 'Ada',
    last_name: 'Lovelace',
    email: 'ada@example.com',
    phone: '22345678',
    birthday: null,
    marketing_consent: 1,
    created_at: '2026-10-01T10:00:00.000Z',
    last_activity_at: null,
  },
  {
    id: 'cust-bob',
    first_name: 'Bob',
    last_name: 'Bobert',
    email: 'bob@example.com',
    phone: '22345679',
    birthday: null,
    marketing_consent: 1,
    created_at: '2026-10-01T10:00:00.000Z',
    last_activity_at: null,
  },
];

type StubOptions = {
  allowed?: boolean;
  configured?: boolean;
  sent?: number;
  history?: unknown[];
  customers?: unknown[];
  postStatus?: number;
  postError?: string;
  postCampaign?: { status?: 'PENDING' | 'COMPLETED' };
  assetUploadStatus?: number;
};

function stubFetch(options: StubOptions = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (method === 'POST' && url.startsWith('/api/email/asset')) {
      if (options.assetUploadStatus) {
        return jsonResponse({ success: false, error: 'Unsupported file type.' }, options.assetUploadStatus);
      }
      const sentBody = JSON.parse(String(init?.body ?? '{}')) as { name?: string; mimeType?: string };
      return jsonResponse(
        {
          success: true,
          asset: {
            id: 'asset-1',
            name: sentBody.name ?? 'promo.png',
            mime: sentBody.mimeType ?? 'image/png',
            url: '/api/email-assets/asset-1',
          },
        },
        201,
      );
    }

    if (url.startsWith('/api/email/status')) {
      const allowed = options.allowed ?? true;
      const monthlyLimit = allowed ? 1000 : 0;
      const batchLimit = allowed ? 200 : 0;
      const sent = options.sent ?? 0;
      return jsonResponse({
        success: true,
        status: {
          allowed,
          planSlug: allowed ? 'growth' : 'starter',
          planName: allowed ? 'Pro' : 'Starter',
          monthlyLimit,
          batchLimit,
          sentThisMonth: sent,
          remaining: Math.max(0, monthlyLimit - sent),
          configured: options.configured ?? true,
          quota: { dailyUsed: 0, dailyLimit: 300 },
        },
      });
    }

    if (method === 'POST' && url.startsWith('/api/email/broadcast')) {
      if (options.postStatus) {
        return jsonResponse({ success: false, error: options.postError ?? 'Request failed.' }, options.postStatus);
      }
      const sentBody = JSON.parse(String(init?.body ?? '{}')) as {
        recipients?: unknown[];
        subject?: string;
        asset?: { id: string };
      };
      const total = sentBody.recipients?.length ?? 0;
      const sent = options.sent ?? 0;
      const campaignStatus = options.postCampaign?.status ?? 'PENDING';
      return jsonResponse({
        success: true,
        campaign: {
          id: 'email-campaign-1',
          subject: sentBody.subject ?? '',
          senderName: 'Équipe Café Tej',
          assetName: sentBody.asset ? 'promo.png' : null,
          totalRecipients: total,
          sent: campaignStatus === 'COMPLETED' ? total : 0,
          failed: 0,
          status: campaignStatus,
          lastError: null,
          createdAt: '2026-10-01T10:00:00.000Z',
        },
        usage: { sentThisMonth: sent + total, monthlyLimit: 1000, remaining: 1000 - sent - total },
      });
    }

    if (url.startsWith('/api/email/broadcast')) {
      return jsonResponse({ success: true, campaigns: options.history ?? [] });
    }

    if (url.startsWith('/api/business/customers')) {
      const customers = options.customers ?? CUSTOMERS_WITH_EMAIL;
      return jsonResponse({ success: true, customers, total: customers.length, page: 1, limit: 100 });
    }

    return jsonResponse({ success: true });
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage() {
  render(
    <MemoryRouter>
      <EmailPage />
    </MemoryRouter>,
  );
}

async function selectDefaultCustomers() {
  await userEvent.click(await screen.findByRole('button', { name: /Ada Lovelace/ }));
  await userEvent.click(await screen.findByRole('button', { name: /Bob Bobert/ }));
}

async function fillCampaign() {
  await selectDefaultCustomers();
  fireEvent.change(screen.getByLabelText('Nom de l’expéditeur'), { target: { value: 'Équipe Café Tej' } });
  fireEvent.change(screen.getByLabelText('Objet'), { target: { value: 'Nouveautés de la semaine' } });
  fireEvent.change(screen.getByLabelText('Contenu de l’e-mail', { selector: 'textarea' }), {
    target: { value: '<p>Bonjour à tous</p>' },
  });
}

async function attachFile(file: File) {
  const input = (await screen.findByLabelText('Pièce jointe')) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

describe('Email marketing page', () => {
  beforeEach(() => {
    window.localStorage.setItem(
      'campaign-engage-auth',
      JSON.stringify({ token: 'email-test-token', user: { id: 'u1', email: 'owner@cafe-tej.test' } }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('shows the monthly email usage for the month', async () => {
    stubFetch({ sent: 180 });
    renderPage();

    expect(await screen.findByText('180 / 1000 e-mails utilisés ce mois-ci')).toBeTruthy();
    expect(screen.getByText('820 e-mails restants')).toBeTruthy();
    expect(screen.getByLabelText('Nom de l’expéditeur')).toBeTruthy();
  });

  it('locks Starter accounts behind the blurred upgrade card', async () => {
    stubFetch({ allowed: false });
    renderPage();

    expect(await screen.findByText('Passez au plan Pro pour débloquer les campagnes e-mail')).toBeTruthy();
    const upgrade = screen.getByRole('link', { name: 'Voir les plans' });
    expect(upgrade.getAttribute('href')).toBe('/dashboard/billing');
    expect((screen.getByLabelText('Nom de l’expéditeur') as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByText('820 e-mails restants')).toBeNull();
  });

  it('sends a campaign after the exact confirmation copy', async () => {
    const fetchMock = stubFetch();
    renderPage();

    await fillCampaign();
    await userEvent.click(await screen.findByRole('button', { name: 'Envoyer à 2 destinataires' }));

    expect(
      screen.getByText(
        'Vous êtes sur le point d’envoyer 2 e-mails. Cela consommera 2 de votre limite mensuelle restante.',
      ),
    ).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Envoyer' }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        (call) =>
          String((call as unknown as [RequestInfo, RequestInit])[0]).startsWith('/api/email/broadcast') &&
          ((call as unknown as [RequestInfo, RequestInit])[1]?.method ?? 'GET') === 'POST',
      );
      expect(post).toBeTruthy();
      const body = JSON.parse(String((post as unknown as [RequestInfo, RequestInit])[1]?.body));
      expect(body.senderName).toBe('Équipe Café Tej');
      expect(body.replyTo).toBe('owner@cafe-tej.test');
      expect(body.subject).toBe('Nouveautés de la semaine');
      expect(body.content).toBe('<p>Bonjour à tous</p>');
      expect(body.asset).toBeUndefined();
      expect(body.recipients).toEqual([
        { email: 'ada@example.com', name: 'Ada Lovelace' },
        { email: 'bob@example.com', name: 'Bob Bobert' },
      ]);
    });

    expect(await screen.findByText('Campagne en cours d’envoi')).toBeTruthy();

    expect(
      await screen.findByText(
        'La campagne de 2 e-mails est en cours d’envoi en arrière-plan. Suivez sa progression dans l’historique ci-dessous.',
      ),
    ).toBeTruthy();
    expect(await screen.findByText('998 e-mails restants ce mois-ci.')).toBeTruthy();
  }, 15_000);

  it('shows the final tally when the campaign came back already completed', async () => {
    stubFetch({ postCampaign: { status: 'COMPLETED' } });
    renderPage();

    await fillCampaign();
    await userEvent.click(await screen.findByRole('button', { name: 'Envoyer à 2 destinataires' }));
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer' }));

    expect(await screen.findByText('Campagne envoyée')).toBeTruthy();
    expect(await screen.findByText('2 sur 2 e-mails envoyés avec succès.')).toBeTruthy();
  }, 15_000);

  it('blocks a new broadcast while one is still queued', async () => {
    stubFetch({
      history: [
        {
          id: 'email-campaign-1',
          subject: 'Nouveautés de la semaine',
          senderName: 'Équipe Café Tej',
          assetName: null,
          totalRecipients: 2,
          sent: 0,
          failed: 0,
          status: 'PENDING',
          lastError: null,
          createdAt: '2026-10-01T10:00:00.000Z',
        },
      ],
    });
    renderPage();

    await fillCampaign();
    const sendButton = await screen.findByRole('button', { name: 'Envoyer à 2 destinataires' });
    expect((sendButton as HTMLButtonElement).disabled).toBe(true);
  }, 15_000);

  it('offers customers with an email as selectable recipients', async () => {
    stubFetch({
      customers: [
        {
          id: 'cust-1',
          first_name: 'Ada',
          last_name: 'Lovelace',
          email: 'ada@example.test',
          phone: '22345678',
          birthday: null,
          marketing_consent: 1,
          created_at: '2026-10-01T10:00:00.000Z',
          last_activity_at: null,
        },
        {
          id: 'cust-2',
          first_name: 'No',
          last_name: 'Email',
          email: null,
          phone: '22345679',
          birthday: null,
          marketing_consent: 0,
          created_at: '2026-10-01T10:00:00.000Z',
          last_activity_at: null,
        },
      ],
    });
    renderPage();

    const chip = await screen.findByRole('button', { name: /Ada Lovelace/ });
    expect(screen.queryByRole('button', { name: /No Email/ })).toBeNull();

    await userEvent.click(chip);
    expect(screen.getByText('1 destinataires sélectionnés')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Envoyer à 1 destinataires' })).toBeTruthy();

    await userEvent.click(chip);
    expect(screen.getByText('0 destinataires sélectionnés')).toBeTruthy();
  });

  it('surfaces the plan-limit copy from the API', async () => {
    stubFetch({
      postStatus: 403,
      postError: 'PRO plan allows 200 emails per broadcast.',
    });
    renderPage();

    await fillCampaign();
    await userEvent.click(await screen.findByRole('button', { name: 'Envoyer à 2 destinataires' }));

    expect(
      screen.getByText(
        'Vous êtes sur le point d’envoyer 2 e-mails. Cela consommera 2 de votre limite mensuelle restante.',
      ),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer' }));

    expect(await screen.findByText('Le plan PRO autorise 200 e-mails par diffusion.')).toBeTruthy();
  });

  it('shows the failure reason on a failed history row', async () => {
    stubFetch({
      history: [
        {
          id: 'email-campaign-2',
          subject: 'Test',
          senderName: 'Équipe Café Tej',
          assetName: null,
          totalRecipients: 1,
          sent: 0,
          failed: 1,
          status: 'FAILED',
          lastError: 'Daily sending limit reached.',
          createdAt: '2026-10-07T23:56:22.642Z',
        },
      ],
    });
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Erreur : Daily sending limit reached.');
  });

  it('uploads an attachment and sends its id with the broadcast', async () => {
    const fetchMock = stubFetch();
    renderPage();

    await fillCampaign();

    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await attachFile(new File([png], 'promo.png', { type: 'image/png' }));

    expect(await screen.findByText('promo.png')).toBeTruthy();

    await userEvent.click(await screen.findByRole('button', { name: 'Envoyer à 2 destinataires' }));
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer' }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        (call) =>
          String((call as unknown as [RequestInfo, RequestInit])[0]).startsWith('/api/email/broadcast') &&
          ((call as unknown as [RequestInfo, RequestInit])[1]?.method ?? 'GET') === 'POST',
      );
      expect(post).toBeTruthy();
      const body = JSON.parse(String((post as unknown as [RequestInfo, RequestInit])[1]?.body));
      expect(body.asset).toEqual({ id: 'asset-1' });
      expect(body.content).toBe('<p>Bonjour à tous</p>');
      expect(body.recipients).toHaveLength(2);
    });

    expect(await screen.findByText('Campagne en cours d’envoi')).toBeTruthy();
  }, 15_000);

  it('rejects an unsupported attachment before uploading it', async () => {
    const fetchMock = stubFetch();
    renderPage();

    await fillCampaign();
    await attachFile(new File(['<html></html>'], 'page.html', { type: 'text/html' }));

    expect(
      await screen.findByText('Fichier non pris en charge. Utilisez une image JPEG, PNG ou GIF, ou un PDF.'),
    ).toBeTruthy();
    expect(screen.queryByText('page.html')).toBeNull();
    expect(
      fetchMock.mock.calls.some(
        (call) => String((call as unknown as [RequestInfo, RequestInit])[0]).startsWith('/api/email/asset'),
      ),
    ).toBe(false);
  }, 15_000);
});
