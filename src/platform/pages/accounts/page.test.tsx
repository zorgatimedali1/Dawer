import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AccountsPage from '@/platform/pages/accounts/page';

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const account = {
  id: 'u1',
  email: 'merchant@example.test',
  firstName: 'Ada',
  lastName: 'Lovelace',
  avatarUrl: null,
  status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-02-01T00:00:00.000Z',
  businessCount: 1,
  sessionCount: 2,
};

const detail = {
  success: true,
  account,
  playPolicy: { mode: 'off', perDay: 1, cooldownMinutes: 0 },
  featureAccess: { whatsappEnabled: true, emailEnabled: true },
  wheelTheme: null,
  wheelThemeOverride: null,
  planSlug: 'growth',
  designAllowed: true,
  businesses: [
    {
      id: 'b1',
      name: 'Merchant Shop',
      slug: 'merchant-shop',
      role: 'OWNER',
      playPolicy: { mode: 'off', perDay: 1, cooldownMinutes: 0 },
      planSlug: 'growth',
      whatsappEnabled: true,
      emailEnabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  sessions: [{ id: 's1', createdAt: '2026-02-01T00:00:00.000Z', expiresAt: '2026-02-08T00:00:00.000Z' }],
  identities: [],
  auditTrail: [],
};

function createFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (init?.method === 'DELETE') {
      expect(JSON.parse(String(init.body))).toEqual({ reason: 'duplicate signup' });
      return jsonResponse({ success: true, accountId: 'u1', email: 'merchant@example.test' });
    }
    if (url.includes('/play-policy')) {
      const sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({ success: true, playPolicy: sent, updated: 1 });
    }
    if (url.includes('/wheel-theme')) {
      const sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({ success: true, wheelThemeOverride: sent.clear === true ? null : sent.theme, cleared: sent.clear === true, updatedBusinesses: 1 });
    }
    if (url.includes('/features')) {
      const sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(sent.reason).toBeUndefined();
      return jsonResponse({ success: true, featureAccess: sent, updatedBusinesses: 1 });
    }
    if (url.includes('/suspend')) {
      return jsonResponse({ success: true, accountId: 'u1', status: 'SUSPENDED', revokedSessions: 2 });
    }
    if (url === '/api/admin/accounts/u1') {
      return jsonResponse(detail);
    }
    if (url.startsWith('/api/admin/accounts')) {
      return jsonResponse({
        success: true,
        accounts: [account],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      });
    }

    return jsonResponse({ success: false, message: 'Route not found.' }, 404);
  });
}

