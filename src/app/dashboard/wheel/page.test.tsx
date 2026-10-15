import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import WheelConfigPage from '@/app/dashboard/wheel/page';
import { DEFAULT_WHEEL_THEME } from '@/lib/wheel-theme';

// jsdom has no createImageBitmap/canvas pipeline; the real optimizer can't
// decode the fake PNG fixtures, so pass files through untouched.
vi.mock('@/lib/optimize-image', () => ({
  MAX_LOGO_BYTES: 512 * 1024,
  optimizeImage: (file: File) => Promise.resolve(file),
  prepareLogoUpload: (file: File) => Promise.resolve(file),
}));

const AUTH_KEY = 'campaign-engage-auth';

function renderPage() {
  return render(
    <MemoryRouter>
      <WheelConfigPage />
    </MemoryRouter>,
  );
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const loadedCampaign = {
  id: 'c1',
  name: 'Loaded',
  description: '',
  public_code: 'ABCDEF012345',
  require_action: 'NONE',
};

function stubConfigFetch(payload: Record<string, unknown>) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    jsonResponse({ success: true, ...payload }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('wheel configuration page', () => {
  beforeEach(() => {
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

  it('wires the save button to the campaign-config PUT request', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();

      if (method === 'GET' && url === '/api/settings/wheel-theme') {
        return jsonResponse({
          success: true,
          designAllowed: true,
          centerLogoAllowed: true,
          planSlug: 'scale',
          planName: 'Business',
          theme: null,
          override: null,
          effective: DEFAULT_WHEEL_THEME,
          centerLogo: '/api/public/businesses/b1/wheel-logo',
        });
      }

      if (method === 'GET') {
        return new Response(JSON.stringify({ success: true, campaign: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      expect(url).toBe('/api/business/campaign-config');
      expect(method).toBe('PUT');
      // Cookie-authenticated: no bearer header, credentials included.
      expect((init?.headers as Record<string, string> | undefined)?.authorization).toBeUndefined();
      expect(init?.credentials).toBe('same-origin');

      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({ title: 'Tentez votre chance 🎉' });

      return new Response(JSON.stringify({ success: true, campaign: { id: 'c1', publicCode: 'ABCDEF012345' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    renderPage();

    const saveButton = await screen.findByRole('button', { name: /enregistrer la configuration/i });
    expect(saveButton).toBeEnabled();

    await userEvent.click(saveButton);

    // settings GET + wheel-theme GET + config GET + config PUT.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    await screen.findByText(/configuration enregistrée/i);
  });

  it('shows a skeleton instead of the demo defaults while the config is loading', async () => {
    let releaseConfig: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      releaseConfig = resolve;
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/settings/wheel-theme') {
          return jsonResponse({
            success: true,
            designAllowed: true,
            centerLogoAllowed: true,
            planSlug: 'scale',
            planName: 'Business',
            theme: null,
            override: null,
            effective: DEFAULT_WHEEL_THEME,
            centerLogo: null,
          });
        }
        await pending;
        return jsonResponse({ success: true, campaign: null });
      }),
    );

    renderPage();

    // Nothing of the demo config may leak while the fetch is in flight:
    // no sample rewards, no default title, no preview wheel.
    await screen.findByRole('status');
    expect(screen.queryByLabelText(/^probabilité de /i)).toBeNull();
    expect(screen.queryByTestId('preview-wheel')).toBeNull();
    expect(screen.queryByDisplayValue('Tentez votre chance 🎉')).toBeNull();

    await act(async () => {
      releaseConfig?.();
    });

    // Once the load settles the demo defaults apply as before (new campaign).
    const wheel = await screen.findByTestId('preview-wheel');
    expect(wheel.querySelectorAll('[data-wheel-segment]')).toHaveLength(6);
    expect(screen.getByDisplayValue('Tentez votre chance 🎉')).toBeTruthy();
  });

  function stubIntegrationsFetch(options: {
    campaign: Record<string, unknown> | null;
    integrations?: Partial<{
      googleMapsName: string;
      googleMapsUrl: string;
      googlePlaceId: string;
      facebookUrl: string;
      instagramUrl: string;
    }>;
  }) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === '/api/settings/wheel-theme') {
        return jsonResponse({
          success: true,
          designAllowed: true,
          centerLogoAllowed: true,
          planSlug: 'scale',
          planName: 'Business',
          theme: null,
          override: null,
          effective: DEFAULT_WHEEL_THEME,
          centerLogo: null,
        });
      }

      if (url === '/api/settings') {
        return jsonResponse({
          success: true,
          settings: {
            logo: '',
            googleMapsName: '',
            googleMapsUrl: '',
            googlePlaceId: '',
            facebookUrl: '',
            instagramUrl: '',
            ...options.integrations,
          },
        });
      }

      return jsonResponse({ success: true, campaign: options.campaign, rewards: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('prefills the social links from integrations when the wheel is new', async () => {
    stubIntegrationsFetch({
      campaign: null,
      integrations: {
        googleMapsName: 'Beachside Cafe',
        googleMapsUrl: 'https://maps.google.com/?cid=abc',
        googlePlaceId: 'ChIJabc123',
        facebookUrl: 'https://facebook.com/beachside',
        instagramUrl: 'https://instagram.com/beachside',
      },
    });

    renderPage();

    expect((await screen.findByLabelText('Google Maps / Google Business') as HTMLInputElement).value).toBe('Beachside Cafe');
    expect(((screen.getByLabelText('URL de la page Facebook')) as HTMLInputElement).value).toBe('https://facebook.com/beachside');
    expect(((screen.getByLabelText('URL du profil Instagram')) as HTMLInputElement).value).toBe('https://instagram.com/beachside');
  });

  it('falls back to integrations for an existing campaign with empty social fields', async () => {
    stubIntegrationsFetch({
      campaign: loadedCampaign,
      integrations: {
        facebookUrl: 'https://facebook.com/beachside',
        instagramUrl: 'https://instagram.com/beachside',
      },
    });

    renderPage();

    // The loaded campaign's own (empty) social fields yield to the saved
    // integrations, so a campaign born from the modal is not blank.
    expect((await screen.findByLabelText('URL de la page Facebook') as HTMLInputElement).value).toBe('https://facebook.com/beachside');
    expect(((screen.getByLabelText('URL du profil Instagram')) as HTMLInputElement).value).toBe('https://instagram.com/beachside');
  });

  it('renders the preview wheel exactly like the public one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ success: true, campaign: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    renderPage();

    const wheel = await screen.findByTestId('preview-wheel');
    const labels = wheel.querySelectorAll('[data-wheel-segment]');
    expect(labels).toHaveLength(6);
    expect(wheel.textContent).toContain('Café offert');
    expect(wheel.textContent).toContain('Retentez votre chance');
    expect(wheel.getAttribute('style')).toContain('conic-gradient');

    // Same label geometry as the public wheel: rotated, sized in container units.
    const first = labels[0] as HTMLElement;
    expect(first.getAttribute('style')).toContain('cqw');
    expect(first.className).toContain('drop-shadow');
    expect(first.getAttribute('title')).toBe('Prochaine visite');
  });

  it('turns the preview wheel from the public spin button', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ success: true, campaign: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    renderPage();

    const pill = await screen.findByRole('button', { name: /simuler un tirage/i });
    expect(pill).toBeEnabled();
    await userEvent.click(pill);

    expect((await screen.findAllByText(/la roue tourne/i)).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /la roue tourne/i })).toBeDisabled();
  });

  it('blocks saving for an already-invalid campaign and allows rebalancing it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({
          success: true,
          campaign: {
            id: 'c1',
            name: 'Over limit',
            description: '',
            public_code: 'ABCDEF012345',
            require_action: 'NONE',
          },
          rewards: [
            { id: 'r1', name: 'Legacy reward', type: 'custom_reward', weight: 117, active: 1 },
          ],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    renderPage();

    const saveButton = await screen.findByRole('button', { name: /enregistrer la configuration/i });
    await waitFor(() => expect(saveButton).toBeDisabled());
    expect(screen.getByText('Total: 117%')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /répartir les probabilités à 100 %/i }));

    await waitFor(() => {
      expect(screen.getByText('Total: 100%')).toBeTruthy();
      expect(saveButton).toBeEnabled();
    });
  });

  it('caps entered probability at the remaining total and adds new rewards within the budget', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ success: true, campaign: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    renderPage();

    await screen.findByRole('button', { name: /enregistrer la configuration/i });
    const firstProbability = screen.getByLabelText('Probabilité de Prochaine visite') as HTMLInputElement;
    fireEvent.change(firstProbability, { target: { value: '150' } });

    expect(firstProbability.value).toBe('20');
    expect(screen.getByText('Total: 100%')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /ajouter une récompense/i }));
    const addedProbability = screen.getByLabelText('Probabilité de Nouveau bonus 8') as HTMLInputElement;
    expect(addedProbability.value).toBe('0');
    expect(screen.getByText('Total: 100%')).toBeTruthy();
  });

  it('shows the percentage number in every reward row and on every wheel slice', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ success: true, campaign: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    renderPage();

    await screen.findByRole('button', { name: /enregistrer la configuration/i });

    const percents = screen.getAllByLabelText(/^probabilité de /i) as HTMLInputElement[];
    expect(percents).toHaveLength(7);
    expect(percents[0]?.value).toBe('20');
    expect(percents[1]?.value).toBe('15');
    expect(percents[0]).toBeEnabled();

    const wheel = screen.getByTestId('preview-wheel');
    const labels = wheel.querySelectorAll('[data-wheel-segment]');
    expect((labels[0] as HTMLElement).textContent).toContain('20%');
    expect((labels[5] as HTMLElement).textContent).toContain('25%');
  });

  it('lists the Prochaine fois reward deactivated and off the wheel', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ success: true, campaign: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    renderPage();

    const toggles = await screen.findAllByRole('switch', { name: /activer prochaine fois/i });
    expect(toggles.length).toBeGreaterThan(0);
    for (const toggle of toggles) {
      expect(toggle).toHaveAttribute('aria-checked', 'false');
    }
    expect(screen.getByText(/aucun gain/i)).toBeTruthy();

    const lockedPercent = screen.getByLabelText('Probabilité de Prochaine fois') as HTMLInputElement;
    expect(lockedPercent).toBeDisabled();
    expect(lockedPercent.value).toBe('0');

    const wheel = screen.getByTestId('preview-wheel');
    expect(wheel.querySelectorAll('[data-wheel-segment]')).toHaveLength(6);
    expect(wheel.textContent).not.toContain('Prochaine fois');
  });

  it('activates the no-win reward, puts it on the wheel and saves type none', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();

      if (method === 'GET') {
        return new Response(JSON.stringify({ success: true, campaign: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true, campaign: { id: 'c1', publicCode: 'ABCDEF012345' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    renderPage();

    const toggles = await screen.findAllByRole('switch', { name: /activer prochaine fois/i });
    expect(toggles.length).toBeGreaterThan(0);
    const firstToggle = toggles[0];
    expect(firstToggle).toBeDefined();
    if (firstToggle) {
      await userEvent.click(firstToggle);
      expect(firstToggle).toHaveAttribute('aria-checked', 'true');
    }

    const lockedPercent = screen.getByLabelText('Probabilité de Prochaine fois') as HTMLInputElement;
    expect(lockedPercent).toBeEnabled();
    expect(lockedPercent.value).toBe('0');

    const wheel = screen.getByTestId('preview-wheel');
    await waitFor(() => expect(wheel.textContent).toContain('Prochaine fois'));
    expect(wheel.querySelectorAll('[data-wheel-segment]')).toHaveLength(7);

    const saveButton = screen.getByRole('button', { name: /enregistrer la configuration/i });
    await userEvent.click(saveButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const putCall = fetchMock.mock.calls.find(([, init]) => (init?.method ?? 'GET').toUpperCase() === 'PUT');
    const body = JSON.parse(String(putCall?.[1]?.body)) as {
      rewards: Array<{ name: string; type: string; active: boolean; weight: number }>;
    };

    expect(body.rewards).toHaveLength(7);
    expect(body.rewards.at(-1)).toMatchObject({ name: 'Prochaine fois', type: 'none', active: true, weight: 0 });
    expect(body.rewards[0]).toMatchObject({ type: 'custom_reward', active: true, weight: 20 });
  });

  it('deletes a persisted reward immediately and keeps it gone', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();

      if (method === 'DELETE') {
        expect(String(input)).toBe('/api/business/rewards/r1');
        return jsonResponse({ success: true, id: 'r1' });
      }

      return jsonResponse({
        success: true,
        campaign: loadedCampaign,
        rewards: [{ id: 'r1', name: 'Legacy reward', type: 'custom_reward', weight: 20, active: 1 }],
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPage();

    await screen.findByLabelText('Probabilité de Legacy reward');
    const [trashButton] = screen.getAllByRole('button', { name: 'Supprimer la récompense Legacy reward' });
    expect(trashButton).toBeDefined();
    await userEvent.click(trashButton!);

    await waitFor(() => {
      const deleteCall = fetchMock.mock.calls.find(
        ([, init]) => (init?.method ?? 'GET').toUpperCase() === 'DELETE',
      );
      expect(deleteCall).toBeTruthy();
      expect(String(deleteCall?.[0])).toBe('/api/business/rewards/r1');
    });

    expect(screen.queryByLabelText('Probabilité de Legacy reward')).toBeNull();
    await screen.findByText('Récompense supprimée.');
  });

  it('restores the row and surfaces an error when the DELETE fails', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();

      if (method === 'DELETE') {
        return jsonResponse({ success: false, message: 'Unable to delete the reward.' }, 500);
      }

      return jsonResponse({
        success: true,
        campaign: loadedCampaign,
        rewards: [{ id: 'r1', name: 'Legacy reward', type: 'custom_reward', weight: 20, active: 1 }],
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPage();

    await screen.findByLabelText('Probabilité de Legacy reward');
    const [trashButton] = screen.getAllByRole('button', { name: 'Supprimer la récompense Legacy reward' });
    expect(trashButton).toBeDefined();
    await userEvent.click(trashButton!);

    await screen.findByText(/Impossible de supprimer la récompense/);
    expect(screen.getByLabelText('Probabilité de Legacy reward')).toBeTruthy();
  });

  it('shows an empty distribution for a campaign without rewards and can load the example', async () => {
    stubConfigFetch({ campaign: loadedCampaign, rewards: [] });

    renderPage();

    await screen.findByTestId('rewards-empty');
    expect(screen.queryByLabelText('Probabilité de Café offert')).toBeNull();
    expect(screen.getByTestId('preview-wheel').querySelectorAll('[data-wheel-segment]')).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: /charger l.exemple de répartition/i }));

    await waitFor(() => expect(screen.queryByTestId('rewards-empty')).toBeNull());
    expect(screen.getByLabelText('Probabilité de Café offert')).toBeTruthy();
    expect(screen.getByTestId('preview-wheel').querySelectorAll('[data-wheel-segment]')).toHaveLength(6);
  });

  it('drops a purely local reward without calling the API', async () => {
    const fetchMock = stubConfigFetch({ campaign: loadedCampaign, rewards: [] });

    renderPage();

    await screen.findByTestId('rewards-empty');
    await userEvent.click(screen.getByRole('button', { name: /charger l.exemple de répartition/i }));
    await screen.findByLabelText('Probabilité de Prochaine visite');

    const callsBefore = fetchMock.mock.calls.length;
    const [trashButton] = screen.getAllByRole('button', { name: 'Supprimer la récompense Prochaine visite' });
    expect(trashButton).toBeDefined();
    await userEvent.click(trashButton!);

    await waitFor(() => expect(screen.queryByLabelText('Probabilité de Prochaine visite')).toBeNull());
    const deleteCalls = fetchMock.mock.calls
      .slice(callsBefore)
      .filter(([, init]) => ((init?.method as string | undefined) ?? 'GET').toUpperCase() === 'DELETE');
    expect(deleteCalls).toHaveLength(0);
  });

  it('warns when no prize can be won and blocks the preview spin', async () => {
    stubConfigFetch({
      campaign: loadedCampaign,
      rewards: [{ id: 'z1', name: 'Only prize', type: 'custom_reward', weight: 0, active: 1 }],
    });

    renderPage();

    await screen.findByTestId('zero-warning');
    expect(screen.getByText('Total: 0%')).toBeTruthy();
    expect(screen.getByRole('button', { name: /simuler un tirage/i })).toBeDisabled();
  });

  function wheelThemeFetch(state: Record<string, unknown>) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();

      if (url === '/api/settings/wheel-theme') {
        return method === 'PUT'
          ? jsonResponse({ success: true, theme: JSON.parse(String(init?.body)) })
          : jsonResponse({ success: true, ...state });
      }
      if (method === 'GET') {
        return jsonResponse({ success: true, campaign: null });
      }
      return jsonResponse({ success: true, campaign: { id: 'c1', publicCode: 'ABCDEF012345' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  const allowedThemeState = {
    designAllowed: true,
    centerLogoAllowed: true,
    stepsColorAllowed: true,
    planSlug: 'scale',
    planName: 'Business',
    theme: null,
    override: null,
    effective: DEFAULT_WHEEL_THEME,
    centerLogo: '/api/public/businesses/b1/wheel-logo',
  };

  it('hides the design section when the plan has no wheel access', async () => {
    wheelThemeFetch({
      ...allowedThemeState,
      designAllowed: false,
      centerLogoAllowed: false,
      stepsColorAllowed: false,
      planSlug: 'starter',
      planName: 'Starter',
      effective: DEFAULT_WHEEL_THEME,
    });

    renderPage();

    await waitFor(() => expect(screen.queryByTestId('wheel-design-section')).toBeNull());
    expect(screen.queryByTestId('wheel-design-locked')).toBeNull();
    expect(screen.queryByRole('link', { name: /voir les plans/i })).toBeNull();
    expect(screen.queryByLabelText('Vitesse de rotation')).toBeNull();
    expect(screen.queryByRole('button', { name: /enregistrer le design/i })).toBeNull();
    expect(screen.queryByText(/afficher le logo au centre/i)).toBeNull();
    expect(screen.queryByText(/couleur des étapes/i)).toBeNull();
  });

  it('hides the design section when the operator turned the wheel criteria off', async () => {
    wheelThemeFetch({
      ...allowedThemeState,
      designAllowed: false,
      centerLogoAllowed: false,
      stepsColorAllowed: false,
    });

    renderPage();

    await waitFor(() => expect(screen.queryByTestId('wheel-design-section')).toBeNull());
    expect(screen.queryByTestId('wheel-design-locked')).toBeNull();
    expect(screen.queryByRole('link', { name: /voir les plans/i })).toBeNull();
    expect(screen.queryByLabelText('Vitesse de rotation')).toBeNull();
    expect(screen.queryByRole('button', { name: /enregistrer le design/i })).toBeNull();
    expect(screen.queryByText(/afficher le logo au centre/i)).toBeNull();
    expect(screen.queryByText(/couleur des étapes/i)).toBeNull();
  });

  it('moves the hub logo into general info on Pro with its own save, no design card', async () => {
    wheelThemeFetch({
      ...allowedThemeState,
      designAllowed: false,
      planSlug: 'growth',
      planName: 'Pro',
    });

    renderPage();

    await waitFor(() => expect(screen.queryByTestId('wheel-design-section')).toBeNull());
    expect(screen.queryByTestId('wheel-design-locked')).toBeNull();
    expect(screen.queryByRole('link', { name: /voir les plans/i })).toBeNull();
    expect(screen.queryByLabelText('Vitesse de rotation')).toBeNull();
    expect(screen.getByText(/afficher le logo au centre/i)).toBeTruthy();
    expect(screen.getByLabelText(/téléverser un logo/i)).toBeTruthy();
    expect(screen.getByText(/couleur des étapes/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /enregistrer le design/i })).toBeTruthy();
  });

  it('saves a custom design through the wheel-theme PUT', async () => {
    const fetchMock = wheelThemeFetch(allowedThemeState);

    renderPage();

    const motion = await screen.findByLabelText('Vitesse de rotation');
    await userEvent.selectOptions(motion, 'fast');
    await userEvent.click(screen.getByRole('button', { name: /enregistrer le design/i }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          (call) => String(call[0]) === '/api/settings/wheel-theme' && (call[1]?.method ?? 'GET') === 'PUT',
        ),
      ).toBe(true),
    );

    const putCall = fetchMock.mock.calls.find(
      (call) => String(call[0]) === '/api/settings/wheel-theme' && (call[1]?.method ?? 'GET') === 'PUT',
    );
    const body = JSON.parse(String(putCall?.[1]?.body)) as { motion: { preset: string } };
    expect(body.motion.preset).toBe('fast');
    await screen.findByText(/design enregistré/i);
  });

  it('saves the merchant step colour through the wheel-theme PUT', async () => {
    const fetchMock = wheelThemeFetch({ ...allowedThemeState, stepsColorAllowed: true });

    renderPage();

    await screen.findByText(/couleur des étapes/i);
    const colorInput = document.getElementById('wheel-steps-color') as HTMLInputElement | null;
    expect(colorInput).toBeTruthy();
    expect(colorInput?.value.toLowerCase()).toBe('#7dab4b');

    fireEvent.change(colorInput!, { target: { value: '#112233' } });
    await userEvent.click(screen.getByRole('button', { name: /enregistrer le design/i }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          (call) => String(call[0]) === '/api/settings/wheel-theme' && (call[1]?.method ?? 'GET') === 'PUT',
        ),
      ).toBe(true),
    );

    const putCall = fetchMock.mock.calls.find(
      (call) => String(call[0]) === '/api/settings/wheel-theme' && (call[1]?.method ?? 'GET') === 'PUT',
    );
    const body = JSON.parse(String(putCall?.[1]?.body)) as { stepsColor: string };
    expect(body.stepsColor).toBe('#112233');
  });

  it('auto-saves centerLogo on upload from the persisted theme, without a manual save', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();

      if (url === '/api/settings/wheel-logo' && method === 'POST') {
        return jsonResponse({ success: true, logo: '/api/public/businesses/b1/wheel-logo?v=2026-01-01' });
      }
      if (url === '/api/settings/wheel-theme') {
        return method === 'PUT'
          ? jsonResponse({ success: true, theme: JSON.parse(String(init?.body)) })
          : jsonResponse({ success: true, ...allowedThemeState });
      }
      if (method === 'GET') return jsonResponse({ success: true, campaign: null });
      return jsonResponse({ success: true, campaign: { id: 'c1', publicCode: 'ABCDEF012345' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPage();

    // Dirty the draft with an unsaved motion change — the upload must not
    // silently commit it.
    const motion = await screen.findByLabelText('Vitesse de rotation');
    await userEvent.selectOptions(motion, 'fast');

    const input = (await screen.findByLabelText(/téléverser un logo/i)) as HTMLInputElement;
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'logo.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          (call) => String(call[0]) === '/api/settings/wheel-logo' && (call[1]?.method ?? 'GET') === 'POST',
        ),
      ).toBe(true),
    );
    // No click on "Enregistrer le design" — the upload itself persisted the flag.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          (call) => String(call[0]) === '/api/settings/wheel-theme' && (call[1]?.method ?? 'GET') === 'PUT',
        ),
      ).toBe(true),
    );

    const putCall = fetchMock.mock.calls.find(
      (call) => String(call[0]) === '/api/settings/wheel-theme' && (call[1]?.method ?? 'GET') === 'PUT',
    );
    const body = JSON.parse(String(putCall?.[1]?.body)) as {
      centerLogo: boolean;
      motion: { preset: string };
    };
    expect(body.centerLogo).toBe(true);
    // Based on the last persisted theme (standard), never the dirty draft.
    expect(body.motion.preset).toBe(DEFAULT_WHEEL_THEME.motion.preset);

    await screen.findByText(/logo enregistré et activé sur la roue/i);
  });

  it('pins colors and motion under an operator override but keeps the hub logo editable', async () => {
    wheelThemeFetch({
      ...allowedThemeState,
      override: {
        colors: { segments: ['#0000ff'], rim: '#333333', pointer: '#444444' },
        motion: { preset: 'slow' },
        centerLogo: false,
      },
      effective: {
        colors: { segments: ['#0000ff'], rim: '#333333', pointer: '#444444' },
        motion: { preset: 'slow' },
        centerLogo: false,
      },
    });

    renderPage();

    expect(await screen.findByTestId('wheel-design-override')).toBeTruthy();
    // Colors and motion belong to the operator while the override stands…
    expect(screen.getByLabelText('Vitesse de rotation')).toBeDisabled();
    expect(screen.getByLabelText('Vitesse de rotation')).toHaveValue('slow');
    // …but the merchant's own brand asset stays theirs to toggle and upload.
    expect(screen.getByLabelText(/afficher le logo au centre/i)).toBeEnabled();
    expect(screen.getByLabelText(/téléverser un logo/i)).toBeEnabled();
  });
});
