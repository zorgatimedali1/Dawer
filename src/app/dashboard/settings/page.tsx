"use client";

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  SettingsService,
  type BusinessSettings,
  type Profile,
} from '@/services/settings.service';

type TabKey = 'profile' | 'business' | 'notifications' | 'security' | 'branding' | 'integrations';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'profile', label: 'Profile' },
  { key: 'business', label: 'Business' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'security', label: 'Security' },
  { key: 'branding', label: 'Branding' },
  { key: 'integrations', label: 'Integrations' },
];

const inputClass =
  'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500';

function Status({ pending, message, error }: { pending: boolean; message: string; error: string }) {
  if (pending) return <p className="text-sm text-gray-500">Saving…</p>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (message) return <p className="text-sm text-green-600">{message}</p>;
  return null;
}

export default function SettingsPage() {
  const [tab, setTab] = useState<TabKey>('profile');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [loadedProfile, loadedSettings] = await Promise.all([
        SettingsService.getProfile(),
        SettingsService.getSettings(),
      ]);
      setProfile(loadedProfile);
      setSettings(loadedSettings);
      setFirstName(loadedProfile.firstName);
      setLastName(loadedProfile.lastName);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (action: () => Promise<void>, successMessage: string) => {
    setPending(true);
    setStatus('');
    setError('');
    try {
      await action();
      setStatus(successMessage);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save.');
    } finally {
      setPending(false);
    }
  };

  const patchSettings = (changes: Parameters<typeof SettingsService.updateSettings>[0], message: string) =>
    save(async () => {
      const updated = await SettingsService.updateSettings(changes);
      setSettings(updated);
    }, message);

  const noBusiness = !loading && !settings && error.startsWith('Create a business');

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-sm text-gray-500">Loading settings…</p>
      </div>
    );
  }

  if (noBusiness) {
    return (
      <div className="p-6">
        <h2 className="text-2xl font-bold text-gray-900">Settings</h2>
        <p className="mt-2 text-sm text-gray-600">Create a business before configuring settings.</p>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="p-6">
        <h2 className="text-2xl font-bold text-gray-900">Settings</h2>
        <p className="mt-2 text-sm text-red-600">{error || 'Unable to load settings.'}</p>
        <Button className="mt-4" variant="outline" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Settings</h2>
          <p className="text-sm text-gray-600">Manage your account, preferences, and security settings</p>
        </div>
        <Status pending={pending} message={status} error={error} />
      </div>

      <div className="mb-6 flex border-b border-gray-200 overflow-x-auto">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap ${
              tab === key ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
          <h3 className="text-lg font-medium text-gray-900">Profile Information</h3>
          <p className="text-sm text-gray-600">
            {profile?.email} {profile?.emailVerified ? '• verified' : '• unverified'}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-gray-700">
              First name
              <input className={inputClass} value={firstName} onChange={(event) => setFirstName(event.target.value)} />
            </label>
            <label className="block text-sm font-medium text-gray-700">
              Last name
              <input className={inputClass} value={lastName} onChange={(event) => setLastName(event.target.value)} />
            </label>
          </div>
          <Button
            onClick={() =>
              void save(async () => {
                const updated = await SettingsService.updateProfile({ firstName, lastName });
                setProfile((current) => (current ? { ...current, ...updated } : updated));
              }, 'Profile updated.')
            }
          >
            Save profile
          </Button>
        </div>
      )}

      {tab === 'business' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
          <h3 className="text-lg font-medium text-gray-900">Business Information</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-gray-700">
              Business name
              <input
                className={inputClass}
                value={settings.name}
                onChange={(event) => setSettings({ ...settings, name: event.target.value })}
              />
            </label>
            <label className="block text-sm font-medium text-gray-700">
              Timezone
              <input
                className={inputClass}
                value={settings.timezone}
                onChange={(event) => setSettings({ ...settings, timezone: event.target.value })}
              />
            </label>
            <label className="block text-sm font-medium text-gray-700">
              Website
              <input
                className={inputClass}
                value={settings.website}
                onChange={(event) => setSettings({ ...settings, website: event.target.value })}
              />
            </label>
            <label className="block text-sm font-medium text-gray-700">
              Phone
              <input
                className={inputClass}
                value={settings.phone}
                onChange={(event) => setSettings({ ...settings, phone: event.target.value })}
              />
            </label>
            <label className="block text-sm font-medium text-gray-700">
              Contact email
              <input
                className={inputClass}
                value={settings.email}
                onChange={(event) => setSettings({ ...settings, email: event.target.value })}
              />
            </label>
            <label className="block text-sm font-medium text-gray-700">
              Address
              <input
                className={inputClass}
                value={settings.address}
                onChange={(event) => setSettings({ ...settings, address: event.target.value })}
              />
            </label>
          </div>
          <label className="block text-sm font-medium text-gray-700">
            Description
            <textarea
              className={inputClass}
              rows={3}
              value={settings.description}
              onChange={(event) => setSettings({ ...settings, description: event.target.value })}
            />
          </label>
          <Button
            onClick={() =>
              void patchSettings(
                {
                  name: settings.name,
                  timezone: settings.timezone,
                  website: settings.website,
                  phone: settings.phone,
                  email: settings.email,
                  address: settings.address,
                  description: settings.description,
                },
                'Business information saved.',
              )
            }
          >
            Save business information
          </Button>
        </div>
      )}

      {tab === 'notifications' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
          <h3 className="text-lg font-medium text-gray-900">Notification Preferences</h3>
          {(['email', 'sms', 'push'] as const).map((channel) => (
            <label key={channel} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <span className="text-sm font-medium text-gray-700 capitalize">{channel} updates</span>
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={settings.notifications[channel]}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    notifications: { ...settings.notifications, [channel]: event.target.checked },
                  })
                }
              />
            </label>
          ))}
          <Button onClick={() => void patchSettings({ notifications: settings.notifications }, 'Preferences saved.')}>
            Save preferences
          </Button>
        </div>
      )}

      {tab === 'security' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
          <h3 className="text-lg font-medium text-gray-900">Account Security</h3>
          <p className="text-sm text-gray-600">
            Changing your password signs out every other session on this account.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block text-sm font-medium text-gray-700">
              Current password
              <input
                type="password"
                className={inputClass}
                value={passwords.current}
                onChange={(event) => setPasswords({ ...passwords, current: event.target.value })}
              />
            </label>
            <label className="block text-sm font-medium text-gray-700">
              New password
              <input
                type="password"
                className={inputClass}
                value={passwords.next}
                onChange={(event) => setPasswords({ ...passwords, next: event.target.value })}
              />
            </label>
            <label className="block text-sm font-medium text-gray-700">
              Confirm new password
              <input
                type="password"
                className={inputClass}
                value={passwords.confirm}
                onChange={(event) => setPasswords({ ...passwords, confirm: event.target.value })}
              />
            </label>
          </div>
          <Button
            onClick={() => {
              if (passwords.next !== passwords.confirm) {
                setError('New passwords do not match.');
                return;
              }
              if (passwords.next.length < 8) {
                setError('The new password must be at least 8 characters.');
                return;
              }
              void save(async () => {
                const message = await SettingsService.changePassword(passwords.current, passwords.next);
                setPasswords({ current: '', next: '', confirm: '' });
                setStatus(message);
              }, 'Password updated.');
            }}
          >
            Change password
          </Button>
        </div>
      )}

      {tab === 'branding' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
          <h3 className="text-lg font-medium text-gray-900">Branding &amp; Appearance</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-gray-700">
              Primary color
              <div className="mt-1 flex items-center gap-3">
                <input
                  type="color"
                  className="w-10 h-10"
                  value={settings.primaryColor}
                  onChange={(event) => setSettings({ ...settings, primaryColor: event.target.value })}
                />
                <input
                  className={inputClass}
                  value={settings.primaryColor}
                  onChange={(event) => setSettings({ ...settings, primaryColor: event.target.value })}
                />
              </div>
            </label>
            <label className="block text-sm font-medium text-gray-700">
              Secondary color
              <div className="mt-1 flex items-center gap-3">
                <input
                  type="color"
                  className="w-10 h-10"
                  value={settings.secondaryColor}
                  onChange={(event) => setSettings({ ...settings, secondaryColor: event.target.value })}
                />
                <input
                  className={inputClass}
                  value={settings.secondaryColor}
                  onChange={(event) => setSettings({ ...settings, secondaryColor: event.target.value })}
                />
              </div>
            </label>
          </div>
          <label className="block text-sm font-medium text-gray-700">
            Logo URL
            <input
              className={inputClass}
              value={settings.logo}
              placeholder="https://…"
              onChange={(event) => setSettings({ ...settings, logo: event.target.value })}
            />
          </label>
          <Button
            onClick={() =>
              void patchSettings(
                {
                  primaryColor: settings.primaryColor,
                  secondaryColor: settings.secondaryColor,
                  logo: settings.logo,
                },
                'Branding saved.',
              )
            }
          >
            Save branding
          </Button>
        </div>
      )}

      {tab === 'integrations' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
            <h3 className="text-lg font-medium text-gray-900">Google Maps / Google Business</h3>
            <label className="block text-sm font-medium text-gray-700">
              Google Maps name
              <input
                className={inputClass}
                value={settings.googleMapsName}
                placeholder="Beachside Cafe"
                onChange={(event) => setSettings({ ...settings, googleMapsName: event.target.value })}
              />
            </label>
            <label className="block text-sm font-medium text-gray-700">
              Google Maps / Google Business URL
              <input
                className={inputClass}
                value={settings.googleMapsUrl}
                placeholder="https://maps.google.com/…"
                onChange={(event) => setSettings({ ...settings, googleMapsUrl: event.target.value })}
              />
            </label>
            <label className="block text-sm font-medium text-gray-700">
              Google Place ID
              <input
                className={inputClass}
                value={settings.googlePlaceId}
                placeholder="ChIJN1t_tDeuEmsRUsoyG83frY4"
                onChange={(event) => setSettings({ ...settings, googlePlaceId: event.target.value })}
              />
            </label>
            <Button onClick={() => void patchSettings(integrationPatch(settings), 'Google configuration saved.')}>
              Save Google configuration
            </Button>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
            <h3 className="text-lg font-medium text-gray-900">Facebook</h3>
            <label className="block text-sm font-medium text-gray-700">
              Facebook page URL
              <input
                className={inputClass}
                value={settings.facebookUrl}
                placeholder="https://facebook.com/…"
                onChange={(event) => setSettings({ ...settings, facebookUrl: event.target.value })}
              />
            </label>
            <Button onClick={() => void patchSettings(integrationPatch(settings), 'Facebook configuration saved.')}>
              Save Facebook configuration
            </Button>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
            <h3 className="text-lg font-medium text-gray-900">Instagram</h3>
            <label className="block text-sm font-medium text-gray-700">
              Instagram profile URL
              <input
                className={inputClass}
                value={settings.instagramUrl}
                placeholder="https://instagram.com/…"
                onChange={(event) => setSettings({ ...settings, instagramUrl: event.target.value })}
              />
            </label>
            <Button onClick={() => void patchSettings(integrationPatch(settings), 'Instagram configuration saved.')}>
              Save Instagram configuration
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function integrationPatch(settings: BusinessSettings) {
  return {
    googleMapsName: settings.googleMapsName,
    googleMapsUrl: settings.googleMapsUrl,
    googlePlaceId: settings.googlePlaceId,
    facebookUrl: settings.facebookUrl,
    instagramUrl: settings.instagramUrl,
  };
}
