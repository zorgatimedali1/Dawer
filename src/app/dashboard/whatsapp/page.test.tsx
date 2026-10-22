import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WhatsAppPage from '@/app/dashboard/whatsapp/page';
import { seededShuffle } from '@/lib/shuffle';

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type StubOptions = {
  allowed?: boolean;
  configured?: boolean;
  sent?: number;
  batchLimit?: number;
  templates?: unknown[];
  customers?: unknown[];
  broadcasts?: unknown[];
  postStatus?: number;
  postError?: string;
  finalCampaign?: Record<string, unknown>;
};

function stubFetch(options: StubOptions = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (url.startsWith('/api/whatsapp/status')) {
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
          configured: options.configured ?? true,
        },
      });
    }

    if (url.startsWith('/api/whatsapp/templates')) {
      return jsonResponse({
        success: true,
        templates: options.templates ?? [{ name: 'promo_announcement', language: 'fr', status: 'APPROVED' }],
      });
    }

    if (method === 'POST' && url.startsWith('/api/whatsapp/broadcast')) {
      if (options.postStatus) {
        return jsonResponse({ success: false, error: options.postError ?? 'Request failed.' }, options.postStatus);
      }
      return jsonResponse(
        {
          success: true,
          campaign: {
            id: 'campaign-1',
            templateName: 'promo_announcement',
            language: 'fr',
            totalRecipients: 2,
            status: 'PENDING',
            createdAt: '2026-10-01T10:00:00.000Z',
          },
        },
        202,
      );
    }

    if (url.startsWith('/api/whatsapp/broadcast/campaign-1')) {
      return jsonResponse({
        success: true,
        campaign: options.finalCampaign ?? {
          id: 'campaign-1',
          templateName: 'promo_announcement',
          language: 'fr',
          totalRecipients: 2,
          sent: 2,
          failed: 0,
          status: 'COMPLETED',
          lastError: null,
          createdAt: '2026-10-01T10:00:00.000Z',
          updatedAt: '2026-10-01T10:01:00.000Z',
        },
      });
    }

    if (url.startsWith('/api/whatsapp/broadcast')) {
      return jsonResponse({ success: true, campaigns: options.broadcasts ?? [] });
    }

    if (url.startsWith('/api/business/customers')) {
      return jsonResponse({ success: true, customers: options.customers ?? [], total: 0, page: 1, limit: 50 });
    }

    if (url.startsWith('/api/whatsapp-web/status')) {
      return jsonResponse({
        success: true,
        status: {
          allowed: true,
          planSlug: 'growth',
          planName: 'Pro',
          monthlyLimit: 200,
          batchLimit: 100,
          sentThisMonth: 0,
          remaining: 200,
          gateway: { configured: true, reachable: true, state: 'READY' },
        },
      });
    }

    if (url.startsWith('/api/whatsapp-web/winners')) {
      return jsonResponse({ success: true, winners: [] });
    }

    if (url.startsWith('/api/whatsapp-web/broadcast')) {
      return jsonResponse({ success: true, campaigns: [] });
    }

    return jsonResponse({ success: true });
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage() {
  render(
    <MemoryRouter>
      <WhatsAppPage />
    </MemoryRouter>,
  );
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="loc">{location.search}</span>;
}

