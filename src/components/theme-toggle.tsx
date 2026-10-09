'use client';

import { Moon, SunMedium } from 'lucide-react';
import { useAppContext } from '@/contexts/app-context';
import { useT } from '@/hooks/use-t';
import { cn } from '@/lib/cn';

/**
 * Two-state switch. The knob slides with a spring-ish curve and the icon
 * crossfades, so switching theme reads as a deliberate transition rather than
 * a repaint. Behaviour (read + write theme) is unchanged.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useAppContext();
  const t = useT();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      aria-label={t.toggle.toggleTheme}
      aria-pressed={isDark}
      title={isDark ? t.toggle.switchToLight : t.toggle.switchToDark}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className={cn(
        'group relative inline-flex h-9 w-[68px] shrink-0 items-center rounded-full border border-line bg-surface-2 p-1',
        'transition-colors duration-240 ease-swift hover:border-line-strong',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'relative flex h-7 w-7 items-center justify-center rounded-full shadow-xs',
          'transition-transform duration-320 ease-swift motion-reduce:transition-none',
          isDark
            ? 'translate-x-[32px] bg-brand-400 text-accent-ink'
            : 'translate-x-0 bg-elevated text-ink-muted',
        )}
      >
        <SunMedium
          className={cn(
            'absolute h-3.5 w-3.5 transition-all duration-240',
            isDark ? 'scale-0 opacity-0' : 'scale-100 opacity-100',
          )}
        />
        <Moon
          className={cn(
            'absolute h-3.5 w-3.5 transition-all duration-240',
            isDark ? 'scale-100 opacity-100' : 'scale-0 opacity-0',
          )}
        />
      </span>
    </button>
  );
}