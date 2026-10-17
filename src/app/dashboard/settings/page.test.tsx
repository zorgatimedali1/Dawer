import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from '@/app/dashboard/settings/page';

// jsdom has no createImageBitmap/canvas pipeline; the real optimizer can't
// decode the fake PNG fixtures, so pass files through untouched.
vi.mock('@/lib/optimize-image', () => ({
  MAX_LOGO_BYTES: 512 * 1024,
  optimizeImage: (file: File) => Promise.resolve(file),
  prepareLogoUpload: (file: File) => Promise.resolve(file),
}));

const AUTH_KEY = 'campaign-engage-auth';

const profile = {
  id: 'u1',
  email: 'ada@example.test',
  firstName: 'Ada',
  lastName: 'Lovelace',
  avatarUrl: '',
  emailVerified: true,
  hasPassword: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  businesses: [{ id: 'b1', name: 'Shop', slug: 'shop', role: 'OWNER' }],
};

const initialSettings = {
  name: 'Shop',
  description: 'Coffee shop',
  website: 'https://shop.example.test',
  phone: '+21612345678',
  email: 'shop@example.test',
  address: 'Tunis',
  timezone: 'Africa/Tunis',
  logo: '',
  googleMapsName: 'Shop',
  googleMapsUrl: 'https://maps.google.com/?cid=123',
  googlePlaceId: 'place-123',
  facebookUrl: 'https://facebook.com/shop',
  instagramUrl: 'https://instagram.com/shop',
  primaryColor: '#4f46e5',
  secondaryColor: '#10b981',
  notifications: { email: true, sms: false, push: false },
};

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('settings page', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(
      AUTH_KEY,
      JSON.stringify({ token: 'cf_abc.def', user: { id: 'u1', email: 'ada@example.test', role: 'merchant' } }),
    );
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it(
    'saves profile, business, branding, and integration settings without notifications',
    async () => {
    let currentProfile = { ...profile };
    let currentSettings = { ...initialSettings };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();

      if (method === 'GET' && url === '/api/profile') {
        return jsonResponse({ success: true, profile: currentProfile });
      }
      if (method === 'GET' && url === '/api/settings') {
        return jsonResponse({ success: true, settings: currentSettings });
      }
      if (method === 'GET' && url.startsWith('/api/places/autocomplete')) {
        return jsonResponse({
          success: true,
          suggestions: [
            { placeId: 'place-456', label: 'Splash Food, Tunis', mainText: 'Splash Food', secondaryText: 'Tunis' },
          ],
        });
      }
      if (method === 'PUT' && url === '/api/profile') {
        currentProfile = { ...currentProfile, ...JSON.parse(String(init?.body)) };
        return jsonResponse({ success: true, profile: currentProfile });
      }
      if (method === 'PUT' && url === '/api/settings') {
        currentSettings = { ...currentSettings, ...JSON.parse(String(init?.body)) };
        return jsonResponse({ success: true, settings: currentSettings });
      }
      if (method === 'POST' && url === '/api/profile/password') {
        return jsonResponse({ success: true, message: 'Password updated. Other sessions were signed out.' });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SettingsPage />);
    await screen.findByRole('heading', { name: 'Informations du profil' });
    expect(screen.queryByRole('tab', { name: 'Notifications' })).toBeNull();

    await userEvent.clear(screen.getByLabelText('Prénom'));
    await userEvent.type(screen.getByLabelText('Prénom'), 'Grace');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer le profil' }));
    await screen.findByText('Profil mis à jour.');

    await userEvent.click(screen.getByRole('tab', { name: 'Entreprise' }));
    await userEvent.clear(screen.getByLabelText('Nom de l’entreprise'));
    await userEvent.type(screen.getByLabelText('Nom de l’entreprise'), 'New Shop');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer les informations de l’entreprise' }));
    await screen.findByText('Informations de l’entreprise enregistrées.');

    await userEvent.click(screen.getByRole('tab', { name: 'Image de marque' }));
    await userEvent.clear(screen.getByLabelText('Valeur de la couleur principale'));
    await userEvent.type(screen.getByLabelText('Valeur de la couleur principale'), '#112233');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer l’image de marque' }));
    await screen.findByText('Image de marque enregistrée.');

    await userEvent.click(screen.getByRole('tab', { name: 'Intégrations' }));

    const googleSearch = screen.getByRole('combobox', { name: 'Google Maps / Google Business' });
    await userEvent.clear(googleSearch);
    await userEvent.type(googleSearch, 'Splash Food');
    await userEvent.click(await screen.findByRole('option', { name: /Splash Food/ }));

    await userEvent.clear(screen.getByLabelText('URL de la page Facebook'));
    await userEvent.type(screen.getByLabelText('URL de la page Facebook'), 'https://facebook.com/new-shop');
    await userEvent.clear(screen.getByLabelText('URL du profil Instagram'));
    await userEvent.type(screen.getByLabelText('URL du profil Instagram'), 'https://instagram.com/new-shop');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer la configuration' }));
    await screen.findByText('Configuration enregistrée.');

    expect(fetchMock.mock.calls.some(([url, init]) => (
      String(url) === '/api/profile' && init?.method === 'PUT' && JSON.parse(String(init.body)).firstName === 'Grace'
    ))).toBe(true);
    expect(fetchMock.mock.calls.some(([url, init]) => (
      String(url) === '/api/settings' && init?.method === 'PUT' && JSON.parse(String(init.body)).name === 'New Shop'
    ))).toBe(true);
    expect(fetchMock.mock.calls.some(([url, init]) => (
      String(url) === '/api/settings' && init?.method === 'PUT' && JSON.parse(String(init.body)).primaryColor === '#112233'
    ))).toBe(true);

    const integrationPut = fetchMock.mock.calls.find(([url, init]) => (
      String(url) === '/api/settings' && init?.method === 'PUT' && 'googlePlaceId' in JSON.parse(String(init.body))
    ));
    expect(integrationPut).toBeDefined();
    const integrationBody = JSON.parse(String(integrationPut?.[1]?.body));
    expect(integrationBody).toMatchObject({
      googleMapsName: 'Splash Food, Tunis',
      googlePlaceId: 'place-456',
      facebookUrl: 'https://facebook.com/new-shop',
      instagramUrl: 'https://instagram.com/new-shop',
    });
    // Social fields without a UI control must be omitted so the backend
    // keeps whatever the merchant stored earlier.
    expect(integrationBody).not.toHaveProperty('twitterUrl');
    expect(integrationBody).not.toHaveProperty('linkedinUrl');
    expect(integrationBody).not.toHaveProperty('tiktokUrl');
    expect(integrationBody).not.toHaveProperty('youtubeUrl');
    expect(String(integrationBody.googleMapsUrl)).toContain('query_place_id=place-456');
    },
    20_000,
  );

  it('changes a password only when the account has a password', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/profile') {
        const result = init?.method === 'PUT' ? { ...profile, ...JSON.parse(String(init.body)) } : profile;
        return jsonResponse({ success: true, profile: result });
      }
      if (url === '/api/settings') return jsonResponse({ success: true, settings: initialSettings });
      if (url === '/api/profile/password') return jsonResponse({ success: true, message: 'Password updated.' });
      throw new Error(`Unexpected request: ${url}`);
    }));

    render(<SettingsPage />);
    await screen.findByRole('heading', { name: 'Informations du profil' });
    await userEvent.click(screen.getByRole('tab', { name: 'Sécurité' }));
    await userEvent.type(screen.getByLabelText('Mot de passe actuel'), 'current123');
    await userEvent.type(screen.getByLabelText('Nouveau mot de passe'), 'newpassword123');
    await userEvent.type(screen.getByLabelText('Confirmer le nouveau mot de passe'), 'newpassword123');
    await userEvent.click(screen.getByRole('button', { name: 'Modifier le mot de passe' }));
    await waitFor(() => expect(screen.getByText('Mot de passe mis à jour.')).toBeInTheDocument());
  });

  it('explains that Google-only accounts have no password to change', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/profile') return jsonResponse({ success: true, profile: { ...profile, hasPassword: false } });
      if (url === '/api/settings') return jsonResponse({ success: true, settings: initialSettings });
      throw new Error(`Unexpected request: ${url}`);
    }));

    render(<SettingsPage />);
    await screen.findByRole('heading', { name: 'Informations du profil' });
    await userEvent.click(screen.getByRole('tab', { name: 'Sécurité' }));

    expect(screen.getByText(/utilise la connexion Google/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Modifier le mot de passe' })).toBeNull();
  });

  it('uploads the company logo and stores the path returned by the API', async () => {
    let currentSettings = { ...initialSettings };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'GET' && url === '/api/profile') return jsonResponse({ success: true, profile });
      if (method === 'GET' && url === '/api/settings') return jsonResponse({ success: true, settings: currentSettings });
      if (method === 'POST' && url === '/api/settings/logo') {
        const payload = JSON.parse(String(init?.body)) as { mimeType: string; dataBase64: string };
        expect(payload.mimeType).toBe('image/png');
        expect(payload.dataBase64.length).toBeGreaterThan(0);
        currentSettings = { ...currentSettings, logo: '/api/public/businesses/b1/logo' };
        return jsonResponse({ success: true, logo: currentSettings.logo });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SettingsPage />);
    await screen.findByRole('heading', { name: 'Informations du profil' });
    await userEvent.click(screen.getByRole('tab', { name: 'Image de marque' }));

    expect(screen.queryByTestId('business-logo-preview')).toBeNull();

    const file = new File([new Uint8Array([137, 80, 78, 71])], 'logo.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText('Choisir un logo'), file);

    await screen.findByText('Logo enregistré.');
    const preview = await screen.findByTestId('business-logo-preview');
    expect(preview).toHaveAttribute('src', '/api/public/businesses/b1/logo');
  });

  it('asks for confirmation before deleting the logo', async () => {
    const withLogo = { ...initialSettings, logo: '/api/public/businesses/b1/logo' };
    let currentSettings = { ...withLogo };
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'GET' && url === '/api/profile') return jsonResponse({ success: true, profile });
      if (method === 'GET' && url === '/api/settings') return jsonResponse({ success: true, settings: currentSettings });
      if (method === 'DELETE' && url === '/api/settings/logo') {
        currentSettings = { ...currentSettings, logo: '' };
        return jsonResponse({ success: true, logo: '' });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SettingsPage />);
    await screen.findByRole('heading', { name: 'Informations du profil' });
    await userEvent.click(screen.getByRole('tab', { name: 'Image de marque' }));

    expect(await screen.findByTestId('business-logo-preview')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Retirer' }));

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('retirer le logo'));
    expect(screen.getByTestId('business-logo-preview')).toBeInTheDocument();

    confirmSpy.mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: 'Retirer' }));

    await screen.findByText('Logo supprimé.');
    await waitFor(() => expect(screen.queryByTestId('business-logo-preview')).toBeNull());
  });

  it('saves integrations with a single button and leaves untouched social fields alone', async () => {
    let currentSettings = {
      ...initialSettings,
      twitterUrl: 'https://x.com/shop',
      linkedinUrl: 'https://linkedin.com/company/shop',
      tiktokUrl: 'https://tiktok.com/@shop',
      youtubeUrl: 'https://youtube.com/@shop',
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'GET' && url === '/api/profile') return jsonResponse({ success: true, profile });
      if (method === 'GET' && url === '/api/settings') return jsonResponse({ success: true, settings: currentSettings });
      if (method === 'PUT' && url === '/api/settings') {
        currentSettings = { ...currentSettings, ...JSON.parse(String(init?.body)) };
        return jsonResponse({ success: true, settings: currentSettings });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SettingsPage />);
    await screen.findByRole('heading', { name: 'Informations du profil' });
    await userEvent.click(screen.getByRole('tab', { name: 'Intégrations' }));

    expect(screen.queryByLabelText('URL Twitter (X)')).toBeNull();
    expect(screen.queryByLabelText('URL LinkedIn')).toBeNull();
    expect(screen.queryByLabelText('URL TikTok')).toBeNull();
    expect(screen.queryByLabelText('URL YouTube')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Enregistrer la configuration Google' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Enregistrer la configuration Facebook' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Enregistrer la configuration Instagram' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Enregistrer la configuration' })).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('URL de la page Facebook'));
    await userEvent.type(screen.getByLabelText('URL de la page Facebook'), 'https://facebook.com/shop');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer la configuration' }));

    await screen.findByText('Configuration enregistrée.');
    const saved = fetchMock.mock.calls.find(([url, init]) => (
      String(url) === '/api/settings' && init?.method === 'PUT' && 'facebookUrl' in JSON.parse(String(init.body))
    ));
    const body = JSON.parse(String(saved?.[1]?.body));
    expect(body).toMatchObject({
      facebookUrl: 'https://facebook.com/shop',
      instagramUrl: 'https://instagram.com/shop',
    });
    // The social networks without a UI field must be omitted, not wiped.
    expect(body).not.toHaveProperty('twitterUrl');
    expect(body).not.toHaveProperty('linkedinUrl');
    expect(body).not.toHaveProperty('tiktokUrl');
    expect(body).not.toHaveProperty('youtubeUrl');
    // And the server keeps their stored values.
    expect(currentSettings.twitterUrl).toBe('https://x.com/shop');
    expect(currentSettings.youtubeUrl).toBe('https://youtube.com/@shop');
  }, 15000);
});