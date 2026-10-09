import { useMemo } from 'react';
import { useOptionalAppContext } from '@/contexts/app-context';
import { translations, type Dictionary, type Locale } from '@/lib/i18n';

/**
 * Translation lookup bound to the active locale. Falls back to French when no
 * provider is mounted (tests, isolated renders) so copy never falls back to a
 * raw key.
 */
export function useT(): Dictionary {
  const locale = useLocale();
  return useMemo(() => translations[locale], [locale]);
}

/** Active locale, French when no provider is mounted. */
export function useLocale(): Locale {
  return useOptionalAppContext()?.locale ?? 'fr';
}

export default useT;
