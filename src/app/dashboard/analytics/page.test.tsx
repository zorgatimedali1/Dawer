import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AnalyticsPage from '@/app/dashboard/analytics/page';

const AUTH_KEY = 'campaign-engage-auth';

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Per-day metrics chosen so every card total is unique for a given range. */
function seriesPayload(days: number) {
  return {
    success: true,
    days,
    series: Array.from({ length: days }, (_, index) => ({
      day: `2026-09-${String((index % 28) + 1).padStart(2, '0')}`,
      participations: 4,
      rewardsClaimed: 2,
      couponsRedeemed: 1,
      scans: 6,
      total: 4,
    })),
  };
}

const FUNNEL = {
  success: true,
  days: 30,
  stages: [
    { key: 'participations', label: 'Played', value: 5, rateFromPrevious: 100 },
    { key: 'rewardsClaimed', label: 'Reward earned', value: 3, rateFromPrevious: 60 },
    { key: 'couponsRedeemed', label: 'Coupon redeemed', value: 1, rateFromPrevious: 33 },
  ],
  conversion: {
    participations: 5,
    rewardsClaimed: 3,
    couponsRedeemed: 1,
    uniqueCustomers: 4,
    rewardRate: 60,
    redemptionRate: 33,
    overallRate: 20,
  },
};

const RANKINGS = {
  success: true,
  campaigns: [{ id: 'c1', name: 'Coffee Spin', status: 'ACTIVE', participations: 5, customers: 2 }],
  rewards: [],
};

const OVERVIEW = {
  success: true,
  totals: [{ event_type: 'PARTICIPATION', count: 4242 }],
  summary: { participations: 4242, coupons: 17, redeemed: 9, customers: 30 },
};

type Handler = (url: string) => Response | Promise<Response>;

