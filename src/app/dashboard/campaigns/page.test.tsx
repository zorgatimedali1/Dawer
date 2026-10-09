import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CampaignsPage from '@/app/dashboard/campaigns/page';

const AUTH_KEY = 'campaign-engage-auth';

interface CampaignRow {
  id: string;
  name: string;
  description: string;
  public_code: string;
  status: string;
  start_at: string | null;
  end_at: string | null;
  created_at: string;
  updated_at: string;
  participant_count: number;
  reward_count: number;
  redemption_count: number;
}

function campaignRow(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return {
    id: 'campaign-1',
    name: 'Autumn promo',
    description: 'Seasonal offer',
    public_code: 'ABCDEF012345',
    status: 'DRAFT',
    start_at: '2026-10-10T00:00:00.000Z',
    end_at: '2026-10-20T23:59:59.999Z',
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    participant_count: 0,
    reward_count: 1,
    redemption_count: 0,
    ...overrides,
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mockCampaignApi(initial: CampaignRow[] = []) {
  const campaigns = [...initial];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();

    if (method === 'GET' && url.startsWith('/api/business/campaigns') && !url.match(/\/api\/business\/campaigns\/[^/?]+$/)) {
      return jsonResponse({ success: true, campaigns, total: campaigns.length });
    }

    if (method === 'POST' && url === '/api/business/campaigns') {
      const body = JSON.parse(String(init?.body)) as {
        name: string;
        description: string;
        status: string;
        startAt: string;
        endAt: string;
      };
      const created = campaignRow({
        id: 'campaign-created',
        name: body.name,
        description: body.description,
        status: body.status,
        start_at: body.startAt,
        end_at: body.endAt,
      });
      campaigns.unshift(created);
      return jsonResponse({ success: true, campaign: { id: created.id, publicCode: created.public_code } }, 201);
    }

    const itemMatch = /^\/api\/business\/campaigns\/([^/?]+)$/.exec(url);
    const target = itemMatch ? campaigns.find((campaign) => campaign.id === itemMatch[1]) : undefined;

    if (method === 'GET' && target) {
      return jsonResponse({ success: true, campaign: target });
    }

    if (method === 'PATCH' && target) {
      const body = JSON.parse(String(init?.body)) as Record<string, string>;
      if (body.name !== undefined) target.name = body.name;
      if (body.description !== undefined) target.description = body.description;
      if (body.status !== undefined) target.status = body.status;
      if (body.startAt !== undefined) target.start_at = body.startAt || null;
      if (body.endAt !== undefined) target.end_at = body.endAt || null;
      return jsonResponse({ success: true, campaign: target });
    }

    if (method === 'DELETE' && target) {
      const archived = target.participant_count > 0;
      if (archived) target.status = 'ARCHIVED';
      else campaigns.splice(campaigns.indexOf(target), 1);
      return jsonResponse({ success: true, archived });
    }

    throw new Error(`Unexpected request: ${method} ${url}`);
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage() {
  return render(
    <MemoryRouter>
      <CampaignsPage />
    </MemoryRouter>,
  );
}

describe('campaign management page', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(
      AUTH_KEY,
      JSON.stringify({ token: 'cf_abc.def', user: { id: 'u1', email: 'ada@example.test', role: 'merchant' } }),
    );
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('creates a campaign with a start date, end date, and selected status', async () => {
    const fetchMock = mockCampaignApi();
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Nouvelle campagne' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Nom de la campagne'), 'New season');
    await userEvent.selectOptions(within(dialog).getByLabelText('Statut'), 'active');

    const startDate = (within(dialog).getByLabelText('Du') as HTMLInputElement).value;
    const endDate = (within(dialog).getByLabelText('Au') as HTMLInputElement).value;
    expect(startDate).not.toBe('');
    expect(endDate).not.toBe('');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Créer la campagne' }));

    await screen.findByRole('heading', { name: 'New season' });
    const createCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
      name: 'New season',
      status: 'ACTIVE',
      startAt: `${startDate}T00:00:00.000Z`,
      endAt: `${endDate}T23:59:59.999Z`,
    });
  });

  it('edits campaign dates and switches an active campaign to paused', async () => {
    const fetchMock = mockCampaignApi([campaignRow({ status: 'ACTIVE' })]);
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Modifier' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.clear(within(dialog).getByLabelText('Du'));
    await userEvent.type(within(dialog).getByLabelText('Du'), '2026-11-01');
    await userEvent.clear(within(dialog).getByLabelText('Au'));
    await userEvent.type(within(dialog).getByLabelText('Au'), '2026-11-30');
    await userEvent.selectOptions(within(dialog).getByLabelText('Statut'), 'paused');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer les modifications' }));

    await screen.findByText('Campagne mise à jour.');
    const updateCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(JSON.parse(String(updateCall?.[1]?.body))).toMatchObject({
      status: 'PAUSED',
      startAt: '2026-11-01T00:00:00.000Z',
      endAt: '2026-11-30T23:59:59.999Z',
    });
  });

  it('requires confirmation before removing a campaign with participation history', async () => {
    const fetchMock = mockCampaignApi([campaignRow({ participant_count: 8 })]);
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Modifier' }));
    await userEvent.click(screen.getByRole('button', { name: 'Supprimer la campagne' }));
    const confirmation = screen.getByRole('alertdialog', { name: 'Confirmer la suppression de la campagne' });
    await userEvent.click(within(confirmation).getByRole('button', { name: 'Confirmer la suppression' }));

    await screen.findByText(/archivée car elle a déjà un historique de participations/i);
    expect(screen.getByText('Archivée')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true);
  });

  it('permanently deletes a campaign that has no participation history', async () => {
    mockCampaignApi([campaignRow({ participant_count: 0 })]);
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Modifier' }));
    await userEvent.click(screen.getByRole('button', { name: 'Supprimer la campagne' }));
    const confirmation = screen.getByRole('alertdialog', { name: 'Confirmer la suppression de la campagne' });
    await userEvent.click(within(confirmation).getByRole('button', { name: 'Confirmer la suppression' }));

    await screen.findByText('Campagne supprimée.');
    expect(screen.queryByRole('heading', { name: 'Autumn promo' })).toBeNull();
  });
});