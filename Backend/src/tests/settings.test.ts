import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../types';
import { handleSettingsRoute } from '../routes/settings';
import { hashPassword, sha256Hex, verifyPassword } from '../lib/crypto';
import { createTestEnv, type TestDatabase } from './helpers/d1';
import { jsonRequest, seedMerchant, type SeededMerchant } from './helpers/fixtures';

let db: TestDatabase;
let env: Env;
let alice: SeededMerchant;

async function body(response: Response) {
  return (await response.json()) as Record<string, any>;
}

beforeEach(async () => {
  env = createTestEnv() as unknown as Env;
  db = (env as unknown as { DB: TestDatabase }).DB;
  alice = await seedMerchant(db, { businessName: 'Profile Shop' });
});

afterEach(() => {
  db.close();
});

describe('profile', () => {
  it('returns the signed in profile with its businesses', async () => {
    const response = await handleSettingsRoute(jsonRequest('/api/profile', 'GET', undefined, alice.token), env);
    const payload = await body(response);

    expect(response.status).toBe(200);
    expect(payload.profile.email).toContain('owner-');
    expect(payload.profile.firstName).toBe('Ada');
    expect(payload.profile.businesses[0].name).toBe('Profile Shop');
  });

  it('rejects unauthenticated calls', async () => {
    const response = await handleSettingsRoute(jsonRequest('/api/profile', 'GET'), env);
    expect(response.status).toBe(401);
  });

  it('updates first and last name', async () => {
    const response = await handleSettingsRoute(
      jsonRequest('/api/profile', 'PUT', { firstName: 'Grace', lastName: 'Hopper' }, alice.token),
      env,
    );
    const payload = await body(response);

    expect(response.status).toBe(200);
    expect(payload.profile.firstName).toBe('Grace');
    expect(payload.profile.lastName).toBe('Hopper');
  });

  it('refuses an empty profile update', async () => {
    const response = await handleSettingsRoute(jsonRequest('/api/profile', 'PUT', {}, alice.token), env);
    expect(response.status).toBe(400);
  });
});

describe('password change', () => {
  async function seedPasswordUser(password: string): Promise<SeededMerchant> {
    const merchant = await seedMerchant(db, { businessName: 'Password Shop' });
    const hashed = await hashPassword(password);

    db.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?')
      .bind(hashed.hash, hashed.salt, merchant.userId)
      .run();

    return merchant;
  }

  it('rejects the wrong current password', async () => {
    const merchant = await seedPasswordUser('original123');

    const response = await handleSettingsRoute(
      jsonRequest('/api/profile/password', 'POST', { currentPassword: 'wrong-pass', newPassword: 'brandnew123' }, merchant.token),
      env,
    );

    expect(response.status).toBe(401);
    expect((await body(response)).message).toBe('Your current password is incorrect.');
  });

  it('accepts the right password and signs other sessions out', async () => {
    const merchant = await seedPasswordUser('original123');
    const otherToken = `cf_${crypto.randomUUID().replace(/-/g, '')}.${crypto.randomUUID().replace(/-/g, '')}`;
    const otherHash = await sha256Hex(otherToken);

    db.prepare('INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(
        crypto.randomUUID(),
        merchant.userId,
        otherHash,
        new Date().toISOString(),
        new Date(Date.now() + 86400_000).toISOString(),
      )
      .run();

    const response = await handleSettingsRoute(
      jsonRequest('/api/profile/password', 'POST', { currentPassword: 'original123', newPassword: 'brandnew123' }, merchant.token),
      env,
    );

    expect(response.status).toBe(200);

    const remaining = db.query<{ token_hash: string }>('SELECT token_hash FROM sessions WHERE user_id = ?', merchant.userId);
    expect(remaining).toHaveLength(1);

    const account = db.query<{ password_hash: string; salt: string }>(
      'SELECT password_hash, salt FROM users WHERE id = ?',
      merchant.userId,
    );
    expect(await verifyPassword('brandnew123', account[0].salt, account[0].password_hash)).toBe(true);
    expect(await verifyPassword('original123', account[0].salt, account[0].password_hash)).toBe(false);
  });
});