function stubFetch(handler: Handler) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => handler(String(input)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function defaultHandler(overrides: Partial<Record<string, Handler>> = {}): Handler {
  return (url) => {
    if (url.includes('/api/analytics/timeseries')) {
      const days = url.includes('days=7') ? 7 : 30;
      return jsonResponse(seriesPayload(days));
    }
    if (url.includes('/api/analytics/funnel')) return jsonResponse(FUNNEL);
    if (url.includes('/api/analytics/rankings')) return jsonResponse(RANKINGS);
    if (url.includes('/api/analytics/overview')) return jsonResponse(OVERVIEW);
    if (url.includes('/api/business/rewards')) {
      return overrides.rewards?.(url) ?? jsonResponse({ success: true, rewards: [] });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
}

/** The StatCard value for `label` (the label sits two levels above the number). */
function cardValue(label: string): string {
  const labelNode = screen.getByText(label);
  const card = labelNode.parentElement?.parentElement;
  return card?.querySelector('p.numeric')?.textContent ?? '';
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AnalyticsPage />
    </MemoryRouter>,
  );
}

describe('merchant analytics page', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(AUTH_KEY, JSON.stringify({ token: 'cf_abc.def' }));
    vi.unstubAllGlobals();
  });

  it('renders the five range-scoped stat cards from the timeseries window', async () => {
    stubFetch(defaultHandler());

    renderPage();

    expect(await screen.findByText('Scans (30 j)')).toBeInTheDocument();
    expect(cardValue('Scans (30 j)')).toBe('180');
    expect(cardValue('Joueurs (30 j)')).toBe('120');
    expect(cardValue('Récompenses délivrées (30 j)')).toBe('60');
    expect(cardValue('Coupons utilisés (30 j)')).toBe('30');
    expect(cardValue('Conversion (30 j)')).toBe('25%');

    expect(await screen.findByText('Activité dans le temps')).toBeInTheDocument();
    expect(screen.getAllByText('Played').length).toBeGreaterThan(0);
    expect(screen.getByText('Meilleures campagnes')).toBeInTheDocument();
    expect(screen.getByText('Aucune récompense configurée')).toBeInTheDocument();
    expect(screen.getByText('4242')).toBeInTheDocument();
  });

  it('keeps the page usable when the plan leaves out rewards management', async () => {
    stubFetch(
      defaultHandler({
        rewards: () =>
          jsonResponse({ message: 'Rewards management is not included in your plan.' }, 403),
      }),
    );

    renderPage();

    expect(await screen.findByText('Scans (30 j)')).toBeInTheDocument();
    // Header, range switcher and every other section survive the 403.
    expect(screen.getByRole('heading', { name: 'Analytique' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '7j' })).toBeInTheDocument();
    expect(screen.getByText('Activité dans le temps')).toBeInTheDocument();
    expect(screen.getAllByText('Played').length).toBeGreaterThan(0);

    expect(
      await screen.findByText('La gestion des récompenses n’est pas incluse dans votre offre.'),
    ).toBeInTheDocument();
    // The odds section shows its failure, never the "no rewards" empty state.
    expect(screen.queryByText('Aucune récompense configurée')).toBeNull();
  });

  it('reloads the cards when the range changes', async () => {
    stubFetch(defaultHandler());
    const user = userEvent.setup();

    renderPage();
    expect(await screen.findByText('Scans (30 j)')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: '7j' }));

    expect(await screen.findByText('Scans (7 j)')).toBeInTheDocument();
    expect(cardValue('Scans (7 j)')).toBe('42');
    expect(cardValue('Joueurs (7 j)')).toBe('28');
    expect(screen.queryByText('Scans (30 j)')).toBeNull();
  });

  it('ignores a stale response left over from a fast range switch', async () => {
    let releaseSlow: (() => void) | undefined;
    const slow = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });

    stubFetch((url) => {
      if (url.includes('/api/analytics/timeseries')) {
        if (url.includes('days=30')) {
          return slow.then(() => jsonResponse(seriesPayload(30)));
        }
        return jsonResponse(seriesPayload(7));
      }
      if (url.includes('/api/analytics/funnel')) return jsonResponse(FUNNEL);
      if (url.includes('/api/analytics/rankings')) return jsonResponse(RANKINGS);
      if (url.includes('/api/analytics/overview')) return jsonResponse(OVERVIEW);
      if (url.includes('/api/business/rewards')) return jsonResponse({ success: true, rewards: [] });
      throw new Error(`Unexpected request: ${url}`);
    });

    const user = userEvent.setup();
    renderPage();

    // The 30-day timeseries never comes back before the user switches away.
    await user.click(screen.getByRole('radio', { name: '7j' }));
    expect(await screen.findByText('Scans (7 j)')).toBeInTheDocument();

    await act(async () => {
      releaseSlow?.();
    });

    await waitFor(() => {
      expect(screen.queryByText('Scans (30 j)')).toBeNull();
    });
    expect(cardValue('Scans (7 j)')).toBe('42');
  });

  it('shows a retryable banner only when every analytics request fails', async () => {
    stubFetch((url) => {
      if (url.startsWith('/api/analytics')) {
        return jsonResponse({ message: 'Analytics are not included in the active plan.' }, 403);
      }
      if (url.includes('/api/business/rewards')) return jsonResponse({ success: true, rewards: [] });
      throw new Error(`Unexpected request: ${url}`);
    });

    renderPage();

    // The banner plus every failed section carry the same message.
    const messages = await screen.findAllByText(
      'Les statistiques ne sont pas incluses dans votre offre.',
    );
    expect(messages.length).toBeGreaterThan(0);
    // The header and range switcher stay alive, so recovery is one click away.
    expect(screen.getByRole('heading', { name: 'Analytique' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '90j' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Réessayer' }).length).toBeGreaterThan(0);
    expect(screen.queryByText('Aucune campagne pour le moment')).toBeNull();
  });

  it('shows sold-out redistribution in the odds card', async () => {
    stubFetch(
      defaultHandler({
        rewards: () =>
          jsonResponse({
            success: true,
            rewards: [
              {
                id: 'r1',
                campaign_id: 'c1',
                campaign_name: 'Coffee Spin',
                name: 'Rare',
                type: 'free_product',
                value: '1',
                description: '',
                quantity: 0,
                quantity_initial: 1,
                weight: 70,
                active: 1,
                issued_count: 0,
                updated_at: '2026-01-01T00:00:00.000Z',
              },
              {
                id: 'r2',
                campaign_id: 'c1',
                campaign_name: 'Coffee Spin',
                name: 'Prochaine fois',
                type: 'none',
                value: '0',
                description: '',
                quantity: 0,
                quantity_initial: 0,
                weight: 0,
                active: 1,
                issued_count: 0,
                updated_at: '2026-01-01T00:00:00.000Z',
              },
            ],
          }),
      }),
    );

    renderPage();

    expect(await screen.findByText('Distribution des récompenses')).toBeInTheDocument();
    expect(await screen.findByText('Rare')).toBeInTheDocument();
    // Rare (70) sold out: only Prochaine fois keeps weight, so it is 100%.
    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('renders period-over-period deltas when the previous window has data', async () => {
    stubFetch((url) => {
      if (url.includes('/api/analytics/timeseries')) {
        // Current window: 4 participations/day. The doubled fetch returns a
        // 60-day series whose first half (previous window) is 2/day, so the
        // player count must read +100%.
        if (url.includes('days=60')) {
          const series = [
            ...Array.from({ length: 30 }, () => ({
              day: '2026-08-15',
              participations: 2,
              rewardsClaimed: 1,
              couponsRedeemed: 0,
              scans: 3,
              total: 2,
            })),
            ...Array.from({ length: 30 }, () => ({
              day: '2026-09-14',
              participations: 4,
              rewardsClaimed: 2,
              couponsRedeemed: 1,
              scans: 6,
              total: 4,
            })),
          ];
          return jsonResponse({ success: true, days: 60, series });
        }
        return jsonResponse(seriesPayload(url.includes('days=7') ? 7 : 30));
      }
      if (url.includes('/api/analytics/funnel')) return jsonResponse(FUNNEL);
      if (url.includes('/api/analytics/rankings')) return jsonResponse(RANKINGS);
      if (url.includes('/api/analytics/overview')) return jsonResponse(OVERVIEW);
      if (url.includes('/api/business/rewards')) return jsonResponse({ success: true, rewards: [] });
      throw new Error(`Unexpected request: ${url}`);
    });

    renderPage();

    expect(await screen.findByText('Scans (30 j)')).toBeInTheDocument();
    // Scans, players, rewards and redeemed all doubled vs the previous window.
    expect(screen.getAllByText('+100%').length).toBeGreaterThanOrEqual(4);
    expect(screen.getAllByText('vs 30 j précédents').length).toBeGreaterThanOrEqual(4);
    // Conversion: current 25% vs previous 0% (redeemed 0 in the old window)
    // has no rate change base... previous redeemed is 30 (1/day×30) over 60
    // participations = 5%, so 25% - 5% = +20 pts.
    expect(screen.getAllByText(/\+[\d.]+ pts/).length).toBeGreaterThanOrEqual(1);
  });

  it('opens the campaign drill-down from a ranking row', async () => {
    stubFetch((url) => {
      if (url.includes('/api/analytics/campaigns/c1')) {
        return jsonResponse({
          success: true,
          events: [
            {
              id: 'e1',
              event_type: 'PARTICIPATION',
              event_data: null,
              created_at: '2026-09-14T10:00:00.000Z',
            },
            {
              id: 'e2',
              event_type: 'COUPON_REDEEMED',
              event_data: null,
              created_at: '2026-09-13T09:00:00.000Z',
            },
          ],
        });
      }
      return defaultHandler()(url);
    });

    const user = userEvent.setup();
    renderPage();

    const trigger = await screen.findByRole('button', { name: 'Coffee Spin' });
    await user.click(trigger);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText('Activité de la campagne')).toBeInTheDocument();
    expect(within(dialog).getByText('Participations aux campagnes')).toBeInTheDocument();
    expect(within(dialog).getByText('Coupons utilisés')).toBeInTheDocument();
    expect(within(dialog).getByText('Derniers événements')).toBeInTheDocument();
  });

  it('re-fetches the analytics with fresh=1 when Refresh is clicked', async () => {
    const fetchMock = stubFetch(defaultHandler());

    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText('Scans (30 j)')).toBeInTheDocument();

    // The initial load never bypasses the server cache.
    const initialAnalyticsCalls = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes('/api/analytics'),
    );
    expect(initialAnalyticsCalls.length).toBeGreaterThan(0);
    expect(initialAnalyticsCalls.every(([input]) => !String(input).includes('fresh=1'))).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Actualiser' }));

    // Every analytics request of the refresh carries the cache bypass; the
    // rewards odds read is uncached server-side and must not gain the param.
    await waitFor(() => {
      const refreshed = fetchMock.mock.calls.filter(([input]) => String(input).includes('fresh=1'));
      expect(refreshed.length).toBeGreaterThanOrEqual(5);
    });
    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls.some((url) => url.includes('/api/analytics/timeseries') && url.includes('fresh=1'))).toBe(true);
    expect(urls.some((url) => url.includes('/api/analytics/funnel') && url.includes('fresh=1'))).toBe(true);
    expect(urls.some((url) => url.includes('/api/analytics/rankings') && url.includes('fresh=1'))).toBe(true);
    expect(urls.some((url) => url.includes('/api/analytics/overview') && url.includes('fresh=1'))).toBe(true);
    expect(urls.some((url) => url.includes('/api/business/rewards') && url.includes('fresh=1'))).toBe(false);

    // The refreshed data still renders.
    expect(await screen.findByText('Scans (30 j)')).toBeInTheDocument();
  });
});
