'use client';

import { useAppContext } from '@/contexts/app-context';
import { SegmentedControl } from '@/components/ui/segmented';
import { useT } from '@/hooks/use-t';
import type { Locale } from '@/lib/i18n';

const LANGUAGES = { fr: 'FR', en: 'EN' } as const;

/**
 * FR/EN switch. Previously the active language was the only signal; the
 * selected pill now carries a brand fill so the state survives a glance.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, setLocale } = useAppContext();
  const t = useT();

  return (
    <SegmentedControl<Locale>
      value={locale}
      onChange={setLocale}
      aria-label={t.toggle.language}
      size="sm"
      selectedTone="brand"
      className={className}
      options={[
        { value: 'fr', label: LANGUAGES.fr, title: 'Français' },
        { value: 'en', label: LANGUAGES.en, title: 'English' },
      ]}
    />
  );
}