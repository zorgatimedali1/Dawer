'use client';

import { useAppContext } from '@/contexts/app-context';
import { SegmentedControl } from '@/components/ui/segmented';
import { useT } from '@/hooks/use-t';
import { isPublicPathname, withLocale } from '@/lib/locale-url';
import type { Locale } from '@/lib/i18n';
import { useInRouterContext, useLocation, useNavigate } from 'react-router-dom';

const LANGUAGES = { fr: 'FR', en: 'EN' } as const;

const OPTIONS: { value: Locale; label: string; title: string }[] = [
  { value: 'fr', label: LANGUAGES.fr, title: 'Français' },
  { value: 'en', label: LANGUAGES.en, title: 'English' },
];

function SwitcherControl({
  className,
  onChange,
}: {
  className?: string | undefined;
  onChange: (locale: Locale) => void;
}) {
  const { locale } = useAppContext();
  const t = useT();

  return (
    <SegmentedControl<Locale>
      value={locale}
      onChange={onChange}
      aria-label={t.toggle.language}
      size="sm"
      selectedTone="brand"
      className={className}
      options={OPTIONS}
    />
  );
}

/**
 * FR/EN switch. Previously the active language was the only signal; the
 * selected pill now carries a brand fill so the state survives a glance.
 * On public marketing pages the URL prefix is authoritative, so switching
 * rewrites the path (/ ↔ /en) and lets the context sync follow; outside a
 * router (tests) or on private pages it falls back to the stored locale.
 */
export function LanguageSwitcher({ className }: { className?: string | undefined }) {
  const { setLocale } = useAppContext();
  const inRouter = useInRouterContext();

  if (!inRouter) {
    return <SwitcherControl className={className} onChange={setLocale} />;
  }

  return <RouterSwitcher className={className} />;
}

function RouterSwitcher({ className }: { className?: string | undefined }) {
  const { setLocale } = useAppContext();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const changeLocale = (next: Locale) => {
    if (isPublicPathname(pathname)) {
      navigate(withLocale(next, pathname));
      return;
    }
    setLocale(next);
  };

  return <SwitcherControl className={className} onChange={changeLocale} />;
}
