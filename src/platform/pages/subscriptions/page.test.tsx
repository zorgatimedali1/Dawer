import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SubscriptionsPage from '@/platform/pages/subscriptions/page';

const request = {
  id: 'req-1',
  status: 'PENDING',
  durationDays: null,
  rejectReason: null,
  requestedAt: '2026-01-05T00:00:00.000Z',
  resolvedAt: null,
  resolvedBy: null,
  userId: 'u1',
  businessId: 'b1',
  email: 'merchant@example.test',
  businessName: 'Merchant Shop',
  plan: { name: 'Premium', slug: 'premium' },
  priceCents: 19900,
  interval: 'year',
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url.includes('/approve')) {
      expect(JSON.parse(String(init?.body))).toMatchObject({ durationDays: expect.any(Number) });
      return jsonResponse({ success: true, currentPeriodEnd: '2026-04-05T00:00:00.000Z' });
    }
    if (url.includes('/reject')) {
      return jsonResponse({ success: true });
    }
    if (url.startsWith('/api/admin/subscriptions')) {
      return jsonResponse({
        success: true,
        requests: [request],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      });
    }

    return jsonResponse({ success: false, error: 'Route not found.' }, 404);
  });
}

describe('platform subscriptions page', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lists the pending request with its plan and merchant', async () => {
    vi.stubGlobal('fetch', createFetch());
    render(<SubscriptionsPage />);

    expect(await screen.findByText('merchant@example.test')).toBeInTheDocument();
    expect(screen.getByText('Merchant Shop')).toBeInTheDocument();
    expect(screen.getByText('Premium')).toBeInTheDocument();
    expect(screen.getByText('199.00 DT/1 year')).toBeInTheDocument();
    expect(screen.getByText('1 request')).toBeInTheDocument();
  });

  it('activates a request with a duration preset', async () => {
    const fetchMock = createFetch();
    vi.stubGlobal('fetch', fetchMock);
    render(<SubscriptionsPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Activate' }));

    const dialog = await screen.findByText('Activate Premium');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText(/starts now and ends/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '3 mois' }));
    await userEvent.click(screen.getByRole('button', { name: 'Activate subscription' }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/req-1/approve'))).toBe(true),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Subscription activated.');
    expect(screen.queryByText('Activate Premium')).not.toBeInTheDocument();
  });

  it('rejects a request only once a reason is written', async () => {
    const fetchMock = createFetch();
    vi.stubGlobal('fetch', fetchMock);
    render(<SubscriptionsPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    await screen.findByText('Reject this request');

    const confirm = screen.getByRole('button', { name: 'Reject request' });
    expect(confirm).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Reason'), 'no payment');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/req-1/reject'))).toBe(true),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Request rejected.');
  });
});