describe('WhatsApp broadcast page', () => {
  beforeEach(() => {
    window.localStorage.setItem('campaign-engage-auth', JSON.stringify({ token: 'wa-test-token' }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('shows the Pro usage for the month', async () => {
    stubFetch({ sent: 10 });
    renderPage();

    expect(await screen.findByText('10 / 200 messages utilisés')).toBeTruthy();
    expect(screen.getByText('190 restants')).toBeTruthy();
    expect(screen.getByLabelText('Modèle approuvé')).toBeTruthy();
  });

  it('starts on the Meta Cloud API tab and switches to WhatsApp Web with the URL in sync', async () => {
    stubFetch();
    render(
      <MemoryRouter initialEntries={['/dashboard/whatsapp']}>
        <WhatsAppPage />
        <LocationProbe />
      </MemoryRouter>,
    );

    const cloudTab = await screen.findByRole('tab', { name: 'Meta Cloud API' });
    expect(cloudTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('loc').textContent).toBe('');

    const webTab = screen.getByRole('tab', { name: 'WhatsApp Web' });
    await userEvent.click(webTab);

    expect(webTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('loc').textContent).toBe('?tab=web');
    expect(screen.queryByLabelText('Modèle approuvé')).toBeNull();
  });

  it('locks Starter accounts behind the billing page', async () => {
    stubFetch({ allowed: false });
    renderPage();

    expect(await screen.findByText('Diffusion réservée aux plans Pro et Business')).toBeTruthy();
    const upgrade = screen.getByRole('link', { name: 'Voir les plans' });
    expect(upgrade.getAttribute('href')).toBe('/dashboard/billing');
    expect(screen.queryByText('Destinataires')).toBeNull();
  });

  // Types 25 keystrokes, walks the confirmation dialog and waits for the send
  // to finish — comfortably over 5s on a loaded machine, so give it headroom.
  it('sends a broadcast after the exact confirmation copy', { timeout: 15_000 }, async () => {
    const fetchMock = stubFetch();
    renderPage();

    const textarea = await screen.findByLabelText('Numéros, un par ligne (Nom, numéro)');
    await userEvent.type(textarea, 'Ada, 22345678{enter}22345679');

    await userEvent.selectOptions(screen.getByLabelText('Modèle approuvé'), 'promo_announcement');
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer à 2 contacts' }));

    expect(
      screen.getByText(
        'Vous êtes sur le point d’envoyer 2 messages. Cela utilisera 2 de votre limite restante. Envoi estimé : moins d’une minute.',
      ),
    ).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Envoyer' }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        (call) =>
          String((call as unknown as [RequestInfo, RequestInit])[0]).startsWith('/api/whatsapp/broadcast') &&
          ((call as unknown as [RequestInfo, RequestInit])[1]?.method ?? 'GET') === 'POST',
      );
      expect(post).toBeTruthy();
      const body = JSON.parse(String((post as unknown as [RequestInfo, RequestInit])[1]?.body));
      expect(body.templateName).toBe('promo_announcement');
      expect(body.language).toBe('fr');
      expect(body.pace).toBe('standard');
      expect(body.recipients).toEqual([
        { name: 'Ada', phone: '22345678' },
        { phone: '22345679' },
      ]);
    });

    expect(await screen.findByText('Diffusion en cours')).toBeTruthy();
    expect(await screen.findByText('Terminée', undefined, { timeout: 5000 })).toBeTruthy();
    expect(await screen.findByText('2 sur 2 envoyés')).toBeTruthy();
  });

  it('surfaces the plan-limit copy from the API', async () => {
    stubFetch({
      postStatus: 403,
      postError: 'PRO plan limit reached. Upgrade to Business for 1000 messages',
    });
    renderPage();

    const textarea = await screen.findByLabelText('Numéros, un par ligne (Nom, numéro)');
    await userEvent.type(textarea, '22345678');
    await userEvent.selectOptions(screen.getByLabelText('Modèle approuvé'), 'promo_announcement');
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer à 1 contacts' }));

    expect(
      screen.getByText(
        'Vous êtes sur le point d’envoyer 1 messages. Cela utilisera 1 de votre limite restante. Envoi estimé : moins d’une minute.',
      ),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer' }));

    expect(
      await screen.findByText('Limite du plan PRO atteinte. Passez au plan Business pour 1000 messages.'),
    ).toBeTruthy();
  });

  it('previews the template body with the variables filled in', async () => {
    stubFetch({
      templates: [
        {
          name: 'promo_announcement',
          language: 'fr',
          status: 'APPROVED',
          body: 'Félicitations {{1}} ! Votre code : {{2}}',
        },
      ],
    });
    renderPage();

    const textarea = await screen.findByLabelText('Numéros, un par ligne (Nom, numéro)');
    fireEvent.change(textarea, { target: { value: '22345678' } });

    expect(screen.getByText('Choisissez un modèle pour voir le message qui sera envoyé.')).toBeTruthy();

    await userEvent.selectOptions(screen.getByLabelText('Modèle approuvé'), 'promo_announcement');
    expect(screen.getByTestId('wa-preview').textContent).toBe('Félicitations {{1}} ! Votre code : {{2}}');

    await userEvent.type(screen.getByLabelText('Variable 1'), 'Ada');
    expect(screen.getByTestId('wa-preview').textContent).toBe('Félicitations Ada ! Votre code : {{2}}');
  });

  it('shuffles the recipient order before sending', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(12_345);
    const fetchMock = stubFetch();
    renderPage();

    const textarea = await screen.findByLabelText('Numéros, un par ligne (Nom, numéro)');
    fireEvent.change(textarea, {
      target: { value: 'Ada, 22345678\nBob, 22345679\nCid, 22345680\nDee, 22345681' },
    });
    await userEvent.selectOptions(screen.getByLabelText('Modèle approuvé'), 'promo_announcement');

    await userEvent.click(screen.getByRole('button', { name: 'Mélanger' }));
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer à 4 contacts' }));
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer' }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        (call) =>
          String((call as unknown as [RequestInfo, RequestInit])[0]).startsWith('/api/whatsapp/broadcast') &&
          ((call as unknown as [RequestInfo, RequestInit])[1]?.method ?? 'GET') === 'POST',
      );
      expect(post).toBeTruthy();
      const body = JSON.parse(String((post as unknown as [RequestInfo, RequestInit])[1]?.body));
      const original = [
        { name: 'Ada', phone: '22345678' },
        { name: 'Bob', phone: '22345679' },
        { name: 'Cid', phone: '22345680' },
        { name: 'Dee', phone: '22345681' },
      ];
      expect(body.recipients).toEqual(seededShuffle(original, 12_345));
      expect(body.recipients).not.toEqual(original);
    });
  });

  it('posts the selected pace and shows the send estimate', async () => {
    const fetchMock = stubFetch();
    renderPage();

    const textarea = await screen.findByLabelText('Numéros, un par ligne (Nom, numéro)');
    fireEvent.change(textarea, { target: { value: '22345678\n22345679' } });
    await userEvent.selectOptions(screen.getByLabelText('Modèle approuvé'), 'promo_announcement');

    expect(screen.getByTestId('wa-estimate').textContent).toBe('Envoi estimé : moins d’une minute.');

    await userEvent.selectOptions(screen.getByLabelText('Rythme d’envoi'), 'relaxed');
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer à 2 contacts' }));
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer' }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        (call) =>
          String((call as unknown as [RequestInfo, RequestInit])[0]).startsWith('/api/whatsapp/broadcast') &&
          ((call as unknown as [RequestInfo, RequestInit])[1]?.method ?? 'GET') === 'POST',
      );
      expect(post).toBeTruthy();
      const body = JSON.parse(String((post as unknown as [RequestInfo, RequestInit])[1]?.body));
      expect(body.pace).toBe('relaxed');
    });
  });

  it('caps the customer select-all at the per-broadcast batch limit', async () => {
    stubFetch({
      batchLimit: 2,
      customers: [
        { id: 'cust-1', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.test', phone: '22345671', birthday: null, marketing_consent: 1, created_at: '2026-10-01T10:00:00.000Z', last_activity_at: null },
        { id: 'cust-2', first_name: 'Bob', last_name: 'Bobert', email: 'bob@example.test', phone: '22345672', birthday: null, marketing_consent: 1, created_at: '2026-10-01T10:00:00.000Z', last_activity_at: null },
        { id: 'cust-3', first_name: 'Cid', last_name: 'Cassia', email: 'cid@example.test', phone: '22345673', birthday: null, marketing_consent: 1, created_at: '2026-10-01T10:00:00.000Z', last_activity_at: null },
      ],
    });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Tout sélectionner' }));

    // 3 customers, batch limit 2 → a random pair is picked and can be sent.
    expect(await screen.findByText('2 sélectionnés au hasard — votre plan autorise 2 destinataires par diffusion.')).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText('Modèle approuvé'), 'promo_announcement');
    expect(screen.getByRole('button', { name: 'Envoyer à 2 contacts' }).hasAttribute('disabled')).toBe(false);
  });

  it('blocks sending above the per-broadcast batch limit', async () => {
    stubFetch({ batchLimit: 100 });
    renderPage();

    const textarea = await screen.findByLabelText('Numéros, un par ligne (Nom, numéro)');
    fireEvent.change(textarea, { target: { value: Array.from({ length: 101 }, (_, i) => `2234${String(5600 + i)}`).join('\n') } });
    await userEvent.selectOptions(screen.getByLabelText('Modèle approuvé'), 'promo_announcement');

    expect(await screen.findByText('Le plan PRO autorise 100 destinataires par diffusion.')).toBeTruthy();    expect(screen.getByRole('button', { name: 'Envoyer à 101 contacts' }).hasAttribute('disabled')).toBe(true);
  });
});
