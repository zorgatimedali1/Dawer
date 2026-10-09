import * as React from 'react';
import { cn } from '@/lib/cn';

export type BadgeTone =
  | 'neutral'
  | 'brand'
  | 'success'
  | 'danger'
  | 'warning'
  | 'info'
  | 'outline';

export type BadgeSize = 'sm' | 'md';

export const badgeTones: Record<BadgeTone, string> = {
  neutral: 'bg-ink/[0.06] text-ink-muted ring-ink/10 dark:bg-white/[0.07] dark:text-ink-muted dark:ring-white/10',
  brand: 'bg-accent-soft text-brand-800 ring-accent/30 dark:bg-accent-soft dark:text-accent-bright dark:ring-accent/40',
  success:
    'bg-success-100 text-success-800 ring-success-600/25 dark:bg-success-900/45 dark:text-success-200 dark:ring-success-400/25',
  danger:
    'bg-danger-100 text-danger-800 ring-danger-600/25 dark:bg-danger-900/45 dark:text-danger-200 dark:ring-danger-400/25',
  warning:
    'bg-warning-100 text-warning-800 ring-warning-600/25 dark:bg-warning-900/45 dark:text-warning-200 dark:ring-warning-400/25',
  info: 'bg-info-100 text-info-800 ring-info-600/25 dark:bg-info-900/45 dark:text-info-200 dark:ring-info-400/25',
  outline: 'bg-transparent text-ink-muted ring-line-strong dark:text-ink-muted dark:ring-line-strong',
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  size?: BadgeSize;
  /** Renders a leading dot — reads as a status indicator rather than a label. */
  dot?: boolean;
  /** Uppercases and widens the label for dense table headers and filters. */
  uppercase?: boolean;
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { className, tone = 'neutral', size = 'md', dot = false, uppercase = false, children, ...props },
  ref,
) {
  return (
    <span
      ref={ref}
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full font-medium ring-1 ring-inset',
        'whitespace-nowrap transition-colors duration-180',
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
        uppercase && 'uppercase tracking-[0.07em]',
        badgeTones[tone],
        className,
      )}
      {...props}
    >
      {dot ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden /> : null}
      {children}
    </span>
  );
});

export default Badge;