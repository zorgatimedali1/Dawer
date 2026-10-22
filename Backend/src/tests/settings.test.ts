import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../types';
import { handlePublicLogoRoute, handlePublicWheelLogoRoute, handleSettingsRoute } from '../routes/settings';
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
  alice = await seedMerchant(db, { businessName: 'Profile Shop', withActiveSubscription: true });
});

afterEach(() => {
  db.close();
});

describe('profile', () => {
  it('returns the signed in profile with its businesses', async () => {
    const response = await handleSettingsRoute(jsonRequest('/api/profile', 'GET', undefined, alice.token), env);
    const payload = await body(response);

    expect(response.status).toBe(200);
    expect(payload.profile.hasPassword).toBe(true);
    expect(payload.profile.email).toContain('owner-');
    expect(payload.profile.firstName).toBe('Ada');
    expect(payload.profile.businesses[0].name).toBe('Profile Shop');
  });

  it('rejects unauthenticated calls', async () => {
    const response = await handleSettingsRoute(jsonRequest('/api/profile', 'GET'), env);
    expect(response.status).toBe(401);
  });

  it('keeps account mutations read-only without an active paid plan but allows plan requests', async () => {
    const trial = await seedMerchant(db, { email: 'trial-settings@example.test', businessName: 'Trial Shop' });
    const profileUpdate = await handleSettingsRoute(
      jsonRequest('/api/profile', 'PUT', { firstName: 'Grace' }, trial.token),
      env,
    );
    expect(profileUpdate.status).toBe(403);

    const request = await handleSettingsRoute(
      jsonRequest('/api/billing/subscribe-request', 'POST', { planSlug: 'growth' }, trial.token),
      env,
    );
    expect(request.status).toBe(200);
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
    const merchant = await seedMerchant(db, { businessName: 'Password Shop', withActiveSubscription: true });
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
    // The route now surfaces the first real Zod message instead of the
    // generic "Validation failed." so users know what to fix.
    expect((await body(response)).message).toBe('Enter a valid http(s) URL.');
  });

  it('404s when the merchant has no business', async () => {
    const solo = await seedMerchant(db, { withBusiness: false });
    const response = await handleSettingsRoute(jsonRequest('/api/settings', 'GET', undefined, solo.token), env);
    expect(response.status).toBe(404);
  });
});

