"use client";

import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Building2,
  Check,
  Facebook,
  Globe,
  Instagram,
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
import { Input, Textarea } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton, Spinner } from '@/components/ui/skeleton';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { msg } from '@/lib/i18n';
import { useT } from '@/hooks/use-t';
import {
  SettingsService,
  type BusinessSettings,
  type Profile,
} from '@/services/settings.service';

type TabKey = 'profile' | 'business' | 'security' | 'branding' | 'integrations';

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
    } catch (caught) {
      setError(msg(t, caught instanceof Error ? caught.message : 'Unable to load settings.'));
    } finally {
      setLoading(false);
    }
  }, [t]);

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
            <Field label={t.settings.businessDescription} htmlFor="business-description">
              <Textarea
                id="business-description"
                rows={3}
                value={settings.description}
                onChange={(event) => setSettings({ ...settings, description: event.target.value })}
              />
            </Field>
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
                    description: settings.description,
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
            <div className={FIELD_GRID}>
              <Field label={t.settings.primaryColor} htmlFor="branding-primary-picker">
                <div className="flex items-center gap-3">
                  <input
                    id="branding-primary-picker"
                    type="color"
                    aria-label={t.settings.primaryColorPicker}
                    className="h-10 w-14 shrink-0 cursor-pointer rounded-md border border-line bg-elevated p-1"
                    value={settings.primaryColor}
                    onChange={(event) => setSettings({ ...settings, primaryColor: event.target.value })}
                  />
                  <Input
                    id="branding-primary-value"
                    aria-label={t.settings.primaryColorValue}
                    className="numeric flex-1"
                    value={settings.primaryColor}
                    onChange={(event) => setSettings({ ...settings, primaryColor: event.target.value })}
                  />
                </div>
              </Field>
              <Field label={t.settings.secondaryColor} htmlFor="branding-secondary-picker">
                <div className="flex items-center gap-3">
                  <input
                    id="branding-secondary-picker"
                    type="color"
                    aria-label={t.settings.secondaryColorPicker}
                    className="h-10 w-14 shrink-0 cursor-pointer rounded-md border border-line bg-elevated p-1"
                    value={settings.secondaryColor}
                    onChange={(event) => setSettings({ ...settings, secondaryColor: event.target.value })}
                  />
                  <Input
                    id="branding-secondary-value"
                    aria-label={t.settings.secondaryColorValue}
                    className="numeric flex-1"
                    value={settings.secondaryColor}
                    onChange={(event) => setSettings({ ...settings, secondaryColor: event.target.value })}
                  />
                </div>
              </Field>
            </div>

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
                      const logo = await SettingsService.uploadLogo(file);
                      setSettings((current) => (current ? { ...current, logo } : current));
                    }, t.settings.logoSaved);
                  }}
                />
              </Field>
            </div>
          </CardContent>
          <CardFooter>
            <Button
              disabled={pending || !/^#[\da-f]{6}$/i.test(settings.primaryColor) || !/^#[\da-f]{6}$/i.test(settings.secondaryColor)}
              onClick={() =>
                void patchSettings(
                  {
                    primaryColor: settings.primaryColor,
                    secondaryColor: settings.secondaryColor,
                    logo: settings.logo,
                  },
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
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <p className={SECTION_LABEL}>{t.settings.googleSection}</p>
              <CardTitle className="text-lg">{t.settings.googleMapsTitle}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Field label={t.settings.googleMapsName} htmlFor="google-maps-name">
                <Input
                  id="google-maps-name"
                  value={settings.googleMapsName}
                  placeholder={t.settings.googleMapsNamePlaceholder}
                  onChange={(event) => setSettings({ ...settings, googleMapsName: event.target.value })}
                />
              </Field>
              <Field label={t.settings.googleMapsUrl} htmlFor="google-maps-url">
                <Input
                  id="google-maps-url"
                  value={settings.googleMapsUrl}
                  placeholder={t.settings.googleMapsUrlPlaceholder}
                  onChange={(event) => setSettings({ ...settings, googleMapsUrl: event.target.value })}
                />
              </Field>
              <Field label={t.settings.googlePlaceId} htmlFor="google-place-id">
                <Input
                  id="google-place-id"
                  value={settings.googlePlaceId}
                  placeholder={t.settings.googlePlaceIdPlaceholder}
                  onChange={(event) => setSettings({ ...settings, googlePlaceId: event.target.value })}
                />
              </Field>
            </CardContent>
            <CardFooter>
              <Button disabled={pending || !validOptionalUrl(settings.googleMapsUrl)} onClick={() => void patchSettings(integrationPatch(settings), t.settings.googleSaved)}>
                <Save className="h-4 w-4" aria-hidden />
                {t.settings.saveGoogle}
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-lg">{t.settings.facebook}</CardTitle>
              <Facebook className="h-4 w-4 text-ink-subtle" aria-hidden />
            </CardHeader>
            <CardContent>
              <Field label={t.settings.facebookPageUrl} htmlFor="integration-facebook">
                <Input
                  id="integration-facebook"
                  type="url"
                  value={settings.facebookUrl}
                  placeholder={t.settings.facebookPlaceholder}
                  onChange={(event) => setSettings({ ...settings, facebookUrl: event.target.value })}
                />
              </Field>
            </CardContent>
            <CardFooter>
              <Button disabled={pending || !validOptionalUrl(settings.facebookUrl)} onClick={() => void patchSettings(integrationPatch(settings), t.settings.facebookSaved)}>
                <Save className="h-4 w-4" aria-hidden />
                {t.settings.saveFacebook}
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-lg">{t.settings.instagram}</CardTitle>
              <Instagram className="h-4 w-4 text-ink-subtle" aria-hidden />
            </CardHeader>
            <CardContent>
              <Field label={t.settings.instagramProfileUrl} htmlFor="integration-instagram">
                <Input
                  id="integration-instagram"
                  type="url"
                  value={settings.instagramUrl}
                  placeholder={t.settings.instagramPlaceholder}
                  onChange={(event) => setSettings({ ...settings, instagramUrl: event.target.value })}
                />
              </Field>
            </CardContent>
            <CardFooter>
              <Button disabled={pending || !validOptionalUrl(settings.instagramUrl)} onClick={() => void patchSettings(integrationPatch(settings), t.settings.instagramSaved)}>
                <Save className="h-4 w-4" aria-hidden />
                {t.settings.saveInstagram}
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <p className={SECTION_LABEL}>{t.settings.socialSection}</p>
              <CardTitle className="text-lg">{t.settings.socialTitle}</CardTitle>
            </CardHeader>
            <CardContent className={FIELD_GRID}>
              <Field label={t.settings.twitterUrl} htmlFor="integration-twitter">
                <Input
                  id="integration-twitter"
                  type="url"
                  value={settings.twitterUrl ?? ''}
                  placeholder={t.settings.twitterPlaceholder}
                  onChange={(event) => setSettings({ ...settings, twitterUrl: event.target.value })}
                />
              </Field>
              <Field label={t.settings.linkedinUrl} htmlFor="integration-linkedin">
                <Input
                  id="integration-linkedin"
                  type="url"
                  value={settings.linkedinUrl ?? ''}
                  placeholder={t.settings.linkedinPlaceholder}
                  onChange={(event) => setSettings({ ...settings, linkedinUrl: event.target.value })}
                />
              </Field>
              <Field label={t.settings.tiktokUrl} htmlFor="integration-tiktok">
                <Input
                  id="integration-tiktok"
                  type="url"
                  value={settings.tiktokUrl ?? ''}
                  placeholder={t.settings.tiktokPlaceholder}
                  onChange={(event) => setSettings({ ...settings, tiktokUrl: event.target.value })}
                />
              </Field>
              <Field label={t.settings.youtubeUrl} htmlFor="integration-youtube">
                <Input
                  id="integration-youtube"
                  type="url"
                  value={settings.youtubeUrl ?? ''}
                  placeholder={t.settings.youtubePlaceholder}
                  onChange={(event) => setSettings({ ...settings, youtubeUrl: event.target.value })}
                />
              </Field>
            </CardContent>
            <CardFooter>
              <Button
                disabled={pending || !validOptionalUrl(settings.twitterUrl ?? '') || !validOptionalUrl(settings.linkedinUrl ?? '') || !validOptionalUrl(settings.tiktokUrl ?? '') || !validOptionalUrl(settings.youtubeUrl ?? '')}
                onClick={() => void patchSettings(integrationPatch(settings), t.settings.socialSaved)}
              >
                <Globe className="h-4 w-4" aria-hidden />
                {t.settings.saveSocial}
              </Button>
            </CardFooter>
          </Card>
        </div>
      </TabPanel>
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
    twitterUrl: settings.twitterUrl,
    linkedinUrl: settings.linkedinUrl,
    tiktokUrl: settings.tiktokUrl,
    youtubeUrl: settings.youtubeUrl,
  };
}