describe('settings', () => {
  it('returns defaults for a fresh business', async () => {
    const response = await handleSettingsRoute(jsonRequest('/api/settings', 'GET', undefined, alice.token), env);
    const payload = await body(response);

    expect(response.status).toBe(200);
    expect(payload.settings.name).toBe('Profile Shop');
    expect(payload.settings.googleMapsUrl).toBe('');
    expect(payload.settings.facebookUrl).toBe('');
    expect(payload.settings.instagramUrl).toBe('');
    expect(payload.settings.primaryColor).toBe('#4f46e5');
    expect(payload.settings.notifications).toEqual({ email: true, sms: false, push: false });
  });

  it('persists google, facebook and instagram urls', async () => {
    const response = await handleSettingsRoute(
      jsonRequest(
        '/api/settings',
        'PUT',
        {
          googleMapsUrl: 'https://maps.google.com/?cid=abc',
          googleMapsName: 'Beachside Cafe',
          facebookUrl: 'https://facebook.com/beachside',
          instagramUrl: 'https://instagram.com/beachside',
          primaryColor: '#10b981',
          notifications: { email: true, sms: true, push: false },
        },
        alice.token,
      ),
      env,
    );
    const payload = await body(response);

    expect(response.status).toBe(200);
    expect(payload.settings.googleMapsUrl).toBe('https://maps.google.com/?cid=abc');
    expect(payload.settings.googleMapsName).toBe('Beachside Cafe');
    expect(payload.settings.facebookUrl).toBe('https://facebook.com/beachside');
    expect(payload.settings.instagramUrl).toBe('https://instagram.com/beachside');
    expect(payload.settings.primaryColor).toBe('#10b981');
    expect(payload.settings.notifications).toEqual({ email: true, sms: true, push: false });

    const stored = db.query<{ google_maps_url: string; facebook_url: string; instagram_url: string }>(
      'SELECT google_maps_url, facebook_url, instagram_url FROM business_settings WHERE business_id = ?',
      alice.businessId,
    );
    expect(stored[0].google_maps_url).toBe('https://maps.google.com/?cid=abc');
    expect(stored[0].facebook_url).toBe('https://facebook.com/beachside');
    expect(stored[0].instagram_url).toBe('https://instagram.com/beachside');
  });

  it('rejects an invalid url', async () => {
    const response = await handleSettingsRoute(
      jsonRequest('/api/settings', 'PUT', { facebookUrl: 'not a url' }, alice.token),
      env,
    );

    expect(response.status).toBe(400);
    expect((await body(response)).message).toBe('Validation failed.');
  });

  it('404s when the merchant has no business', async () => {
    const solo = await seedMerchant(db, { withBusiness: false });
    const response = await handleSettingsRoute(jsonRequest('/api/settings', 'GET', undefined, solo.token), env);
    expect(response.status).toBe(404);
  });
});

describe('billing', () => {
  it('lists the seeded plans with parsed features', async () => {
    const response = await handleSettingsRoute(jsonRequest('/api/billing', 'GET', undefined, alice.token), env);
    const payload = await body(response);

    expect(response.status).toBe(200);
    expect(payload.plans.map((plan: any) => plan.slug)).toEqual(['starter', 'growth', 'scale']);
    expect(payload.plans[0].features.limits.campaigns).toBe(1);
    expect(payload.plans[2].features.limits.campaigns).toBe(-1);
    expect(payload.subscription).toBeNull();
    expect(payload.usage).toEqual({ campaigns: 0, customers: 0 });
  });

  it('starts on no plan and switches to growth', async () => {
    const response = await handleSettingsRoute(
      jsonRequest('/api/billing/change-plan', 'POST', { planSlug: 'growth' }, alice.token),
      env,
    );
    const payload = await body(response);

    expect(response.status).toBe(200);
    expect(payload.subscription.plan.slug).toBe('growth');
    expect(payload.subscription.status).toBe('active');

    const stored = db.query<{ plan_id: string }>('SELECT plan_id FROM subscriptions WHERE business_id = ?', alice.businessId);
    expect(stored).toHaveLength(1);
    expect(stored[0].plan_id).toBe('plan_growth');
  });

  it('updates the existing subscription instead of stacking rows', async () => {
    await handleSettingsRoute(jsonRequest('/api/billing/change-plan', 'POST', { planSlug: 'growth' }, alice.token), env);
    await handleSettingsRoute(jsonRequest('/api/billing/change-plan', 'POST', { planSlug: 'scale' }, alice.token), env);

    const stored = db.query<{ plan_id: string }>('SELECT plan_id FROM subscriptions WHERE business_id = ?', alice.businessId);
    expect(stored).toHaveLength(1);
    expect(stored[0].plan_id).toBe('plan_scale');
  });

  it('rejects an unknown plan slug', async () => {
    const response = await handleSettingsRoute(
      jsonRequest('/api/billing/change-plan', 'POST', { planSlug: 'enterprise' }, alice.token),
      env,
    );
    expect(response.status).toBe(400);
  });

  it('404s when the merchant has no business', async () => {
    const solo = await seedMerchant(db, { withBusiness: false });
    const response = await handleSettingsRoute(jsonRequest('/api/billing', 'GET', undefined, solo.token), env);
    expect(response.status).toBe(404);
  });
});
