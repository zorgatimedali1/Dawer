import * as React from 'react';
import { cn } from '@/lib/cn';

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
  title?: string;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<SegmentedOption<T>>;
  size?: 'sm' | 'md';
  /** `neutral` lifts the active pill off the track; `brand` fills it with Dawer green. */
  selectedTone?: 'neutral' | 'brand';
  className?: string | undefined;
  'aria-label'?: string;
}

/**
 * Slider-style segmented control used for filters, period pickers, the theme
 * switch and the language switch. Selection is conveyed by the brand green
 * fill plus `aria-checked`, never by colour alone.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  selectedTone = 'neutral',
  className,
  'aria-label': ariaLabel,
}: SegmentedControlProps<T>) {
  const listRef = React.useRef<HTMLDivElement>(null);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const enabled = options.filter((o) => !o.disabled);
    if (enabled.length === 0) return;
    event.preventDefault();
    const index = enabled.findIndex((o) => o.value === value);
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % enabled.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + enabled.length) % enabled.length
          : event.key === 'Home'
            ? 0
            : enabled.length - 1;
    const target = enabled[next];
    if (target) {
      onChange(target.value);
      const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
      buttons?.[next]?.focus();
    }
  };

  return (
    <div
      ref={listRef}
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5',
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={option.disabled}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-[7px] font-medium whitespace-nowrap',
              'transition-[background-color,color,box-shadow] duration-180 ease-swift',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
              'disabled:cursor-not-allowed disabled:opacity-50',
              size === 'sm' ? 'h-7 px-2.5 text-[12.5px]' : 'h-8 px-3 text-[13px]',
              selected
                ? selectedTone === 'brand'
                  ? 'bg-brand-500 text-accent-ink shadow-xs dark:bg-brand-400 dark:shadow-none'
                  : 'bg-elevated text-ink shadow-xs ring-1 ring-line dark:bg-elevated dark:text-ink'
                : 'text-ink-muted hover:text-ink',
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export default SegmentedControl;