import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PosterEditorPage from '@/app/dashboard/poster/page';
import { LanguageSwitcher } from '@/components/language-switcher';
import { AppProvider } from '@/contexts/app-context';

const AUTH_KEY = 'campaign-engage-auth';

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function campaignPayload() {
  return {
    success: true,
    campaigns: [{
      id: 'campaign-1',
      name: 'Blue Bottle Coffee',
      description: '',
      public_code: 'PUBLIC123',
      status: 'ACTIVE',
      start_at: null,
      end_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    }],
  };
}

function rect(partial: Partial<DOMRect> & { width: number; height: number }): DOMRect {
  return {
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
    ...partial,
  };
}

describe('Poster editor', () => {
  beforeEach(() => {
    window.localStorage.setItem(AUTH_KEY, JSON.stringify({ token: 'poster-test-token' }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('generates a scannable campaign QR and saves editable poster copy', async () => {
    let savedPoster: Record<string, unknown> | null = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/business/campaigns')) {
        return jsonResponse({
          success: true,
          campaigns: [{
            id: 'campaign-1',
            name: 'Blue Bottle Coffee',
            description: '',
            public_code: 'PUBLIC123',
            status: 'ACTIVE',
            start_at: null,
            end_at: null,
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          }],
        });
      }
      if (url.startsWith('/api/business/posters') && init?.method === 'POST') {
        const inputBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        savedPoster = {
          id: 'poster-1',
          campaign_id: 'campaign-1',
          campaign_name: 'Blue Bottle Coffee',
          template: 'gradient',
          title: inputBody.title,
          subtitle: inputBody.subtitle,
          theme: '#24558f',
          configuration: JSON.stringify(inputBody.configuration),
          updated_at: '2026-01-01T00:00:00.000Z',
        };
        return jsonResponse({ success: true, poster: savedPoster }, 201);
      }
      if (url.startsWith('/api/business/posters')) {
        return jsonResponse({ success: true, posters: savedPoster ? [savedPoster] : [] });
      }
      return jsonResponse({ success: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<PosterEditorPage />);

    const qr = await screen.findByRole('img', { name: /qr code de la campagne blue bottle coffee/i }, { timeout: 5000 });
    expect(qr.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    expect(await screen.findByText('Scannez le QR code')).toBeTruthy();
    expect(screen.getByText(/impression sans bandes/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /télécharger svg/i })).toBeNull();

    await userEvent.clear(screen.getByLabelText('Marque'));
    await userEvent.type(screen.getByLabelText('Marque'), 'Roulii');
    await userEvent.clear(screen.getByLabelText('Étape 2'));
    await userEvent.type(screen.getByLabelText('Étape 2'), 'Donnez votre avis Google');
    await userEvent.click(screen.getByRole('button', { name: /enregistrer l’affiche/i }));

    await screen.findByText('Affiche enregistrée.');
    await waitFor(() => {
      const saveCall = fetchMock.mock.calls.find(([input, init]) =>
        String(input).startsWith('/api/business/posters') && init?.method === 'POST',
      );
      expect(saveCall).toBeTruthy();
      const saved = JSON.parse(String(saveCall?.[1]?.body)) as { configuration: Record<string, unknown>; theme?: unknown; template?: unknown };
      expect(saved.configuration).toMatchObject({
        brandName: 'Roulii',
        steps: ['Scannez le QR code', 'Donnez votre avis Google', 'Tournez la roue et gagnez !'],
      });
      expect(saved.theme).toBeUndefined();
      expect(saved.template).toBeUndefined();
    });
  });

  it('renders the Dawer logo and repositions elements in move mode', async () => {
    let savedConfiguration: Record<string, unknown> | null = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/business/campaigns')) return jsonResponse(campaignPayload());
      if (url.startsWith('/api/business/posters') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { configuration: Record<string, unknown> };
        savedConfiguration = body.configuration;
        return jsonResponse({
          success: true,
          poster: {
            id: 'poster-1',
            campaign_id: 'campaign-1',
            campaign_name: 'Blue Bottle Coffee',
            template: 'gradient',
            title: 't',
            subtitle: 's',
            theme: '#24558f',
            configuration: JSON.stringify(body.configuration),
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        }, 201);
      }
      return jsonResponse({ success: true, posters: [] });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<PosterEditorPage />);

    const logo = await screen.findByAltText(/logo dawer/i);
    expect(logo.getAttribute('src')).toBeTruthy();
    expect(logo.closest('[data-testid="poster-logo"]')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Déplacer' }));
    await screen.findByText(/glissez les éléments/i);

    const preview = screen.getByTestId('poster-preview');
    preview.getBoundingClientRect = () => rect({ width: 400, height: 560, right: 400, bottom: 560 });
    const title = screen.getByTestId('poster-title');
    title.getBoundingClientRect = () => rect({ left: 40, top: 120, width: 320, height: 50, right: 360, bottom: 170 });

    fireEvent.pointerDown(title, { pointerId: 1, clientX: 100, clientY: 200 });
    fireEvent.pointerMove(title, { pointerId: 1, clientX: 140, clientY: 260 });
    fireEvent.pointerUp(title, { pointerId: 1, clientX: 140, clientY: 260 });

    expect(title.style.transform).toBe('translate(10cqw, 15cqw) scale(1)');

    await userEvent.click(screen.getByRole('button', { name: /enregistrer l’affiche/i }));
    await screen.findByText('Affiche enregistrée.');
    await waitFor(() => {
      expect(savedConfiguration).toMatchObject({
        positions: { title: { x: 10, y: 15 } },
      });
    });

    await userEvent.click(screen.getByRole('button', { name: /réinitialiser les positions/i }));
    expect(title.style.transform).toBe('translate(0cqw, 0cqw) scale(1)');
  });

  it('applies saved positions on load', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/business/campaigns')) return jsonResponse(campaignPayload());
      if (url.startsWith('/api/business/posters')) {
        return jsonResponse({
          success: true,
          posters: [{
            id: 'poster-1',
            campaign_id: 'campaign-1',
            campaign_name: 'Blue Bottle Coffee',
            template: 'gradient',
            title: 'Poster title',
            subtitle: 'Poster subtitle',
            theme: '#24558f',
            configuration: JSON.stringify({
              brandName: 'Blue Bottle Coffee',
              steps: ['a', 'b', 'c'],
              qrCaption: 'scan',
              positions: { title: { x: 5, y: 6 }, logo: { x: -2, y: 3 } },
              scale: 1.2,
            }),
            updated_at: '2026-01-01T00:00:00.000Z',
          }],
        });
      }
      return jsonResponse({ success: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<PosterEditorPage />);

    const title = await screen.findByText(/poster title/i);
    await waitFor(() => {
      expect(title.style.transform).toBe('translate(5cqw, 6cqw) scale(1.2)');
    });
  });

  it('resizes all poster elements globally and persists the scale', async () => {
    let savedConfiguration: Record<string, unknown> | null = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/business/campaigns')) return jsonResponse(campaignPayload());
      if (url.startsWith('/api/business/posters') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { configuration: Record<string, unknown> };
        savedConfiguration = body.configuration;
        return jsonResponse({
          success: true,
          poster: {
            id: 'poster-1',
            campaign_id: 'campaign-1',
            campaign_name: 'Blue Bottle Coffee',
            template: 'gradient',
            title: 't',
            subtitle: 's',
            theme: '#24558f',
            configuration: JSON.stringify(body.configuration),
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        }, 201);
      }
      return jsonResponse({ success: true, posters: [] });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<PosterEditorPage />);

    const title = await screen.findByTestId('poster-title');
    expect(title.style.transform).toBe('translate(0cqw, 0cqw) scale(1)');

    const grow = screen.getByRole('button', { name: /agrandir la taille des éléments/i });
    const shrink = screen.getByRole('button', { name: /réduire la taille des éléments/i });

    await userEvent.click(grow);
    expect(title.style.transform).toContain('scale(1.1)');
    expect(screen.getByTestId('poster-logo').style.transform).toContain('scale(1.1)');
    expect(screen.getByText('110%')).toBeTruthy();

    await userEvent.click(grow);
    expect(title.style.transform).toContain('scale(1.2)');

    await userEvent.click(shrink);
    expect(title.style.transform).toContain('scale(1.1)');

    await userEvent.click(screen.getByRole('button', { name: /enregistrer l’affiche/i }));
    await screen.findByText('Affiche enregistrée.');
    await waitFor(() => {
      expect(savedConfiguration).toMatchObject({ scale: 1.1 });
    });
  });

  it('resizes individual poster elements after selecting them', async () => {
    let savedConfiguration: Record<string, unknown> | null = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/business/campaigns')) return jsonResponse(campaignPayload());
      if (url.startsWith('/api/business/posters') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { configuration: Record<string, unknown> };
        savedConfiguration = body.configuration;
        return jsonResponse({
          success: true,
          poster: {
            id: 'poster-1',
            campaign_id: 'campaign-1',
            campaign_name: 'Blue Bottle Coffee',
            template: 'gradient',
            title: 't',
            subtitle: 's',
            theme: '#24558f',
            configuration: JSON.stringify(body.configuration),
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        }, 201);
      }
      return jsonResponse({ success: true, posters: [] });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<PosterEditorPage />);

    await screen.findByTestId('poster-title');

    await userEvent.click(screen.getByRole('button', { name: 'Déplacer' }));
    await screen.findByText(/glissez les éléments/i);

    const preview = screen.getByTestId('poster-preview');
    preview.getBoundingClientRect = () => rect({ width: 400, height: 560, right: 400, bottom: 560 });
    const title = screen.getByTestId('poster-title');
    title.getBoundingClientRect = () => rect({ left: 40, top: 120, width: 320, height: 50, right: 360, bottom: 170 });

    fireEvent.pointerDown(title, { pointerId: 1, clientX: 100, clientY: 200 });
    fireEvent.pointerUp(title, { pointerId: 1, clientX: 100, clientY: 200 });

    await userEvent.click(await screen.findByRole('button', { name: /agrandir : titre/i }));
    expect(title.style.transform).toContain('scale(1.1)');
    const stepsList = preview.querySelector('ol') as HTMLElement;
    expect(stepsList.style.transform).toContain('scale(1)');
    expect(screen.queryByText('120%')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /agrandir : titre/i }));
    expect(title.style.transform).toContain('scale(1.2)');
    expect(screen.getByText('120%')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /enregistrer l’affiche/i }));
    await screen.findByText('Affiche enregistrée.');
    await waitFor(() => {
      expect(savedConfiguration).toMatchObject({ elementScales: { title: 1.2 } });
    });
  });

  it('switches the default poster copy between French and English', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/business/campaigns')) return jsonResponse(campaignPayload());
      if (url.startsWith('/api/business/posters')) return jsonResponse({ success: true, posters: [] });
      return jsonResponse({ success: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AppProvider>
        <LanguageSwitcher />
        <PosterEditorPage />
      </AppProvider>,
    );

    const previewTitle = await screen.findByTestId('poster-title');
    expect(previewTitle.textContent).toBe('Votre avis compte pour nous');
    expect((screen.getByLabelText('Titre') as HTMLInputElement).value).toBe('Votre avis compte pour nous');
    expect(screen.getByText('Scannez le QR code')).toBeTruthy();

    await userEvent.click(screen.getByRole('radio', { name: 'EN' }));
    expect(previewTitle.textContent).toBe('Your opinion matters to us');
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Your opinion matters to us');
    expect(screen.getByText('Scan the QR code')).toBeTruthy();
    expect(screen.getByText('Scan to enter')).toBeTruthy();

    await userEvent.click(screen.getByRole('radio', { name: 'FR' }));
    expect(previewTitle.textContent).toBe('Votre avis compte pour nous');
    expect(screen.getByText('Scannez le QR code')).toBeTruthy();
  });
});