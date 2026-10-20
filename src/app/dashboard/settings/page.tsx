"use client";

import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Building2,
  Check,
  ExternalLink,
  KeyRound,
  Palette,
  Plug,
  Save,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton, Spinner } from '@/components/ui/skeleton';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { cn } from '@/lib/cn';
import { getGoogleMapsUrl } from '@/lib/google-maps';
import { msg } from '@/lib/i18n';
import { prepareLogoUpload } from '@/lib/optimize-image';
import { useT } from '@/hooks/use-t';
import {
  SettingsService,
  type BusinessSettings,
  type Profile,
} from '@/services/settings.service';

type TabKey = 'profile' | 'business' | 'security' | 'branding' | 'integrations';

interface PlaceSuggestion {
  placeId: string;
  label: string;
  mainText: string;
  secondaryText: string;
}

const FIELD_GRID = 'grid gap-4 sm:grid-cols-2';
const SECTION_LABEL = 'text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle';

function validOptionalUrl(value: string): boolean {
  return value.trim() === '' || URL.canParse(value.trim());
}

function validEmail(value: string): boolean {
  return value === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function Status({ pending, message, error }: { pending: boolean; message: string; error: string }) {
  const t = useT();
  if (pending) {
    return (
      <p className="inline-flex items-center gap-2 text-[13px] text-ink-muted">
        <Spinner className="h-3.5 w-3.5" />
        {t.settings.saving}
      </p>
    );
  }
  if (error) {
    return (
      <p className="inline-flex items-center gap-2 text-[13px] font-medium text-danger-600 dark:text-danger-300">
        <AlertCircle className="h-3.5 w-3.5" aria-hidden />
        {error}
      </p>
    );
  }
  if (message) {
    return (
      <p className="inline-flex items-center gap-2 text-[13px] font-medium text-success-700 dark:text-success-300">
        <Check className="h-3.5 w-3.5" aria-hidden />
        {message}
      </p>
    );
  }
  return null;
}

export default function SettingsPage() {
  const t = useT();
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

  const [googleSearch, setGoogleSearch] = useState('');
  const [googlePlaceId, setGooglePlaceId] = useState('');
  const [placeSuggestions, setPlaceSuggestions] = useState<PlaceSuggestion[]>([]);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [placesLoading, setPlacesLoading] = useState(false);
  const [placesError, setPlacesError] = useState('');

  const tabItems = [
    { value: 'profile', label: t.settings.tabProfile, icon: <UserRound className="h-3.5 w-3.5" aria-hidden /> },
    { value: 'business', label: t.settings.tabBusiness, icon: <Building2 className="h-3.5 w-3.5" aria-hidden /> },
    { value: 'security', label: t.settings.tabSecurity, icon: <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> },
    { value: 'branding', label: t.settings.tabBranding, icon: <Palette className="h-3.5 w-3.5" aria-hidden /> },
    { value: 'integrations', label: t.settings.tabIntegrations, icon: <Plug className="h-3.5 w-3.5" aria-hidden /> },
  ];

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
      setGoogleSearch(loadedSettings.googleMapsName || loadedSettings.googleMapsUrl);
      setGooglePlaceId(loadedSettings.googlePlaceId);
    } catch (caught) {
      setError(msg(t, caught instanceof Error ? caught.message : 'Unable to load settings.'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const input = googleSearch.trim();

    if (googlePlaceId || input.length < 3 || /^https?:\/\//i.test(input)) {
      setPlaceSuggestions([]);
      setPlacesError('');
      setPlacesLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setPlacesLoading(true);
      setPlacesError('');

      try {
        const response = await fetch(`/api/places/autocomplete?input=${encodeURIComponent(input)}`, {
          signal: controller.signal,
        });
        const result = await response.json() as {
          success: boolean;
          suggestions?: PlaceSuggestion[];
          error?: string;
        };

        if (!response.ok || !result.success) {
          throw new Error(result.error ?? 'Place suggestions are unavailable.');
        }

        setPlaceSuggestions(result.suggestions ?? []);
        setActiveSuggestion(-1);
      } catch (caught) {
        if (!controller.signal.aborted) {
          setPlaceSuggestions([]);
          setPlacesError(caught instanceof Error ? caught.message : 'Place suggestions are unavailable.');
        }
      } finally {
        if (!controller.signal.aborted) setPlacesLoading(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [googleSearch, googlePlaceId]);

  const save = async (action: () => Promise<void>, successMessage: string) => {
    setPending(true);
    setStatus('');
    setError('');
    try {
      await action();
      setStatus(successMessage);
    } catch (caught) {
      setError(msg(t, caught instanceof Error ? caught.message : 'Unable to save.'));
    } finally {
      setPending(false);
    }
  };

  const patchSettings = (changes: Parameters<typeof SettingsService.updateSettings>[0], message: string) =>
    save(async () => {
      const updated = await SettingsService.updateSettings(changes);
      setSettings(updated);
    }, message);

  const choosePlace = (suggestion: PlaceSuggestion) => {
    setGoogleSearch(suggestion.label);
    setGooglePlaceId(suggestion.placeId);
    setPlaceSuggestions([]);
    setPlacesError('');
    setActiveSuggestion(-1);
  };

  const handlePlaceInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setPlaceSuggestions([]);
      setActiveSuggestion(-1);
      return;
    }

    if (!placeSuggestions.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveSuggestion((current) => (current + 1) % placeSuggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveSuggestion((current) => (current <= 0 ? placeSuggestions.length - 1 : current - 1));
    } else if (event.key === 'Enter' && activeSuggestion >= 0) {
      event.preventDefault();
      const suggestion = placeSuggestions[activeSuggestion];
      if (suggestion) choosePlace(suggestion);
    }
  };

  const noBusiness = !loading && !settings && error.startsWith('Create a business');

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-40" />
        </div>
        <Card>
          <CardContent className="flex items-center gap-3 py-6">
            <Spinner className="text-ink-subtle" />
            <span className="text-[13.5px] text-ink-muted">{t.settings.loading}</span>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (noBusiness) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader eyebrow={t.settings.account} title={t.settings.title} />
        <p className="text-[13.5px] text-ink-muted">{t.settings.createBusinessFirst}</p>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader eyebrow={t.settings.account} title={t.settings.title} />
        <div className="rounded-xl border border-danger-300/60 bg-danger-50 p-5 text-sm text-danger-800 dark:border-danger-900/60 dark:bg-danger-900/30 dark:text-danger-200">
          {error || msg(t, 'Unable to load settings.')}
        </div>
        <div>
          <Button variant="outline" onClick={() => void load()}>
            {t.common.retry}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={t.settings.account}
        title={t.settings.title}
        description={t.settings.description}
        actions={<Status pending={pending} message={status} error={error} />}
      />

      <Tabs
        value={tab}
        onChange={(next) => setTab(next as TabKey)}
        items={tabItems}
        aria-label={t.settings.sectionsLabel}
        idPrefix="settings"
      />

      <TabPanel value="profile" active={tab} idPrefix="settings">
        <Card>
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-4 space-y-0">
            <div className="flex min-w-0 items-start gap-3.5">
              <Avatar size="lg" name={`${firstName} ${lastName}`} src={profile?.avatarUrl ?? null} />
              <div className="min-w-0 space-y-1">
                <p className={SECTION_LABEL}>{t.settings.account}</p>
                <CardTitle className="text-lg">{t.settings.profileTitle}</CardTitle>
                <p className="text-[13.5px] text-ink-muted">
                  {profile?.email} {profile?.emailVerified ? t.settings.verified : t.settings.unverified}
                </p>
              </div>
            </div>
            <Badge tone={profile?.emailVerified ? 'success' : 'warning'} size="sm" dot>
              {profile?.emailVerified ? t.settings.emailVerified : t.settings.emailUnverified}
            </Badge>
          </CardHeader>
          <CardContent className={FIELD_GRID}>
            <Field label={t.settings.firstName} htmlFor="profile-first-name">
              <Input
                id="profile-first-name"
                required
                minLength={1}
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
              />
            </Field>
            <Field label={t.settings.lastName} htmlFor="profile-last-name">
              <Input
                id="profile-last-name"
                required
                minLength={1}
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
              />
            </Field>
          </CardContent>
          <CardFooter>
            <Button
              disabled={pending || !firstName.trim() || !lastName.trim()}
              onClick={() =>
                void save(async () => {
                  const updated = await SettingsService.updateProfile({ firstName, lastName });
                  setProfile((current) => (current ? { ...current, ...updated } : updated));
                }, t.settings.profileUpdated)
              }
            >
              <Save className="h-4 w-4" aria-hidden />
              {t.settings.saveProfile}
            </Button>
          </CardFooter>
        </Card>
      </TabPanel>

      <TabPanel value="business" active={tab} idPrefix="settings">
        <Card>
          <CardHeader>
            <p className={SECTION_LABEL}>{t.settings.tabBusiness}</p>
            <CardTitle className="text-lg">{t.settings.businessTitle}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className={FIELD_GRID}>
              <Field label={t.settings.businessName} htmlFor="business-name">
                <Input
                  id="business-name"
                  value={settings.name}
                  onChange={(event) => setSettings({ ...settings, name: event.target.value })}
                />
              </Field>
              <Field label={t.settings.timezone} htmlFor="business-timezone">
                <Input
                  id="business-timezone"
                  value={settings.timezone}
                  onChange={(event) => setSettings({ ...settings, timezone: event.target.value })}
                />
              </Field>
              <Field label={t.settings.website} htmlFor="business-website">
                <Input
                  id="business-website"
                  value={settings.website}
                  type="url"
                  onChange={(event) => setSettings({ ...settings, website: event.target.value })}
                />
              </Field>
              <Field label={t.settings.phone} htmlFor="business-phone">
                <Input
                  id="business-phone"
                  value={settings.phone}
                  type="tel"
                  onChange={(event) => setSettings({ ...settings, phone: event.target.value })}
                />
              </Field>
              <Field label={t.settings.contactEmail} htmlFor="business-email">
                <Input
                  id="business-email"
                  value={settings.email}
                  type="email"
                  onChange={(event) => setSettings({ ...settings, email: event.target.value })}
                />
              </Field>
              <Field label={t.settings.address} htmlFor="business-address">
                <Input
                  id="business-address"
                  value={settings.address}
                  onChange={(event) => setSettings({ ...settings, address: event.target.value })}
                />
              </Field>
            </div>
          </CardContent>
          <CardFooter>
            <Button
              disabled={pending || settings.name.trim().length < 2 || !validOptionalUrl(settings.website) || !validEmail(settings.email)}
              onClick={() =>
                void patchSettings(
                  {
                    name: settings.name,
                    timezone: settings.timezone,
                    website: settings.website,
                    phone: settings.phone,
                    email: settings.email,
                    address: settings.address,
                    // This tab has no description field — sending '' would wipe
                    // the stored description on every save, so omit it instead.
                  },
                  t.settings.businessSaved,
                )
              }
            >
              <Save className="h-4 w-4" aria-hidden />
              {t.settings.saveBusiness}
            </Button>
          </CardFooter>
        </Card>
      </TabPanel>

      <TabPanel value="security" active={tab} idPrefix="settings">
        <Card>
          <CardHeader>
            <p className={SECTION_LABEL}>{t.settings.tabSecurity}</p>
            <CardTitle className="text-lg">{t.settings.securityTitle}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {profile?.hasPassword ? (
              <>
                <p className="text-[13.5px] leading-relaxed text-ink-muted">
                  {t.settings.passwordChangeHint}
                </p>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label={t.settings.currentPassword} htmlFor="security-current">
                    <Input
                      id="security-current"
                      type="password"
                      value={passwords.current}
                      onChange={(event) => setPasswords({ ...passwords, current: event.target.value })}
                    />
                  </Field>
                  <Field label={t.settings.newPassword} htmlFor="security-next">
                    <Input
                      id="security-next"
                      type="password"
                      value={passwords.next}
                      onChange={(event) => setPasswords({ ...passwords, next: event.target.value })}
                    />
                  </Field>
                  <Field label={t.settings.confirmPassword} htmlFor="security-confirm">
                    <Input
                      id="security-confirm"
                      type="password"
                      value={passwords.confirm}
                      onChange={(event) => setPasswords({ ...passwords, confirm: event.target.value })}
                    />
                  </Field>
                </div>
              </>
            ) : (
              <p className="text-[13.5px] leading-relaxed text-ink-muted">{t.settings.googleOnly}</p>
            )}
          </CardContent>
          {profile?.hasPassword ? (
            <CardFooter>
              <Button
                disabled={pending || passwords.current.length < 8 || passwords.next.length < 8 || passwords.next !== passwords.confirm}
                onClick={() => {
                  if (passwords.next !== passwords.confirm) {
                    setError(t.settings.passwordMismatch);
                    return;
                  }
                  if (passwords.next.length < 8) {
                    setError(t.settings.passwordTooShort);
                    return;
                  }
                  void save(async () => {
                    const message = await SettingsService.changePassword(passwords.current, passwords.next);
                    setPasswords({ current: '', next: '', confirm: '' });
                    setStatus(message);
                  }, t.settings.passwordUpdated);
                }}
              >
                <KeyRound className="h-4 w-4" aria-hidden />
                {t.settings.changePassword}
              </Button>
            </CardFooter>
          ) : null}
        </Card>
      </TabPanel>

      <TabPanel value="branding" active={tab} idPrefix="settings">
        <Card>
          <CardHeader>
            <p className={SECTION_LABEL}>{t.settings.tabBranding}</p>
            <CardTitle className="text-lg">{t.settings.brandingTitle}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="flex flex-col gap-3 border-t border-line pt-5">
              <p className={SECTION_LABEL}>{t.settings.companyLogo}</p>
              {settings.logo ? (
                <div className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-surface-2/60 p-4">
                  <img
                    src={settings.logo}
                    alt={t.settings.companyLogo}
                    data-testid="business-logo-preview"
                    className="h-16 w-auto rounded-md border border-line bg-elevated object-contain p-1"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (!window.confirm(t.settings.removeLogoConfirm)) {
                        return;
                      }
                      void save(async () => {
                        const logo = await SettingsService.deleteLogo();
                        setSettings((current) => (current ? { ...current, logo } : current));
                      }, t.settings.logoRemoved);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    {t.settings.removeLogo}
                  </Button>
                </div>
              ) : null}
              <Field
                label={t.settings.chooseLogo}
                htmlFor="branding-logo-upload"
                hint={t.settings.logoHint}
              >
                <Input
                  id="branding-logo-upload"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                  className="file:mr-3 file:rounded-md file:border-0 file:bg-accent-soft file:px-3 file:py-1.5 file:text-[12.5px] file:font-semibold file:text-brand-800 dark:file:text-accent-bright"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (!file) return;
                    void save(async () => {
                      // Optimize before upload so phone photos shrink below the
                      // backend's 512 KB limit instead of failing with a 413/500.
                      const optimized = await prepareLogoUpload(file, msg(t, 'The logo must be 512 KB or smaller.'));
                      const logo = await SettingsService.uploadLogo(optimized);
                      setSettings((current) => (current ? { ...current, logo } : current));
                    }, t.settings.logoSaved);
                  }}
                />
              </Field>
            </div>
          </CardContent>
          <CardFooter>
            <Button
              disabled={pending}
              onClick={() =>
                void patchSettings(
                  { logo: settings.logo },
                  t.settings.brandingSaved,
                )
              }
            >
              <Save className="h-4 w-4" aria-hidden />
              {t.settings.saveBranding}
            </Button>
          </CardFooter>
        </Card>
      </TabPanel>

      <TabPanel value="integrations" active={tab} idPrefix="settings">
        <Card>
          <CardHeader>
            <p className={SECTION_LABEL}>{t.settings.tabIntegrations}</p>
            <CardTitle className="text-lg">{t.settings.integrationsCardTitle}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field label={t.settings.googleMapsTitle} htmlFor="google-maps-search">
              <div className="relative">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="google-maps-search"
                    inputSize="sm"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={placeSuggestions.length > 0}
                    aria-controls="google-place-suggestions"
                    aria-activedescendant={activeSuggestion >= 0 ? `google-place-option-${activeSuggestion}` : undefined}
                    value={googleSearch}
                    onChange={(event) => {
                      setGoogleSearch(event.target.value);
                      setGooglePlaceId('');
                    }}
                    onKeyDown={handlePlaceInputKeyDown}
                    placeholder={t.settings.googleSearchPlaceholder}
                    autoComplete="off"
                    className="min-w-0 flex-1"
                  />
                  {googlePlaceId ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setGoogleSearch('');
                        setGooglePlaceId('');
                        setPlaceSuggestions([]);
                      }}
                    >
                      {t.settings.clearPlace}
                    </Button>
                  ) : (
                    <a
                      href={getGoogleMapsUrl(googleSearch, googlePlaceId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-disabled={!googleSearch.trim()}
                      className={cn(
                        'inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border px-3 text-[13px] font-medium transition-colors duration-180 ease-swift',
                        googleSearch.trim()
                          ? 'border-line-strong text-ink hover:border-accent hover:bg-accent-soft'
                          : 'pointer-events-none border-line text-ink-subtle opacity-60',
                      )}
                    >
                      <ExternalLink className="h-4 w-4" aria-hidden />
                      {t.settings.openLink}
                    </a>
                  )}
                </div>

                {placeSuggestions.length > 0 || placesLoading || placesError ? (
                  <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-md border border-line bg-elevated shadow-pop">
                    {placesLoading ? (
                      <p className="px-3.5 py-2.5 text-[13px] text-ink-subtle">{t.common.loading}</p>
                    ) : null}
                    {placesError ? (
                      <p role="status" className="px-3.5 py-2.5 text-[13px] font-medium text-warning-700 dark:text-warning-300">
                        {placesError}
                      </p>
                    ) : null}
                    {placeSuggestions.length > 0 ? (
                      <>
                        <ul id="google-place-suggestions" role="listbox" aria-label={t.settings.googleMapsTitle}>
                          {placeSuggestions.map((suggestion, index) => (
                            <li key={suggestion.placeId} role="presentation">
                              <button
                                id={`google-place-option-${index}`}
                                type="button"
                                role="option"
                                aria-selected={index === activeSuggestion}
                                onMouseEnter={() => setActiveSuggestion(index)}
                                onClick={() => choosePlace(suggestion)}
                                className={cn(
                                  'w-full px-3.5 py-2.5 text-left transition-colors duration-150',
                                  index === activeSuggestion
                                    ? 'bg-accent-soft text-brand-800 dark:bg-accent-soft dark:text-accent-bright'
                                    : 'text-ink hover:bg-ink/[0.045]',
                                )}
                              >
                                <span className="block text-[13px] font-medium">{suggestion.mainText}</span>
                                {suggestion.secondaryText ? (
                                  <span className="mt-0.5 block text-[12px] text-ink-subtle">
                                    {suggestion.secondaryText}
                                  </span>
                                ) : null}
                              </button>
                            </li>
                          ))}
                        </ul>
                        <div className="border-t border-line px-3.5 py-1.5 text-right text-[11px] text-[#5e5e5e]" translate="no">
                          Google Maps
                        </div>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t.settings.facebookPageUrl} htmlFor="integration-facebook">
                <Input
                  id="integration-facebook"
                  type="url"
                  value={settings.facebookUrl}
                  placeholder={t.settings.facebookPlaceholder}
                  onChange={(event) => setSettings({ ...settings, facebookUrl: event.target.value })}
                />
              </Field>
              <Field label={t.settings.instagramProfileUrl} htmlFor="integration-instagram">
                <Input
                  id="integration-instagram"
                  type="url"
                  value={settings.instagramUrl}
                  placeholder={t.settings.instagramPlaceholder}
                  onChange={(event) => setSettings({ ...settings, instagramUrl: event.target.value })}
                />
              </Field>
            </div>
          </CardContent>
          <CardFooter>
            <Button
              disabled={pending || !validOptionalUrl(settings.facebookUrl) || !validOptionalUrl(settings.instagramUrl)}
              onClick={() => void patchSettings(integrationPatch(settings, googleSearch, googlePlaceId), t.settings.configSaved)}
            >
              <Save className="h-4 w-4" aria-hidden />
              {t.settings.saveConfig}
            </Button>
          </CardFooter>
        </Card>
      </TabPanel>
    </div>
  );
}

function integrationPatch(settings: BusinessSettings, googleSearch: string, googlePlaceId: string) {
  const name = googleSearch.trim();
  // Only send fields this tab actually edits. The four social networks the
  // UI dropped are omitted (undefined), so the backend leaves their stored
  // values untouched instead of nulling them on every save.
  return {
    googleMapsName: name,
    googleMapsUrl: name ? getGoogleMapsUrl(googleSearch, googlePlaceId || undefined) : '',
    googlePlaceId,
    facebookUrl: settings.facebookUrl,
    instagramUrl: settings.instagramUrl,
  };
}
