import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '@/services/settings.service';
import { BillingService } from '@/services/billing.service';

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

describe('settings service', () => {
  it('loads the profile with the bearer token', async () => {
    const spy = mockFetch(() =>
      jsonResponse({
        success: true,
        profile: {
          id: 'u1',
          email: 'ada@example.test',
          firstName: 'Ada',
          lastName: 'Lovelace',
          avatarUrl: '',
          emailVerified: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          businesses: [{ id: 'b1', name: 'Shop', slug: 'shop', role: 'OWNER' }],
        },
      }),
    );

    const profile = await SettingsService.getProfile();

    expect(profile.firstName).toBe('Ada');
    expect(profile.businesses[0]?.slug).toBe('shop');
    const headers = spy.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer cf_abc.def');
  });

  it('surfaces the 404 when no business exists yet', async () => {
    mockFetch(() => jsonResponse({ success: false, message: 'Create a business before configuring settings.' }, 404));
    await expect(SettingsService.getSettings()).rejects.toThrow('Create a business before configuring settings.');
  });

  it('sends only the changed settings', async () => {
    const spy = mockFetch(() =>
      jsonResponse({
        success: true,
        settings: {
          name: 'Shop',
          description: '',
          website: '',
          phone: '',
          email: '',
          address: '',
          timezone: 'UTC',
          logo: '',
          googleMapsName: '',
          googleMapsUrl: 'https://maps.google.com/?cid=abc',
          googlePlaceId: '',
          facebookUrl: '',
          instagramUrl: '',
          primaryColor: '#4f46e5',
          secondaryColor: '#10b981',
          notifications: { email: true, sms: false, push: false },
        },
      }),
    );

    const updated = await SettingsService.updateSettings({ googleMapsUrl: 'https://maps.google.com/?cid=abc' });

    expect(spy.mock.calls[0]?.[0]).toBe('/api/settings');
    expect(spy.mock.calls[0]?.[1]?.method).toBe('PUT');
    expect(JSON.parse(String(spy.mock.calls[0]?.[1]?.body))).toEqual({
      googleMapsUrl: 'https://maps.google.com/?cid=abc',
    });
    expect(updated.googleMapsUrl).toBe('https://maps.google.com/?cid=abc');
  });

  it('posts the password change payload', async () => {
    const spy = mockFetch(() => jsonResponse({ success: true, message: 'Password updated.' }));

    const message = await SettingsService.changePassword('current123', 'brandnew123');

    expect(message).toBe('Password updated.');
    expect(spy.mock.calls[0]?.[0]).toBe('/api/profile/password');
    expect(JSON.parse(String(spy.mock.calls[0]?.[1]?.body))).toEqual({
      currentPassword: 'current123',
      newPassword: 'brandnew123',
    });
  });
});

describe('billing service', () => {
  it('maps plan features with a safe fallback', async () => {
    mockFetch(() =>
      jsonResponse({
        success: true,
        plans: [
          {
            id: 'plan_starter',
            name: 'Starter',
            slug: 'starter',
            priceCents: 2900,
            interval: 'month',
            features: { limits: { campaigns: 1, customers: 100 }, features: ['1 campagne active'] },
          },
          { id: 'plan_x', name: 'X', slug: 'x', priceCents: 0, interval: 'month', features: null },
        ],
        subscription: null,
        usage: { campaigns: 3, customers: 892 },
      }),
    );

    const billing = await BillingService.get();

    expect(billing.plans[0]?.features.limits.campaigns).toBe(1);
    expect(billing.plans[1]?.features.limits).toEqual({ campaigns: 0, customers: 0 });
    expect(billing.plans[1]?.features.features).toEqual([]);
    expect(billing.subscription).toBeNull();
    expect(billing.usage).toEqual({ campaigns: 3, customers: 892 });
  });

  it('posts the plan slug when switching', async () => {
    const spy = mockFetch(() =>
      jsonResponse({
        success: true,
        plans: [],
        subscription: {
          id: 's1',
          status: 'active',
          currentPeriodEnd: null,
          plan: { id: 'plan_growth', name: 'Growth', slug: 'growth', priceCents: 7900, interval: 'month' },
        },
        usage: { campaigns: 0, customers: 0 },
      }),
    );

    const billing = await BillingService.changePlan('growth');

    expect(spy.mock.calls[0]?.[0]).toBe('/api/billing/change-plan');
    expect(JSON.parse(String(spy.mock.calls[0]?.[1]?.body))).toEqual({ planSlug: 'growth' });
    expect(billing.subscription?.plan.slug).toBe('growth');
  });

  it('throws the server message on failure', async () => {
    mockFetch(() => jsonResponse({ success: false, message: 'Plan not found.' }, 404));
    await expect(BillingService.changePlan('nope')).rejects.toThrow('Plan not found.');
  });
});
