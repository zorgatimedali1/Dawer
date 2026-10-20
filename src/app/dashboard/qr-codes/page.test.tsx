import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import QRCodesPage from '@/app/dashboard/qr-codes/page';
import { invalidateCachedResource } from '@/hooks/useCachedResource';
import { DashboardBillingProvider } from '@/contexts/billing-context';

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubFetch(
  { planSlug = 'growth', campaigns = [] }: { planSlug?: string; campaigns?: { id: string; name: string; status: string }[] } = {},
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url === '/api/billing') {
      return jsonResponse({
        success: true,
        plans: [],
        subscription: null,
        pendingRequest: null,
        usage: { campaigns: 1, customers: 0 },
        access: {
          state: 'active',
          canManage: true,
          startsAt: '2026-10-01T00:00:00.000Z',
          endsAt: '2027-01-01T00:00:00.000Z',
          plan: {
            id: `plan_${planSlug}`,
            name: 'Plan',
            slug: planSlug,
            priceCents: 14900,
            interval: '3_months',
            features: {
              limits: { campaigns: 4, customers: 200 },
              features: planSlug === 'starter'
                ? ['Accès complet à la roue']
                : ['Accès complet à la roue', 'Statistiques & analytics'],
            },
          },
        },
      });
    }

    if (url.startsWith('/api/business/qr-codes')) {
      return jsonResponse({
        success: true,
        qrCodes: [
          {
            id: 'qr-1',
            campaign_id: 'campaign-1',
            campaign_name: 'Coffee Spin',
            campaign_public_code: '3852F0D3267D',
            public_code: 'C4244DA64D58',
            name: 'Main Entrance',
            location: 'Counter',
            active: 1,
            created_at: '2026-01-01T00:00:00.000Z',
            campaign_participations: 12,
          },
        ],
      });
    }

    if (url.startsWith('/api/business/campaigns')) {
      return jsonResponse({ success: true, campaigns });
    }

    return jsonResponse({ success: true });
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('QR codes page', () => {
  let downloaded: { href: string; download: string } | null = null;

  beforeEach(() => {
    downloaded = null;
    invalidateCachedResource();
    window.localStorage.setItem('campaign-engage-auth', JSON.stringify({ token: 'qr-test-token' }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloaded = { href: this.href, download: this.download };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('previews each QR code as a generated PNG', async () => {
    stubFetch();
    render(
      <DashboardBillingProvider>
        <QRCodesPage />
      </DashboardBillingProvider>,
    );

    const qr = await screen.findByRole('img', { name: 'QR code pour Main Entrance' });
    expect(qr.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    expect(await screen.findByRole('button', { name: /télécharger le qr code de main entrance en png/i })).toBeEnabled();
    expect(screen.getByText('Main Entrance')).toBeTruthy();
  });

  it('downloads the QR code as a PNG file', async () => {
    stubFetch();
    render(
      <DashboardBillingProvider>
        <QRCodesPage />
      </DashboardBillingProvider>,
    );

    const button = await screen.findByRole('button', { name: /télécharger le qr code/i });
    // The button is disabled until the async QRCode.toDataURL() resolves;
    // clicking before that is a no-op. Wait for the enabled state instead of
    // racing the promise (CI parallel load made the race visible).
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);

    expect(downloaded).not.toBeNull();
    expect(downloaded?.download).toBe('main-entrance-qr-code.png');
    expect(downloaded?.href).toMatch(/^data:image\/png;base64,/);
  });

  it('hides the campaign participation count on the Starter plan', async () => {
    stubFetch({ planSlug: 'starter' });
    render(
      <DashboardBillingProvider>
        <QRCodesPage />
      </DashboardBillingProvider>,
    );

    await screen.findByText('Main Entrance');
    await waitFor(() => {
      expect(screen.queryByText('12')).toBeNull();
      expect(screen.queryByText('participants à la campagne')).toBeNull();
    });
  });

  it('shows the campaign participation count for an analytics plan', async () => {
    stubFetch({ planSlug: 'growth' });
    render(
      <DashboardBillingProvider>
        <QRCodesPage />
      </DashboardBillingProvider>,
    );

    expect(await screen.findByText('12')).toBeInTheDocument();
    expect(screen.getByText('participants à la campagne')).toBeInTheDocument();
  });

  it('excludes archived campaigns from the create-form campaign list', async () => {
    stubFetch({
      campaigns: [
        { id: 'campaign-archived', name: 'Old Campagne', status: 'ARCHIVED' },
        { id: 'campaign-live', name: 'Live Campagne', status: 'ACTIVE' },
      ],
    });
    render(
      <DashboardBillingProvider>
        <QRCodesPage />
      </DashboardBillingProvider>,
    );

    await screen.findByText('Main Entrance');
    await userEvent.click(screen.getByRole('button', { name: /créer un qr code/i }));

    const select = (await screen.findByLabelText('Campagne')) as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      'Sélectionner une campagne',
      'Live Campagne',
    ]);
  });
});