describe('billing', () => {
  it('returns the effective full-access Starter trial and its end date', async () => {
    await db.prepare('DELETE FROM subscriptions WHERE business_id = ?').bind(alice.businessId).run();
    const trialEnd = new Date(Date.now() + 7 * 86_400_000).toISOString();
    await db.prepare(
      `INSERT INTO subscriptions (id, business_id, plan_id, status, current_period_end, created_at, updated_at)
       VALUES (?, ?, 'plan_starter', 'trialing', ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), alice.businessId, trialEnd, new Date().toISOString(), new Date().toISOString())
      .run();

    const payload = await body(await handleSettingsRoute(jsonRequest('/api/billing', 'GET', undefined, alice.token), env));

    expect(payload.access).toMatchObject({
      state: 'trial',
      canManage: true,
      plan: { slug: 'starter', name: 'Starter' },
    });
    expect(payload.access.endsAt).toBe(trialEnd);
  });

  it('returns the subscription period start and end dates', async () => {
    await db.prepare('DELETE FROM subscriptions WHERE business_id = ?').bind(alice.businessId).run();
    const start = '2026-08-01T00:00:00.000Z';
    const end = '2026-11-01T00:00:00.000Z';
    const subscriptionId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO subscriptions (id, business_id, plan_id, status, current_period_end, created_at, updated_at)
       VALUES (?, ?, 'plan_starter', 'active', ?, ?, ?)`,
    )
      .bind(subscriptionId, alice.businessId, end, start, start)
      .run();

    const response = await handleSettingsRoute(jsonRequest('/api/billing', 'GET', undefined, alice.token), env);
    const payload = await body(response);

    expect(payload.subscription.currentPeriodStart).toBe(start);
    expect(payload.subscription.currentPeriodEnd).toBe(end);
    // The shared subscription⋈plans read also feeds the access calculation,
    // so the ids must stay the subscription's own, not the plan's.
    expect(payload.subscription.id).toBe(subscriptionId);
    expect(payload.subscription.plan.id).toBe('plan_starter');
  });

  it('reads the subscription row once per billing request', async () => {
    const spy = vi.spyOn(db, 'prepare');
    try {
      const response = await handleSettingsRoute(jsonRequest('/api/billing', 'GET', undefined, alice.token), env);
      expect(response.status).toBe(200);

      const subscriptionReads = spy.mock.calls.filter(([sql]) => String(sql).includes('FROM subscriptions'));
      // The access calculation reuses the row the response already loaded.
      expect(subscriptionReads).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('lists the seeded plans with parsed features', async () => {
    await db.prepare('DELETE FROM subscriptions WHERE business_id = ?').bind(alice.businessId).run();
    const response = await handleSettingsRoute(jsonRequest('/api/billing', 'GET', undefined, alice.token), env);
    const payload = await body(response);

    expect(response.status).toBe(200);
    expect(payload.plans.map((plan: any) => plan.slug)).toEqual(['starter', 'growth', 'scale', 'premium']);
    expect(payload.plans.map((plan: any) => plan.name)).toEqual(['Starter', 'Pro', 'Business', 'Enterprise']);
    expect(payload.plans[0].priceCents).toBe(14900);
    expect(payload.plans[0].interval).toBe('3_months');
    expect(payload.plans[0].features.limits.customers).toBe(200);
    expect(payload.plans[1].features.limits.customers).toBe(1000);
    expect(payload.plans[1].features.features).toContain('Vue d’ensemble et analytics de base');
    expect(payload.plans[1].interval).toBe('year');
    expect(payload.plans[2].features.limits.customers).toBe(10000);
    expect(payload.plans[2].features.limits.campaigns).toBe(-1);
    expect(payload.plans[2].interval).toBe('2_years');
    expect(payload.plans[3].features.limits.customers).toBe(-1);
    expect(payload.plans[3].priceCents).toBe(149900);
    expect(payload.plans[3].interval).toBe('3_years');
    // Step colour is an explicit stored limit for Pro/Business/Enterprise;
    // Starter never gets the key so it stays locked.
    expect(payload.plans[0].features.limits.wheelStepsColor ?? 0).toBe(0);
    expect(payload.plans[1].features.limits.wheelStepsColor).toBe(1);
    expect(payload.plans[2].features.limits.wheelStepsColor).toBe(1);
    expect(payload.plans[3].features.limits.wheelStepsColor).toBe(1);
    expect(payload.subscription).toBeNull();
    expect(payload.pendingRequest).toBeNull();
    expect(payload.usage).toEqual({ campaigns: 0, customers: 0 });
  });

  it('records a plan request and hands back the owner WhatsApp link', async () => {
    const response = await handleSettingsRoute(
      jsonRequest('/api/billing/subscribe-request', 'POST', { planSlug: 'premium' }, alice.token),
      env,
    );
    const payload = await body(response);

    expect(response.status).toBe(200);
    expect(payload.plan.slug).toBe('premium');
    expect(payload.whatsappUrl).toContain('https://wa.me/21699744593');
    expect(decodeURIComponent(payload.whatsappUrl)).toContain('1499 DT/3 ans');
    expect(payload.requestId).toMatch(/^[0-9a-f-]{36}$/);

    const stored = db.query<{ status: string; plan_id: string }>(
      'SELECT status, plan_id FROM subscription_requests WHERE business_id = ?',
      alice.businessId,
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].status).toBe('PENDING');
    expect(stored[0].plan_id).toBe('plan_premium');
  });

  it('labels the Business plan period as two years in the WhatsApp link', async () => {
    const response = await handleSettingsRoute(
      jsonRequest('/api/billing/subscribe-request', 'POST', { planSlug: 'scale' }, alice.token),
      env,
    );
    const payload = await body(response);

    expect(response.status).toBe(200);
    expect(payload.plan.slug).toBe('scale');
    expect(decodeURIComponent(payload.whatsappUrl)).toContain('799 DT/2 ans');
  });

  it('surfaces the pending request and never activates the subscription', async () => {
    await db.prepare('DELETE FROM subscriptions WHERE business_id = ?').bind(alice.businessId).run();
    await handleSettingsRoute(
      jsonRequest('/api/billing/subscribe-request', 'POST', { planSlug: 'growth' }, alice.token),
      env,
    );

    const payload = await body(await handleSettingsRoute(jsonRequest('/api/billing', 'GET', undefined, alice.token), env));
    expect(payload.subscription).toBeNull();
    expect(payload.pendingRequest.plan.slug).toBe('growth');
    expect(db.query('SELECT id FROM subscriptions WHERE business_id = ?', alice.businessId)).toHaveLength(0);
  });

  it('refuses a second request while one is still pending', async () => {
    await handleSettingsRoute(
      jsonRequest('/api/billing/subscribe-request', 'POST', { planSlug: 'growth' }, alice.token),
      env,
    );
    const second = await handleSettingsRoute(
      jsonRequest('/api/billing/subscribe-request', 'POST', { planSlug: 'scale' }, alice.token),
      env,
    );

    expect(second.status).toBe(409);
  });

  it('no longer offers instant plan switching', async () => {
    const response = await handleSettingsRoute(
      jsonRequest('/api/billing/change-plan', 'POST', { planSlug: 'growth' }, alice.token),
      env,
    );
    expect(response.status).toBe(404);
  });

  it('rejects a malformed plan slug', async () => {
    const response = await handleSettingsRoute(
      jsonRequest('/api/billing/subscribe-request', 'POST', { planSlug: 'ENTERPRISE!' }, alice.token),
      env,
    );
    expect(response.status).toBe(400);
  });

  it('404s an unknown-but-well-formed plan slug', async () => {
    const response = await handleSettingsRoute(
      jsonRequest('/api/billing/subscribe-request', 'POST', { planSlug: 'enterprise' }, alice.token),
      env,
    );
    expect(response.status).toBe(404);
  });

  it('404s when the merchant has no business', async () => {
    const solo = await seedMerchant(db, { withBusiness: false });
    const response = await handleSettingsRoute(jsonRequest('/api/billing', 'GET', undefined, solo.token), env);
    expect(response.status).toBe(404);
  });
});

describe('business logo upload', () => {
  const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  it('stores the uploaded image per business and serves it publicly', async () => {
    const response = await handleSettingsRoute(
      jsonRequest('/api/settings/logo', 'POST', { mimeType: 'image/png', dataBase64: PNG_BASE64 }, alice.token),
      env,
    );

    expect(response.status).toBe(200);
    const logoPath = `/api/public/businesses/${alice.businessId}/logo`;
    expect((await body(response)).logo).toBe(logoPath);

    const stored = db.query<{ mime_type: string; image_data: string }>(
      'SELECT mime_type, image_data FROM business_logos WHERE business_id = ?',
      alice.businessId,
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]!.mime_type).toBe('image/png');
    expect(stored[0]!.image_data).toBe(PNG_BASE64);

    const business = db.query<{ logo: string | null }>(
      'SELECT logo FROM businesses WHERE id = ?',
      alice.businessId,
    );
    expect(business[0]!.logo).toBe(logoPath);

    const served = await handlePublicLogoRoute(
      new Request(`https://example.test${logoPath}`),
      env,
    );
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
    expect(await served.arrayBuffer()).toHaveProperty('byteLength');
  });

  it('replaces an existing logo instead of storing a second row', async () => {
    await handleSettingsRoute(
      jsonRequest('/api/settings/logo', 'POST', { mimeType: 'image/png', dataBase64: PNG_BASE64 }, alice.token),
      env,
    );
    const second = await handleSettingsRoute(
      jsonRequest(
        '/api/settings/logo',
        'POST',
        { mimeType: 'image/jpeg', dataBase64: PNG_BASE64 },
        alice.token,
      ),
      env,
    );

    expect(second.status).toBe(200);
    const stored = db.query<{ mime_type: string }>('SELECT mime_type FROM business_logos WHERE business_id = ?', alice.businessId);
    expect(stored).toEqual([{ mime_type: 'image/jpeg' }]);
  });

  it('rejects a non-image upload and a missing token', async () => {
    const rejected = await handleSettingsRoute(
      jsonRequest('/api/settings/logo', 'POST', { mimeType: 'application/pdf', dataBase64: PNG_BASE64 }, alice.token),
      env,
    );
    expect(rejected.status).toBe(400);

    const anonymous = await handleSettingsRoute(
      jsonRequest('/api/settings/logo', 'POST', { mimeType: 'image/png', dataBase64: PNG_BASE64 }),
      env,
    );
    expect(anonymous.status).toBe(401);
    expect(db.query('SELECT id FROM business_logos')).toHaveLength(0);
  });

  it('keeps each merchant logo separate', async () => {
    const bob = await seedMerchant(db, {
      email: 'bob-logo@example.test',
      businessName: 'Bob Logo Shop',
      withActiveSubscription: true,
    });

    await handleSettingsRoute(
      jsonRequest('/api/settings/logo', 'POST', { mimeType: 'image/png', dataBase64: PNG_BASE64 }, alice.token),
      env,
    );

    expect(
      db
        .query<{ business_id: string }>('SELECT business_id FROM business_logos')
        .map((row) => row.business_id),
    ).toEqual([alice.businessId]);
    expect((await body(await handleSettingsRoute(jsonRequest('/api/settings', 'GET', undefined, bob.token), env))).settings.logo)
      .toBe('');
  });

  it('deletes the stored logo when the merchant removes it', async () => {
    await handleSettingsRoute(
      jsonRequest('/api/settings/logo', 'POST', { mimeType: 'image/png', dataBase64: PNG_BASE64 }, alice.token),
      env,
    );

    const response = await handleSettingsRoute(jsonRequest('/api/settings/logo', 'DELETE', undefined, alice.token), env);

    expect(response.status).toBe(200);
    expect((await body(response)).logo).toBe('');
    expect(db.query('SELECT id FROM business_logos')).toHaveLength(0);
    expect(db.query<{ logo: string | null }>('SELECT logo FROM businesses WHERE id = ?', alice.businessId)[0]!.logo).toBeNull();

    const served = await handlePublicLogoRoute(
      new Request(`https://example.test/api/public/businesses/${alice.businessId}/logo`),
      env,
    );
    expect(served.status).toBe(404);
  });

  it('blocks logo uploads while the account is read-only', async () => {
    const trial = await seedMerchant(db, { email: 'trial-logo@example.test', businessName: 'Trial Logo Shop' });
    const response = await handleSettingsRoute(
      jsonRequest('/api/settings/logo', 'POST', { mimeType: 'image/png', dataBase64: PNG_BASE64 }, trial.token),
      env,
    );

    expect(response.status).toBe(403);
    expect(db.query('SELECT id FROM business_logos')).toHaveLength(0);
  });
});

describe('optional social networks', () => {
  it('stores and returns the optional social URLs alongside Facebook and Instagram', async () => {
    const response = await handleSettingsRoute(
      jsonRequest(
        '/api/settings',
        'PUT',
        {
          twitterUrl: 'https://x.com/shop',
          linkedinUrl: 'https://linkedin.com/company/shop',
          tiktokUrl: 'https://tiktok.com/@shop',
          youtubeUrl: 'https://youtube.com/@shop',
        },
        alice.token,
      ),
      env,
    );

    expect(response.status).toBe(200);
    const stored = db.query<Record<string, string | null>>(
      `SELECT twitter_url, linkedin_url, tiktok_url, youtube_url
       FROM business_settings WHERE business_id = ?`,
      alice.businessId,
    );
    expect(stored).toEqual([
      {
        twitter_url: 'https://x.com/shop',
        linkedin_url: 'https://linkedin.com/company/shop',
        tiktok_url: 'https://tiktok.com/@shop',
        youtube_url: 'https://youtube.com/@shop',
      },
    ]);

    const payload = await body(
      await handleSettingsRoute(jsonRequest('/api/settings', 'GET', undefined, alice.token), env),
    );
    expect(payload.settings).toMatchObject({
      twitterUrl: 'https://x.com/shop',
      linkedinUrl: 'https://linkedin.com/company/shop',
      tiktokUrl: 'https://tiktok.com/@shop',
      youtubeUrl: 'https://youtube.com/@shop',
    });
  });

  it('rejects a social URL that is not a URL', async () => {
    const response = await handleSettingsRoute(
      jsonRequest('/api/settings', 'PUT', { twitterUrl: 'not a url' }, alice.token),
      env,
    );

    expect(response.status).toBe(400);
  });
});

describe('wheel design', () => {
  const theme = {
    colors: {
      segments: ['#ff0000', '#00ff00', '#0000ff'],
      rim: '#111111',
      pointer: '#222222',
    },
    motion: { preset: 'fast' },
    centerLogo: true,
  };

  const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  async function upgradeToPro() {
    db.prepare(`UPDATE subscriptions SET plan_id = 'plan_growth', status = 'active', updated_at = ? WHERE business_id = ?`)
      .bind(new Date().toISOString(), alice.businessId)
      .run();
  }

  async function upgradeToBusiness() {
    db.prepare(`UPDATE subscriptions SET plan_id = 'plan_scale', status = 'active', updated_at = ? WHERE business_id = ?`)
      .bind(new Date().toISOString(), alice.businessId)
      .run();
  }

  it('returns the default effective theme on Starter and gates the editor', async () => {
    const payload = await body(
      await handleSettingsRoute(jsonRequest('/api/settings/wheel-theme', 'GET', undefined, alice.token), env),
    );

    expect(payload.success).toBe(true);
    expect(payload.designAllowed).toBe(false);
    expect(payload.centerLogoAllowed).toBe(false);
    expect(payload.stepsColorAllowed).toBe(false);
    expect(payload.planSlug).toBe('starter');
    expect(payload.theme).toBeNull();
    expect(payload.override).toBeNull();
    expect(payload.effective).toMatchObject({
      colors: { rim: '#ffffff', pointer: '#0f172a' },
      motion: { preset: 'standard' },
      centerLogo: false,
      stepsColor: '#7DAB4B',
    });
    expect(payload.centerLogo).toBe(`/api/public/businesses/${alice.businessId}/wheel-logo`);
  });

  it('refuses to save anything on Starter', async () => {
    const response = await handleSettingsRoute(
      jsonRequest('/api/settings/wheel-theme', 'PUT', theme, alice.token),
      env,
    );

    expect(response.status).toBe(403);
    expect((await body(response)).error).toContain('Upgrade');
    expect(db.query<{ wheel_theme: string | null }>('SELECT wheel_theme FROM businesses WHERE id = ?', alice.businessId)[0]!.wheel_theme)
      .toBeNull();
  });

  it('locks every plan out of editing when the operator switch is off, then restores access', async () => {
    // The operator switch is an independent kill-switch: it must win even for
    // a plan (Scale) that would otherwise fully allow the editor.
    await upgradeToBusiness();
    db.prepare('UPDATE businesses SET wheel_design_enabled = 0 WHERE id = ?').bind(alice.businessId).run();

    const gated = await body(
      await handleSettingsRoute(jsonRequest('/api/settings/wheel-theme', 'GET', undefined, alice.token), env),
    );
    expect(gated.designAllowed).toBe(false);
    expect(gated.centerLogoAllowed).toBe(false);
    expect(gated.stepsColorAllowed).toBe(false);

    const saved = await handleSettingsRoute(
      jsonRequest('/api/settings/wheel-theme', 'PUT', theme, alice.token),
      env,
    );
    expect(saved.status).toBe(403);
    expect((await body(saved)).error).toContain('disabled by the platform administrator');
    expect(
      db.query<{ wheel_theme: string | null }>('SELECT wheel_theme FROM businesses WHERE id = ?', alice.businessId)[0]!
        .wheel_theme,
    ).toBeNull();

    const logo = await handleSettingsRoute(
      jsonRequest('/api/settings/wheel-logo', 'POST', { mimeType: 'image/png', dataBase64: PNG_BASE64 }, alice.token),
      env,
    );
    expect(logo.status).toBe(403);

    db.prepare('UPDATE businesses SET wheel_design_enabled = 1 WHERE id = ?').bind(alice.businessId).run();
    const restored = await handleSettingsRoute(
      jsonRequest('/api/settings/wheel-theme', 'PUT', theme, alice.token),
      env,
    );
    expect(restored.status).toBe(200);
  });

  it('lets Pro merchants save the full design and the hub logo', async () => {
    await upgradeToPro();

    const payload = await body(
      await handleSettingsRoute(jsonRequest('/api/settings/wheel-theme', 'GET', undefined, alice.token), env),
    );
    expect(payload.designAllowed).toBe(true);
    expect(payload.centerLogoAllowed).toBe(true);
    expect(payload.stepsColorAllowed).toBe(true);
    expect(payload.planSlug).toBe('growth');

    const saved = await handleSettingsRoute(
      jsonRequest('/api/settings/wheel-theme', 'PUT', theme, alice.token),
      env,
    );
    expect(saved.status).toBe(200);
    expect((await body(saved)).theme).toMatchObject({
      colors: { rim: '#111111', pointer: '#222222' },
      motion: { preset: 'fast' },
      centerLogo: true,
    });

    const refreshed = await body(
      await handleSettingsRoute(jsonRequest('/api/settings/wheel-theme', 'GET', undefined, alice.token), env),
    );
    expect(refreshed.designAllowed).toBe(true);
    expect(refreshed.theme).toMatchObject({ motion: { preset: 'fast' }, centerLogo: true });
    expect(refreshed.effective).toMatchObject({ motion: { preset: 'fast' }, centerLogo: true });

    const logo = await handleSettingsRoute(
      jsonRequest('/api/settings/wheel-logo', 'POST', { mimeType: 'image/png', dataBase64: PNG_BASE64 }, alice.token),
      env,
    );
    expect(logo.status).toBe(200);
  });

  it('lets Pro merchants set the gate step colour with the full design', async () => {
    await upgradeToPro();

    const saved = await handleSettingsRoute(
      jsonRequest('/api/settings/wheel-theme', 'PUT', { ...theme, stepsColor: '#112233' }, alice.token),
      env,
    );
    expect(saved.status).toBe(200);
    expect((await body(saved)).theme).toMatchObject({
      colors: { rim: '#111111', pointer: '#222222' },
      stepsColor: '#112233',
    });

    const stored = JSON.parse(
      db.query<{ wheel_theme: string }>('SELECT wheel_theme FROM businesses WHERE id = ?', alice.businessId)[0]!.wheel_theme,
    );
    expect(stored.stepsColor).toBe('#112233');
  });

  it('stores a custom design on Business and reports it as effective', async () => {
    await upgradeToBusiness();

    const saved = await handleSettingsRoute(
      jsonRequest('/api/settings/wheel-theme', 'PUT', theme, alice.token),
      env,
    );
    expect(saved.status).toBe(200);
    expect((await body(saved)).theme.motion.preset).toBe('fast');

    const stored = db.query<{ wheel_theme: string }>('SELECT wheel_theme FROM businesses WHERE id = ?', alice.businessId);
    expect(JSON.parse(stored[0]!.wheel_theme)).toMatchObject({ motion: { preset: 'fast' }, centerLogo: true });

    const audit = db.query<{ action: string }>(
      'SELECT action FROM audit_logs WHERE business_id = ? AND action = ?',
      alice.businessId,
      'business.wheel_theme.updated',
    );
    expect(audit).toHaveLength(1);

    const payload = await body(
      await handleSettingsRoute(jsonRequest('/api/settings/wheel-theme', 'GET', undefined, alice.token), env),
    );
    expect(payload.designAllowed).toBe(true);
    expect(payload.centerLogoAllowed).toBe(true);
    expect(payload.stepsColorAllowed).toBe(true);
    expect(payload.planSlug).toBe('scale');
    expect(payload.theme).toMatchObject({ motion: { preset: 'fast' }, colors: { rim: '#111111' } });
    expect(payload.effective).toMatchObject({ motion: { preset: 'fast' } });
  });

  it('rejects a malformed theme', async () => {
    await upgradeToBusiness();

    const response = await handleSettingsRoute(
      jsonRequest('/api/settings/wheel-theme', 'PUT', { colors: { segments: ['red'] }, motion: { preset: 'fast' } }, alice.token),
      env,
    );

    expect(response.status).toBe(400);
  });

  it('keeps the operator override above the merchant theme in the effective view', async () => {
    await upgradeToBusiness();
    await handleSettingsRoute(jsonRequest('/api/settings/wheel-theme', 'PUT', theme, alice.token), env);

    const override = JSON.stringify({
      colors: theme.colors,
      motion: { preset: 'slow' },
      centerLogo: false,
    });
    db.prepare('UPDATE businesses SET wheel_theme_override = ? WHERE id = ?')
      .bind(override, alice.businessId)
      .run();

    const payload = await body(
      await handleSettingsRoute(jsonRequest('/api/settings/wheel-theme', 'GET', undefined, alice.token), env),
    );
    expect(payload.theme.motion.preset).toBe('fast');
    expect(payload.override.motion.preset).toBe('slow');
    expect(payload.effective.motion.preset).toBe('slow');
  });

  it('stores the center logo per business and serves it through the public route', async () => {
    await upgradeToPro();

    const response = await handleSettingsRoute(
      jsonRequest('/api/settings/wheel-logo', 'POST', { mimeType: 'image/png', dataBase64: PNG_BASE64 }, alice.token),
      env,
    );

    expect(response.status).toBe(200);
    // Versioned with the row's updated_at so a replaced logo refetches at once.
    expect((await body(response)).logo).toMatch(
      new RegExp(`^/api/public/businesses/${alice.businessId}/wheel-logo\\?v=`),
    );

    const stored = db.query<{ mime_type: string }>(
      'SELECT mime_type FROM business_wheel_logos WHERE business_id = ?',
      alice.businessId,
    );
    expect(stored).toEqual([{ mime_type: 'image/png' }]);

    const served = await handlePublicWheelLogoRoute(
      new Request(`https://example.test/api/public/businesses/${alice.businessId}/wheel-logo`),
      env,
    );
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
    expect(served.headers.get('cache-control')).toBe('no-cache');
    const etag = served.headers.get('etag');
    expect(etag).toBeTruthy();

    const revalidated = await handlePublicWheelLogoRoute(
      new Request(`https://example.test/api/public/businesses/${alice.businessId}/wheel-logo`, {
        headers: { 'if-none-match': etag! },
      }),
      env,
    );
    expect(revalidated.status).toBe(304);
    expect(revalidated.headers.get('etag')).toBe(etag);

    const removed = await handleSettingsRoute(
      jsonRequest('/api/settings/wheel-logo', 'DELETE', undefined, alice.token),
      env,
    );
    expect(removed.status).toBe(200);
    expect(db.query('SELECT id FROM business_wheel_logos')).toHaveLength(0);
  });

  it('blocks the center logo upload on Starter', async () => {
    const response = await handleSettingsRoute(
      jsonRequest('/api/settings/wheel-logo', 'POST', { mimeType: 'image/png', dataBase64: PNG_BASE64 }, alice.token),
      env,
    );

    expect(response.status).toBe(403);
    expect(db.query('SELECT id FROM business_wheel_logos')).toHaveLength(0);
  });

  it('honours the plan criteria when the operator turns the hub logo off', async () => {
    await upgradeToBusiness();

    const plan = db.query<{ features: string }>('SELECT features FROM plans WHERE id = ?', 'plan_scale')[0]!;
    const features = JSON.parse(plan.features) as { limits: Record<string, number>; features: string[] };
    features.limits = { ...features.limits, wheelCenterLogo: 0 };
    db.prepare('UPDATE plans SET features = ? WHERE id = ?')
      .bind(JSON.stringify(features), 'plan_scale')
      .run();

    const payload = await body(
      await handleSettingsRoute(jsonRequest('/api/settings/wheel-theme', 'GET', undefined, alice.token), env),
    );
    expect(payload.designAllowed).toBe(true);
    expect(payload.centerLogoAllowed).toBe(false);

    const logo = await handleSettingsRoute(
      jsonRequest('/api/settings/wheel-logo', 'POST', { mimeType: 'image/png', dataBase64: PNG_BASE64 }, alice.token),
      env,
    );
    expect(logo.status).toBe(403);

    const saved = await handleSettingsRoute(
      jsonRequest('/api/settings/wheel-theme', 'PUT', theme, alice.token),
      env,
    );
    expect(saved.status).toBe(200);
    expect((await body(saved)).theme).toMatchObject({ motion: { preset: 'fast' }, centerLogo: false });
  });
});
