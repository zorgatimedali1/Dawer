import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CampaignCustomerPage, { gateTimings } from '@/app/customer/[campaignId]/page';

const DEFAULT_GATE_TIMINGS = { ...gateTimings };

const campaign = {
  id: 'c1',
  name: 'Coffee Spin',
  description: 'Turn the wheel and win',
  public_code: 'ABC123DEF456',
  status: 'ACTIVE',
  start_at: null,
  end_at: null,
  game_type: 'WHEEL',
  require_action: 'GOOGLE_REVIEW',
  require_customer_information: 1,
  google_maps_name: 'Blue Bottle Coffee',
  google_maps_url: 'https://maps.google.com/?cid=1',
  google_place_id: 'ChIJtestplace',
  facebook_url: '',
  instagram_url: '',
  business_name: 'Meridian North',
  business_logo: null,
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

function renderPage(initialEntry = '/wheels/ABC123DEF456') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/wheels/:campaignId" element={<CampaignCustomerPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** jsdom reports a constant `visible` document, so the gate handshake is driven by hand. */
function setVisibility(state: 'visible' | 'hidden') {
  act(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => state,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

function stubFetch(overrides: Record<string, unknown> = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();

    if (method === 'GET') {
      return jsonResponse({
        success: true,
        campaign: { ...campaign, ...overrides },
        rewards,
        actionTicket: 'test-action-ticket',
      });
    }

    if (url.endsWith('/participate')) {
      return jsonResponse({
        success: true,
        participation: {
          participationId: 'p-1',
          campaignId: 'c1',
          reward: rewards[0],
          couponCode: 'CF-DEADBEEF00112233',
        },
      });
    }

    if (url.endsWith('/action')) {
      return jsonResponse({ success: true, required: true, action: 'GOOGLE_REVIEW' });
    }

    return jsonResponse({ success: true, couponCode: 'CF-DEADBEEF00112233' });
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('public campaign page', () => {
  let stopLinkNavigation: ((event: Event) => void) | null = null;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('open', vi.fn(() => null));
    window.sessionStorage.clear();
    window.localStorage.clear();

    // Fast gate by default; individual tests tighten or restore what they need.
    gateTimings.unlockDelaySeconds = 0;
    Reflect.deleteProperty(document, 'visibilityState');

    stopLinkNavigation = (event: Event) => {
      const anchor = (event.target as HTMLElement | null)?.closest?.('a');
      if (anchor?.getAttribute('target') === '_blank') event.preventDefault();
    };
    document.addEventListener('click', stopLinkNavigation);
  });

  afterEach(() => {
    if (stopLinkNavigation) document.removeEventListener('click', stopLinkNavigation);
    stopLinkNavigation = null;
    gateTimings.unlockDelaySeconds = DEFAULT_GATE_TIMINGS.unlockDelaySeconds;
    Reflect.deleteProperty(navigator, 'geolocation');
  });

  it('renders the gate with the steps and the Google wordmark, without the account name', async () => {
    stubFetch();
    renderPage();

    await screen.findByRole('heading', { name: 'Coffee Spin' });
    expect(screen.queryByText('Meridian North')).toBeNull();
    expect(screen.getByText('Comment ça marche')).toBeTruthy();
    expect(screen.getByText('Laissez un avis Google')).toBeTruthy();
    expect(screen.getByText('Tournez la roue')).toBeTruthy();
    expect(screen.getByText('Récupérez votre récompense')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Google Reviews' })).toBeTruthy();
    expect(screen.getByLabelText('Noté 5 étoiles')).toBeTruthy();
    expect(screen.getByText(/un nouvel onglet s.ouvrira/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /laisser un avis google/i })).toBeTruthy();
    // Prize chips under the location are hidden for now.
    expect(screen.queryByText('Free coffee')).toBeNull();
    expect(screen.getByText('Powered by Dawer')).toBeTruthy();
  });

  it('paints the gate step badges with the default brand colour', async () => {
    stubFetch();
    renderPage();

    await screen.findByRole('heading', { name: 'Coffee Spin' });

    const badge = document.querySelector('ol span') as HTMLElement | null;
    expect(badge?.style.backgroundColor).toBe('rgb(125, 171, 75)');
    expect(badge?.style.color).toBe('rgb(13, 18, 11)');
  });

  it('applies the merchant step colour to the badges and CTAs', async () => {
    stubFetch({
      wheel_theme: {
        colors: { segments: ['#ff0000'], rim: '#ffffff', pointer: '#0f172a' },
        motion: { preset: 'standard' },
        centerLogo: false,
        stepsColor: '#112233',
      },
    });
    renderPage();

    await screen.findByRole('heading', { name: 'Coffee Spin' });

    const painted = Array.from(document.querySelectorAll<HTMLElement>('[style]')).filter(
      (el) => el.style.backgroundColor === 'rgb(17, 34, 51)',
    );
    // The step badge plus at least one CTA button share the merchant accent,
    // and the dark accent flips the label ink to the light tone.
    expect(painted.length).toBeGreaterThanOrEqual(2);
    expect(painted.every((el) => el.style.color === 'rgb(247, 251, 242)')).toBe(true);
  });

  it('sends the visitor to the write-review dialog but keeps the wheel locked until they return', async () => {
    const fetchMock = stubFetch();
    renderPage();

    const cta = await screen.findByRole('link', { name: /laisser un avis google/i });
    expect(cta.getAttribute('href')).toBe('https://search.google.com/local/writereview?placeid=ChIJtestplace');
    expect(cta.getAttribute('target')).toBe('_blank');
    expect(cta.getAttribute('rel')).toContain('noopener');

    await userEvent.click(cta);

    expect(screen.queryByRole('heading', { name: /Tournez la roue/i })).toBeNull();
  expect(screen.queryByRole('link', { name: /laisser un avis google/i })).toBeNull();
  expect(screen.getByRole('button', { name: /continuer vers la roue/i })).toBeTruthy();
    expect(screen.getByText(/en attente de votre retour/i)).toBeTruthy();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/action'))).toBe(false);

    setVisibility('hidden');
    setVisibility('visible');

    await screen.findByRole('heading', { name: /Tournez la roue/i });

    const actionCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/action'));
    expect(actionCall).toBeTruthy();

    const payload = JSON.parse(String(actionCall?.[1]?.body)) as Record<string, unknown>;
    expect(payload.action).toBe('GOOGLE_REVIEW');
    expect(payload.anonymousId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(payload.actionTicket).toBe('test-action-ticket');
  });

  it('counts down after the visitor returns before opening the wheel', async () => {
    gateTimings.unlockDelaySeconds = 2;
    stubFetch();
    renderPage();

    await userEvent.click(await screen.findByRole('link', { name: /laisser un avis google/i }));
    setVisibility('hidden');
    setVisibility('visible');

    await new Promise((r) => setTimeout(r, 100));
    console.log('DEBUG BODY:', document.body.innerHTML.slice(0, 1200));
    console.log('DEBUG gateTimings:', JSON.stringify(gateTimings));
    expect(await screen.findByText(/ouverture de la roue dans 2/i)).toBeTruthy();
    await screen.findByRole('heading', { name: /Tournez la roue/i }, { timeout: 4000 });
  });

  it('offers a manual continue when the browser never reports a return', async () => {
    stubFetch();
    renderPage();

    await userEvent.click(await screen.findByRole('link', { name: /laisser un avis google/i }));
    await userEvent.click(screen.getByRole('button', { name: /continuer vers la roue/i }));

    await screen.findByRole('heading', { name: /Tournez la roue/i });
  });

  it('unlocks only after the visitor confirms an action that has no link', async () => {
    const fetchMock = stubFetch({ require_action: 'NEWSLETTER', instagram_url: '' });
    renderPage();

    const checkbox = await screen.findByRole('checkbox');
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('heading', { name: /Tournez la roue/i })).toBeNull();

    await userEvent.click(checkbox);

    await screen.findByRole('heading', { name: /Tournez la roue/i });
    const actionCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/action'));
    expect(JSON.parse(String(actionCall?.[1]?.body))).toMatchObject({ action: 'NEWSLETTER' });
  });

  it('stays locked when the visitor unticks the confirmation', async () => {
    gateTimings.unlockDelaySeconds = 2;
    stubFetch({ require_action: 'PURCHASE' });
    renderPage();

    const checkbox = await screen.findByRole('checkbox');
    await userEvent.click(checkbox);
    await userEvent.click(checkbox);

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(screen.queryByRole('heading', { name: /Tournez la roue/i })).toBeNull();
  });

  it('falls back to the saved Google place URL when no place id is configured', async () => {
    stubFetch({ google_place_id: '' });
    renderPage();

    const cta = await screen.findByRole('link', { name: /laisser un avis google/i });
    expect(cta.getAttribute('href')).toBe('https://maps.google.com/?cid=1');
  });

  it('walks gate to coupon with only name and phone when email is omitted', async () => {
    const fetchMock = stubFetch();

    renderPage();
    await userEvent.click(await screen.findByRole('link', { name: /laisser un avis google/i }));
    setVisibility('hidden');
    setVisibility('visible');

    await screen.findByRole('heading', { name: /Tournez la roue/i });
    await userEvent.click(screen.getByRole('button', { name: /Tourner la roue/i }));

    await screen.findByRole('heading', { name: /félicitations/i }, { timeout: 10000 });
    expect(screen.getByText('Vous avez gagné :')).toBeTruthy();
    expect(screen.getAllByText(/free coffee/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/laissez vos coordonnées/i)).toBeTruthy();
    expect(screen.queryByText('CF-DEADBEEF00112233')).toBeNull();

    await userEvent.type(screen.getByLabelText(/nom complet/i), 'Jean Dupont');
    await userEvent.type(screen.getByLabelText(/numéro de téléphone/i), '+21612345678');
    expect(screen.getByLabelText(/adresse e-mail \(optionnel\)/i)).toBeTruthy();
    const marketingConsent = screen.getByRole('checkbox', { name: /messages marketing/i }) as HTMLInputElement;
    expect(marketingConsent.checked).toBe(false);
    expect(screen.getByRole('link', { name: 'Politique de confidentialité' })).toHaveAttribute('href', '/privacy');

    const submit = screen.getByRole('button', { name: /recevoir mon lot/i });
    await waitFor(() => expect(submit).not.toBeDisabled());
    await userEvent.click(submit);

    await screen.findByText('CF-DEADBEEF00112233');
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const detailsCall = fetchMock.mock.calls.find(([input]) =>
      String(input).includes('/participations/p-1/customer'),
    );
    expect(detailsCall).toBeTruthy();

    const body = JSON.parse(String(detailsCall?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      firstName: 'Jean',
      lastName: 'Dupont',
      email: '',
      phone: '+21612345678',
      marketingConsent: false,
    });
  }, 15000);

  it('skips the action gate when the campaign requires none', async () => {
    stubFetch({ require_action: 'NONE' });
    renderPage();

    const cta = await screen.findByRole('button', { name: /Tourner la roue/i });
    expect(screen.queryByText(/un nouvel onglet s'ouvrira/i)).toBeNull();
    expect(screen.queryByRole('img', { name: 'Google Reviews' })).toBeNull();

    await userEvent.click(cta);
    await screen.findByRole('heading', { name: /Tournez la roue/i });
    expect(screen.getByRole('button', { name: /Tourner la roue/i })).toBeTruthy();
    expect(vi.mocked(window.open)).not.toHaveBeenCalled();
  });

  it('prints every prize inside a wheel segment without the winning odds', async () => {
    stubFetch({ require_action: 'NONE' });
    const { container } = renderPage();

    await userEvent.click(await screen.findByRole('button', { name: /Tourner la roue/i }));

    const wheel = await screen.findByTestId('prize-wheel');
    expect(wheel.textContent).toContain('Free coffee');
    expect(wheel.textContent).toContain('Try again');
    const labels = wheel.querySelectorAll('[data-wheel-segment]');
    expect(labels).toHaveLength(rewards.length);
    // Odds stay behind the scenes on the public wheel.
    expect((labels[0] as HTMLElement).textContent).not.toContain('70%');
    expect((labels[1] as HTMLElement).textContent).not.toContain('30%');
    expect((labels[0] as HTMLElement).textContent).not.toContain('%');
    // The no-win slice carries its Arabic twin.
    expect((labels[1] as HTMLElement).textContent).toContain('المرة القادمة');
    expect((labels[0] as HTMLElement).style.width).toContain('%');
    expect((labels[0] as HTMLElement).style.fontSize).toContain('cqw');
    expect(container.querySelector('.lucide-trophy')).toBeNull();
  });

  it('renders emojis inside slice labels larger than the text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          success: true,
          campaign: { ...campaign, require_action: 'NONE' },
          rewards: [
            { id: 'e1', name: '☕ Café offert', description: '', type: 'free_product', value: '1', weight: 60, quantity: 5 },
            { id: 'e2', name: 'Try again', description: null, type: 'none', value: '0', weight: 40, quantity: 0 },
          ],
        }),
      ),
    );

    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Tourner la roue/i }));

    const labels = (await screen.findByTestId('prize-wheel')).querySelectorAll('[data-wheel-segment]');
    const emojiSpan = (labels[0] as HTMLElement).querySelector('span[style*="1.55em"]');
    expect(emojiSpan).toBeTruthy();
    expect(emojiSpan?.textContent).toBe('☕');
  });

  it('keeps the normalized odds hidden with two slices on the wheel', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          success: true,
          campaign: { ...campaign, require_action: 'NONE' },
          rewards: [
            { id: 'n1', name: 'Free coffee', description: '', type: 'free_product', value: '1', weight: 20, quantity: 5 },
            { id: 'n2', name: 'Try again', description: null, type: 'none', value: '0', weight: 10, quantity: 0 },
          ],
        }),
      ),
    );

    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Tourner la roue/i }));

    const labels = (await screen.findByTestId('prize-wheel')).querySelectorAll('[data-wheel-segment]');
    expect((labels[0] as HTMLElement).textContent).not.toContain('67%');
    expect((labels[1] as HTMLElement).textContent).not.toContain('33%');
    expect((labels[0] as HTMLElement).textContent).not.toContain('%');
  });

  it('shows the empty wheel and blocks the spin when every weight is zero', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          success: true,
          campaign: { ...campaign, require_action: 'NONE', require_customer_information: 0 },
          rewards: [
            { id: 'z1', name: 'Free coffee', description: '', type: 'free_product', value: '1', weight: 0, quantity: 5 },
            { id: 'z2', name: 'Try again', description: null, type: 'none', value: '0', weight: 0, quantity: 0 },
          ],
        }),
      ),
    );

    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Tourner la roue/i }));

    await screen.findByRole('heading', { name: /Tournez la roue/i });
    await screen.findByText('Aucun lot disponible pour le moment.');
    expect(screen.getByRole('button', { name: /Tourner la roue/i })).toBeDisabled();
  });

  it('plays the special no-win animation when the visitor lands on the no-win slice', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();

        if (method === 'GET') {
          return jsonResponse({ success: true, campaign: { ...campaign, require_action: 'NONE' }, rewards });
        }

        if (url.endsWith('/participate')) {
          return jsonResponse({
            success: true,
            participation: {
              participationId: 'p-2',
              campaignId: 'c1',
              reward: rewards[1],
              couponCode: '',
            },
          });
        }

        return jsonResponse({ success: true });
      }),
    );

    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: /Tourner la roue/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Tourner la roue/i }));

    await screen.findByRole('heading', { name: /pas de chance/i }, { timeout: 5000 });

    expect(screen.getByText('Vous avez obtenu :')).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /recevoir mon lot/i })).toBeNull();
    expect(screen.queryByLabelText(/nom complet/i)).toBeNull();
    expect(screen.queryByText('CF-DEADBEEF00112233')).toBeNull();

    // Special animation for the no-win slice: popping card, wobbling emoji and
    // the muted confetti palette instead of the rainbow one.
    expect(document.querySelector('.cf-no-win-card')).toBeTruthy();
    expect(document.querySelector('.cf-no-win-emoji')).toBeTruthy();

    const pieces = Array.from(document.querySelectorAll('.cf-confetti-piece')) as HTMLElement[];
    expect(pieces.length).toBeGreaterThan(0);
    expect(pieces.some((piece) => piece.style.backgroundColor === 'rgb(148, 163, 184)')).toBe(true);
    expect(pieces.every((piece) => piece.style.backgroundColor !== 'rgb(244, 63, 94)')).toBe(true);
  });

  it('surfaces the API error when the spin is rejected', async () => {
    stubFetch({ require_action: 'NONE' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if ((init?.method ?? 'GET').toUpperCase() === 'GET') {
          return jsonResponse({
            success: true,
            campaign: {
              ...campaign,
              require_action: 'NONE',
              require_customer_information: 0,
            },
            rewards,
          });
        }

        expect(String(input).endsWith('/participate')).toBe(true);
        return jsonResponse({ success: false, message: 'No reward available for this campaign.' }, 400);
      }),
    );

    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Tourner la roue/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Tourner la roue/i }));

    // Translated through the i18n errors dictionary (no raw English in the FR UI).
    await screen.findByText(/aucune récompense disponible pour cette campagne/i);
  });

  it('returns a visitor who already holds the claim to the already-played card', async () => {
    stubFetch({ require_action: 'NONE' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if ((init?.method ?? 'GET').toUpperCase() === 'GET') {
          return jsonResponse({
            success: true,
            campaign: { ...campaign, require_action: 'NONE' },
            rewards,
          });
        }

        expect(String(input).endsWith('/participate')).toBe(true);
        return jsonResponse(
          { success: false, message: 'This customer has already participated in this campaign.' },
          409,
        );
      }),
    );

    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Tourner la roue/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Tourner la roue/i }));

    await screen.findByRole('heading', { name: /déjà participé/i });
    expect(screen.queryByRole('button', { name: /Tourner la roue/i })).toBeNull();
    expect(window.localStorage.getItem('cf_spun_ABC123DEF456')).toBe('1');
  });

  it('skips the gate for a visitor who already spun', async () => {
    window.localStorage.setItem('cf_spun_ABC123DEF456', '1');
    stubFetch();

    renderPage();

    await screen.findByRole('heading', { name: /déjà participé/i });
    expect(screen.queryByText('Comment ça marche')).toBeNull();
    expect(screen.queryByRole('link', { name: /laisser un avis google/i })).toBeNull();
    expect(screen.getByText(/déjà joué chez Meridian North/i)).toBeTruthy();
    expect(screen.getByText('Powered by Dawer')).toBeTruthy();
  });

  it('reuses one visitor id across sessions so a re-scan cannot spin again', async () => {
    const fetchMock = stubFetch();

    const firstVisit = renderPage();
    await userEvent.click(await screen.findByRole('link', { name: /laisser un avis google/i }));
    setVisibility('hidden');
    setVisibility('visible');
    await screen.findByRole('heading', { name: /Tournez la roue/i });

    const actionCalls = () =>
      fetchMock.mock.calls.filter(([input]) => String(input).includes('/action'));
    const readId = (call: (typeof fetchMock.mock.calls)[number] | undefined) =>
      (JSON.parse(String(call?.[1]?.body)) as { anonymousId?: string }).anonymousId;

    const firstId = readId(actionCalls()[0]);
    expect(firstId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(window.localStorage.getItem('cf_anon_ABC123DEF456')).toBe(firstId);
    firstVisit.unmount();

    // Fresh tab from a second QR scan: the id must not be minted again.
    renderPage();
    await userEvent.click(await screen.findByRole('link', { name: /laisser un avis google/i }));
    setVisibility('hidden');
    setVisibility('visible');
    await screen.findByRole('heading', { name: /Tournez la roue/i });

    expect(readId(actionCalls()[actionCalls().length - 1])).toBe(firstId);
  });

  it('shows an unavailable state when the campaign is not public', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: false, message: 'Campaign not found.' }, 404)),
    );

    renderPage();

    await screen.findByText(/campagne non disponible/i);
    expect(screen.getByText(/introuvable ou n’est pas disponible/i)).toBeTruthy();
  });

  describe('no location prompt', () => {
    const SHOP = { latitude: 36.8065, longitude: 10.1815 };

    function stubGeolocationSpy() {
      const getCurrentPosition = vi.fn();
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: { getCurrentPosition },
      });
      return getCurrentPosition;
    }

    function stubSpinFetch(
      overrides: Record<string, unknown>,
      bodies: Array<Record<string, unknown>>,
      rootExtras: Record<string, unknown> = {},
    ) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          const method = (init?.method ?? 'GET').toUpperCase();

          if (method === 'GET') {
            return jsonResponse({
              success: true,
              campaign: {
                ...campaign,
                require_action: 'NONE',
                require_customer_information: 0,
                ...overrides,
              },
              rewards,
              ...rootExtras,
            });
          }

          if (url.endsWith('/participate')) {
            bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
            return jsonResponse({
              success: true,
              participation: {
                participationId: 'p-1',
                campaignId: 'c1',
                reward: rewards[0],
                couponCode: 'CF-DEADBEEF00112233',
              },
            });
          }

          return jsonResponse({ success: true });
        }),
      );
    }

    async function spinOnce(bodies: Array<Record<string, unknown>>) {
      await userEvent.click(await screen.findByRole('button', { name: /Tourner la roue/i }));
      await userEvent.click(await screen.findByRole('button', { name: /Tourner la roue/i }));
      await waitFor(() => expect(bodies).toHaveLength(1));
    }

    it('never asks for a position and never sends coordinates, even when the campaign has a location', async () => {
      const getCurrentPosition = stubGeolocationSpy();
      const bodies: Array<Record<string, unknown>> = [];
      stubSpinFetch({ latitude: SHOP.latitude, longitude: SHOP.longitude }, bodies);

      renderPage();
      await spinOnce(bodies);

      expect(getCurrentPosition).not.toHaveBeenCalled();
      expect(bodies[0]).not.toHaveProperty('latitude');
      expect(bodies[0]).not.toHaveProperty('longitude');
    });
  });
});
