import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CustomersPage from '@/app/dashboard/customers/page';

const customer = {
  id: 'customer-1',
  first_name: 'Ada',
  last_name: 'Lovelace',
  email: '',
  phone: '+21622111222',
  birthday: null,
  marketing_consent: 0,
  created_at: '2026-01-01T00:00:00.000Z',
  last_activity_at: '2026-09-01T00:00:00.000Z',
  participation_count: 1,
  coupon_count: 1,
  redeemed_count: 0,
};

const coupon = {
  id: 'coupon-1',
  campaign_id: 'campaign-1',
  reward_id: 'reward-1',
  reward_name: 'Free coffee',
  campaign_name: 'Morning offer',
  code: 'COFFEE123',
  status: 'ISSUED',
  issued_at: '2026-09-01T00:00:00.000Z',
  expires_at: null,
  redeemed_at: null,
};

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Customers page prize management', () => {
  beforeEach(() => {
    window.localStorage.setItem('campaign-engage-auth', JSON.stringify({ token: 'test-token' }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('shows customer prize history and updates owed/given status and deadline', async () => {
    let savedCoupon = {
      ...coupon,
      expires_at: coupon.expires_at as string | null,
      redeemed_at: coupon.redeemed_at as string | null,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/business/customers/customer-1')) {
        return jsonResponse({
          success: true,
          customer,
          participations: [],
          coupons: savedCoupon.status === 'DELETED' ? [] : [savedCoupon],
        });
      }
      if (url.includes('/api/business/customers')) {
        return jsonResponse({ success: true, customers: [customer], total: 1, page: 1, limit: 50 });
      }
      if (url.includes('/api/business/coupons/coupon-1') && init?.method === 'PATCH') {
        const input = JSON.parse(String(init.body)) as { status?: string; expiresAt?: string };
        savedCoupon = {
          ...savedCoupon,
          status: input.status ?? savedCoupon.status,
          expires_at: input.expiresAt ?? savedCoupon.expires_at,
          redeemed_at: input.status === 'REDEEMED' ? '2026-09-02T00:00:00.000Z' : savedCoupon.redeemed_at,
        };
        return jsonResponse({ success: true, coupon: savedCoupon });
      }
      if (url.includes('/api/business/coupons/coupon-1') && init?.method === 'DELETE') {
        savedCoupon = { ...savedCoupon, status: 'DELETED' };
        return jsonResponse({ success: true });
      }
      return jsonResponse({ success: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CustomersPage />);
    await screen.findByText('Ada Lovelace');
    await userEvent.click(screen.getByRole('button', { name: /voir les prix/i }));

    await screen.findByText('Free coffee');
  expect(screen.queryByRole('button', { name: /supprimer free coffee/i })).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Statut du prix'), 'REDEEMED');
    await waitFor(() => {
      const statusUpdate = fetchMock.mock.calls.find(([input, init]) =>
        String(input).includes('/api/business/coupons/coupon-1') && init?.method === 'PATCH',
      );
      expect(statusUpdate).toBeTruthy();
      expect(JSON.parse(String(statusUpdate?.[1]?.body))).toEqual({ status: 'REDEEMED' });
    });
    await screen.findByRole('button', { name: /supprimer free coffee/i });
    const deadline = screen.getByLabelText('Échéance');
    await userEvent.clear(deadline);
    await userEvent.type(deadline, '2026-12-01');
    await userEvent.click(screen.getByRole('button', { name: /enregistrer/i }));

    await waitFor(() => {
      const updateCall = fetchMock.mock.calls.find(([input, init]) =>
        String(input).includes('/api/business/coupons/coupon-1') &&
        init?.method === 'PATCH' &&
        JSON.parse(String(init.body)).expiresAt,
      );
      expect(updateCall).toBeTruthy();
      expect(JSON.parse(String(updateCall?.[1]?.body))).toEqual({
        expiresAt: '2026-12-01T23:59:59.999Z',
      });
    });

    await userEvent.click(await screen.findByRole('button', { name: /supprimer free coffee/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmer' }));

    await screen.findByText('Aucun prix enregistré pour ce client.');
    expect(fetchMock.mock.calls.some(([input, init]) =>
      String(input).includes('/api/business/coupons/coupon-1') && init?.method === 'DELETE',
    )).toBe(true);
  });
});