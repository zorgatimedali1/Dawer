import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomerService } from '@/services/customer.service';
import { CouponService } from '@/services/coupon.service';
import { RewardService } from '@/services/reward.service';
import { QrCodeService } from '@/services/qr.service';
import { PosterService } from '@/services/poster.service';
import { CampaignService } from '@/services/campaign.service';

const AUTH_KEY = 'campaign-engage-auth';

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mockFetch(handler: (input: string, init?: RequestInit) => Response) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

beforeEach(() => {
  window.localStorage.setItem(AUTH_KEY, JSON.stringify({ token: 'cf_abc.def' }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('session credential', () => {
  it('sends same-origin credentials and no bearer header', async () => {
    const spy = mockFetch(() => jsonResponse({ success: true, customers: [], total: 0, page: 1, limit: 20 }));

    await CustomerService.list();

    const init = spy.mock.calls[0]?.[1];
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.authorization).toBeUndefined();
    expect(init?.credentials).toBe('same-origin');
  });

  it('throws the server message and drops the cached session when rejected', async () => {
    mockFetch(() => jsonResponse({ success: false, message: 'Authentication required.' }, 401));
    await expect(CustomerService.list()).rejects.toThrow('Authentication required.');
    expect(window.localStorage.getItem(AUTH_KEY)).toBeNull();
  });
});

describe('customer mapping', () => {
  it('normalises rows and derives engagement status', async () => {
    mockFetch(() =>
      jsonResponse({
        success: true,
        total: 1,
        page: 1,
        limit: 20,
        customers: [
          {
            id: 'c1',
            first_name: 'Ada',
            last_name: 'Lovelace',
            email: 'ada@example.test',
            phone: '555',
            birthday: null,
            marketing_consent: 1,
            created_at: '2026-01-01T00:00:00.000Z',
            last_activity_at: '2026-02-01T00:00:00.000Z',
            participation_count: 3,
            coupon_count: 2,
            redeemed_count: 1,
          },
        ],
      }),
    );

    const result = await CustomerService.list();

    expect(result.customers[0]).toMatchObject({
      name: 'Ada Lovelace',
      marketingConsent: true,
      participationCount: 3,
      redeemedCount: 1,
      status: 'active',
    });
  });

  it('marks a customer with no participations as new', async () => {
    mockFetch(() =>
      jsonResponse({
        success: true,
        total: 1,
        page: 1,
        limit: 20,
        customers: [
          {
            id: 'c2',
            first_name: 'New',
            last_name: 'Customer',
            email: 'new@example.test',
            phone: null,
            birthday: null,
            marketing_consent: 0,
            created_at: '2026-01-01T00:00:00.000Z',
            last_activity_at: null,
            participation_count: 0,
            coupon_count: 0,
            redeemed_count: 0,
          },
        ],
      }),
    );

    const result = await CustomerService.list();
    expect(result.customers[0]?.status).toBe('new');
  });
});

describe('coupon mapping and redemption', () => {
  it('lowercases status and resolves display names', async () => {
    mockFetch(() =>
      jsonResponse({
        success: true,
        total: 1,
        page: 1,
        limit: 20,
        coupons: [
          {
            id: 'cp1',
            code: 'SUMMER5',
            status: 'REDEEMED',
            issued_at: '2026-01-01T00:00:00.000Z',
            expires_at: null,
            redeemed_at: '2026-01-05T00:00:00.000Z',
            campaign_id: 'ca1',
            campaign_name: 'Summer',
            reward_name: '5% OFF',
            first_name: 'Ada',
            last_name: 'Lovelace',
            email: 'ada@example.test',
          },
        ],
      }),
    );

    const result = await CouponService.list();

    expect(result.coupons[0]).toMatchObject({
      status: 'redeemed',
      customerName: 'Ada Lovelace',
      rewardName: '5% OFF',
      campaignName: 'Summer',
    });
  });

  it('flags an issued coupon past its expiry as expired', async () => {
    mockFetch(() =>
      jsonResponse({
        success: true,
        total: 1,
        page: 1,
        limit: 20,
        coupons: [
          {
            id: 'cp2',
            code: 'OLD',
            status: 'ISSUED',
            issued_at: '2026-01-01T00:00:00.000Z',
            expires_at: '2026-01-02T00:00:00.000Z',
            redeemed_at: null,
            campaign_id: 'ca1',
            campaign_name: 'Summer',
            reward_name: '5% OFF',
            first_name: null,
            last_name: null,
            email: null,
          },
        ],
      }),
    );

    const result = await CouponService.list();
    expect(result.coupons[0]?.status).toBe('expired');
  });

  it('posts to the redeem endpoint', async () => {
    const spy = mockFetch(() =>
      jsonResponse({ success: true, coupon: { code: 'SUMMER5', redeemed_at: '2026-01-05T00:00:00.000Z' } }),
    );

    const result = await CouponService.redeem('cp1');

    expect(String(spy.mock.calls[0]?.[0])).toBe('/api/business/coupons/cp1/redeem');
    expect(spy.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(result).toEqual({ code: 'SUMMER5', redeemedAt: '2026-01-05T00:00:00.000Z' });
  });
});

describe('reward and qr mapping', () => {
  it('maps reward stock, weight and active flag', async () => {
    mockFetch(() =>
      jsonResponse({
        success: true,
        rewards: [
          {
            id: 'r1',
            campaign_id: 'ca1',
            campaign_name: 'Summer',
            name: 'Free coffee',
            type: 'free_product',
            value: '1',
            description: '',
            quantity: 5,
            quantity_initial: 10,
            weight: 50,
            active: 1,
            issued_count: 4,
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    );

    const rewards = await RewardService.list();

    expect(rewards[0]).toMatchObject({
      campaignName: 'Summer',
      quantity: 5,
      quantityInitial: 10,
      active: true,
      issuedCount: 4,
    });
  });

  it('builds the shareable campaign link for a QR code', async () => {
    mockFetch(() =>
      jsonResponse({
        success: true,
        qrCodes: [
          {
            id: 'q1',
            campaign_id: 'ca1',
            campaign_name: 'Summer',
            campaign_public_code: 'PUBLIC123',
            public_code: 'AABBCCDD',
            name: 'Counter',
            location: 'Till',
            active: 1,
            created_at: '2026-01-01T00:00:00.000Z',
            campaign_participations: 7,
          },
        ],
      }),
    );

    const codes = await QrCodeService.list();

    expect(codes[0]?.url).toBe(`${window.location.origin}/wheels/PUBLIC123`);
    expect(codes[0]?.active).toBe(true);
    expect(codes[0]?.campaignParticipations).toBe(7);
  });
});

describe('campaign service', () => {
  it('converts backend rows into the view model', async () => {
    mockFetch(() =>
      jsonResponse({
        success: true,
        campaigns: [
          {
            id: 'ca1',
            name: 'Summer',
            description: null,
            public_code: 'PUBLIC123',
            status: 'ACTIVE',
            start_at: '2026-01-01T00:00:00.000Z',
            end_at: '2026-01-31T00:00:00.000Z',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-02T00:00:00.000Z',
            participant_count: 4,
            reward_count: 2,
            redemption_count: 2,
          },
        ],
      }),
    );

    const campaigns = await CampaignService.getCampaigns();

    expect(campaigns[0]).toMatchObject({
      status: 'active',
      publicCode: 'PUBLIC123',
      participantCount: 4,
      conversionRate: 50,
    });
  });

  it('returns null when a single campaign is not found', async () => {
    mockFetch(() => jsonResponse({ success: false, message: 'Campaign not found.' }, 404));
    await expect(CampaignService.getCampaignById('missing')).resolves.toBeNull();
  });
});

describe('poster service', () => {
  it('parses the stored configuration and falls back when it is broken', async () => {
    mockFetch(() =>
      jsonResponse({
        success: true,
        posters: [
          {
            id: 'p1',
            campaign_id: 'ca1',
            campaign_name: 'Summer',
            template: 'gradient',
            title: 'Win big',
            subtitle: 'Scan me',
            theme: '#10b981',
            configuration: '{"hue":120}',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
          {
            id: 'p2',
            campaign_id: 'ca1',
            campaign_name: 'Summer',
            template: 'minimal',
            title: 'Plain',
            subtitle: '',
            theme: '#4f46e5',
            configuration: 'not json',
            updated_at: '2026-01-02T00:00:00.000Z',
          },
        ],
      }),
    );

    const posters = await PosterService.list({ campaignId: 'ca1' });

    expect(posters[0]?.configuration).toEqual({ hue: 120 });
    expect(posters[1]?.configuration).toBeNull();
    expect(posters[0]?.campaignName).toBe('Summer');
  });

  it('posts the draft payload when creating', async () => {
    const spy = mockFetch(() =>
      jsonResponse({
        success: true,
        poster: {
          id: 'p3',
          campaign_id: 'ca1',
          campaign_name: 'Summer',
          template: 'gradient',
          title: 'New',
          subtitle: 'Sub',
          theme: '#ef4444',
          configuration: null,
          updated_at: '2026-01-03T00:00:00.000Z',
        },
      }),
    );

    const poster = await PosterService.create({
      campaignId: 'ca1',
      title: 'New',
      subtitle: 'Sub',
      theme: '#ef4444',
    });

    expect(spy.mock.calls[0]?.[0]).toBe('/api/business/posters');
    expect(spy.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(poster.title).toBe('New');
  });

  it('throws the server message when saving is refused', async () => {
    mockFetch(() => jsonResponse({ success: false, message: 'Poster not found.' }, 404));
    await expect(PosterService.update('missing', { title: 'x' })).rejects.toThrow('Poster not found.');
  });
});
