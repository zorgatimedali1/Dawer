'use client';

import { useAppContext } from '@/contexts/app-context';

export function LanguageSwitcher() {
  const { locale, setLocale } = useAppContext();

  return (
    <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      {(['fr', 'en'] as const).map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => setLocale(value)}
          className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide transition ${
            locale === value
              ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
          }`}
        >
          {value}
        </button>
      ))}
    </div>
  );
}