describe('platform accounts page', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lists merchant accounts', async () => {
    vi.stubGlobal('fetch', createFetch());
    render(<AccountsPage />);

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('merchant@example.test')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: /Ada Lovelace/ })).getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('1 account')).toBeInTheDocument();
  });

  it('opens an account and suspends it with a reason', async () => {
    const fetchMock = createFetch();
    vi.stubGlobal('fetch', fetchMock);
    render(<AccountsPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Ada Lovelace/ }));

    const suspend = await screen.findByRole('button', { name: 'Suspend' });
    await userEvent.click(suspend);

    const dialog = await screen.findByText('Suspend this account');
    expect(dialog).toBeInTheDocument();

    const confirm = screen.getByRole('button', { name: 'Suspend account' });
    expect(confirm).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Reason'), 'payment overdue');
    expect(confirm).toBeEnabled();

    await userEvent.click(confirm);

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((call) => String(call[0]).includes('/u1/suspend')),
      ).toBe(true),
    );

    expect(await screen.findByRole('status')).toHaveTextContent('Account suspended.');
  });

  it('deletes an account after confirmation and returns to the list', async () => {
    const fetchMock = createFetch();
    vi.stubGlobal('fetch', fetchMock);
    render(<AccountsPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Ada Lovelace/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    const confirm = await screen.findByRole('button', { name: 'Delete account' });
    expect(confirm).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Reason'), 'duplicate signup');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);

    expect(await screen.findByRole('status')).toHaveTextContent('Account deleted.');
    await waitFor(() => expect(screen.queryByText('Delete this account')).not.toBeInTheDocument());
    expect(await screen.findByPlaceholderText('Search by email or name...')).toBeInTheDocument();

    const call = fetchMock.mock.calls.find(
      (entry) => (entry[1] as RequestInit | undefined)?.method === 'DELETE',
    );
    expect(call).toBeDefined();
    expect(String(call?.[0])).toBe('/api/admin/accounts/u1');
  });

  it('saves a once override from the play policy section', async () => {
    const fetchMock = createFetch();
    vi.stubGlobal('fetch', fetchMock);
    render(<AccountsPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Ada Lovelace/ }));

    expect(await screen.findByText('Play policy')).toBeInTheDocument();
    expect(screen.getByLabelText('Policy')).toHaveValue('off');
    expect(screen.queryByLabelText('Spins per day')).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Policy'), 'once');
    await userEvent.click(screen.getByRole('button', { name: 'Save policy' }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/u1/play-policy'))).toBe(true),
    );

    const call = fetchMock.mock.calls.find((entry) => String(entry[0]).includes('/u1/play-policy'));
    expect(JSON.parse(String((call?.[1] as RequestInit).body))).toMatchObject({ mode: 'once' });
    expect(await screen.findByRole('status')).toHaveTextContent('Play policy updated.');
  });

  it('toggles a marketing channel immediately, without a dialog', async () => {
    const fetchMock = createFetch();
    vi.stubGlobal('fetch', fetchMock);
    render(<AccountsPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Ada Lovelace/ }));

    expect(await screen.findByText('Marketing access')).toBeInTheDocument();
    const whatsappSwitch = screen.getByRole('switch', { name: 'WhatsApp marketing' });
    expect(whatsappSwitch).toHaveAttribute('aria-checked', 'true');

    await userEvent.click(whatsappSwitch);

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/u1/features'))).toBe(true),
    );

    const call = fetchMock.mock.calls.find((entry) => String(entry[0]).includes('/u1/features'));
    expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({ whatsappEnabled: false });

    expect(screen.queryByText('Disable WhatsApp marketing')).not.toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent('WhatsApp disabled.');
  });

  it('reveals and submits the limits for the windowed policy', async () => {
    const fetchMock = createFetch();
    vi.stubGlobal('fetch', fetchMock);
    render(<AccountsPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Ada Lovelace/ }));
    await screen.findByText('Play policy');

    await userEvent.selectOptions(screen.getByLabelText('Policy'), 'windowed');

    const perDay = await screen.findByLabelText('Spins per day');
    expect(screen.getByLabelText('Cooldown (minutes)')).toBeInTheDocument();

    await userEvent.clear(perDay);
    await userEvent.type(perDay, '5');
    await userEvent.click(screen.getByRole('button', { name: 'Save policy' }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/u1/play-policy'))).toBe(true),
    );

    const call = fetchMock.mock.calls.find((entry) => String(entry[0]).includes('/u1/play-policy'));
    expect(JSON.parse(String((call?.[1] as RequestInit).body))).toMatchObject({
      mode: 'windowed',
      perDay: 5,
      cooldownMinutes: 0,
    });
  });

  it('applies a wheel design override from the wheel design section', async () => {
    const fetchMock = createFetch();
    vi.stubGlobal('fetch', fetchMock);
    render(<AccountsPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Ada Lovelace/ }));

    expect(await screen.findByText('Wheel design')).toBeInTheDocument();
    expect(screen.getByText('Merchant design in use')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Spin speed'), 'fast');
    await userEvent.click(screen.getByRole('button', { name: 'Apply design' }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/u1/wheel-theme'))).toBe(true),
    );

    const call = fetchMock.mock.calls.find((entry) => String(entry[0]).includes('/u1/wheel-theme'));
    const body = JSON.parse(String((call?.[1] as RequestInit).body)) as {
      theme: { motion: { preset: string } };
    };
    expect(body.theme.motion.preset).toBe('fast');
    expect(await screen.findByRole('status')).toHaveTextContent('Wheel design applied.');
  });

  it('flags a Starter account as design-locked', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/admin/accounts/u1') {
        return jsonResponse({ ...detail, planSlug: 'starter', designAllowed: false });
      }
      if (url.startsWith('/api/admin/accounts')) {
        return jsonResponse({
          success: true,
          accounts: [account],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        });
      }
      return jsonResponse({ success: false, message: 'Route not found.' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<AccountsPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Ada Lovelace/ }));

    expect(await screen.findByTestId('wheel-design-starter')).toHaveTextContent('the starter plan');
  });
});
