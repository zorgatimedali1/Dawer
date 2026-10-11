import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import QRCodesPage from '@/app/dashboard/qr-codes/page';

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

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
      return jsonResponse({ success: true, campaigns: [] });
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
    render(<QRCodesPage />);

    const qr = await screen.findByRole('img', { name: 'QR code pour Main Entrance' });
    expect(qr.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    expect(await screen.findByRole('button', { name: /télécharger le qr code de main entrance en png/i })).toBeEnabled();
    expect(screen.getByText('Main Entrance')).toBeTruthy();
  });

  it('downloads the QR code as a PNG file', async () => {
    stubFetch();
    render(<QRCodesPage />);

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
});
