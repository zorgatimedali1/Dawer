import * as React from 'react';
import { cn } from '@/lib/cn';

export interface TabItem {
  value: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  value: string;
  onChange: (value: string) => void;
  items: ReadonlyArray<TabItem>;
  className?: string;
  'aria-label'?: string;
  idPrefix?: string;
}

/**
 * Underline tab bar. The active tab drives a brand-green indicator and the
 * panel below is left entirely to the caller, so page content is untouched.
 */
export function Tabs({ value, onChange, items, className, 'aria-label': ariaLabel, idPrefix = 'tab' }: TabsProps) {
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const enabled = items.filter((i) => !i.disabled);
    if (enabled.length === 0) return;
    event.preventDefault();
    const index = enabled.findIndex((i) => i.value === value);
    const next = event.key === 'ArrowRight' ? (index + 1) % enabled.length : (index - 1 + enabled.length) % enabled.length;
    const target = enabled[next];
    if (!target) return;
    onChange(target.value);
    document.getElementById(`${idPrefix}-${target.value}`)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn(
        'dw-scroll flex items-center gap-1 overflow-x-auto border-b border-line',
        className,
      )}
    >
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            id={`${idPrefix}-${item.value}`}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-controls={`${idPrefix}-${item.value}-panel`}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange(item.value)}
            className={cn(
              'group relative inline-flex items-center gap-2 whitespace-nowrap px-3 py-2.5 text-[13.5px] font-medium',
              'transition-colors duration-180 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-inset',
              'disabled:cursor-not-allowed disabled:opacity-50',
              selected ? 'text-ink' : 'text-ink-muted hover:text-ink',
            )}
          >
            {item.icon}
            {item.label}
            {item.badge}
            <span
              aria-hidden
              className={cn(
                'absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-500 transition-transform duration-240 ease-swift dark:bg-brand-400',
                selected ? 'scale-x-100 opacity-100' : 'scale-x-0 opacity-0 group-hover:scale-x-100 group-hover:opacity-40',
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

export interface TabPanelProps {
  value: string;
  active: string;
  idPrefix?: string;
  className?: string;
  children: React.ReactNode;
}

export function TabPanel({ value, active, idPrefix = 'tab', className, children }: TabPanelProps) {
  if (value !== active) return null;
  return (
    <div
      id={`${idPrefix}-${value}-panel`}
      role="tabpanel"
      aria-labelledby={`${idPrefix}-${value}`}
      tabIndex={0}
      className={cn('animate-slide-up focus-visible:outline-none', className)}
    >
      {children}
    </div>
  );
}

export default Tabs;