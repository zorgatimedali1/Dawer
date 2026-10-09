import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  className?: string;
  /** `sm` for inline slots (table body, panel), `md` for page-level gaps. */
  size?: 'sm' | 'md';
}

/**
 * Deliberately composed empty state: the brand mark stands in for an
 * illustration so every gap in the product reads as designed rather than
 * unfinished. Content is entirely caller-supplied.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  className,
  size = 'md',
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        size === 'md' ? 'gap-3 px-6 py-16' : 'gap-2.5 px-5 py-10',
        className,
      )}
    >
      <div className="relative">
        <span
          aria-hidden
          className="absolute inset-0 -z-10 animate-pulse-ring rounded-2xl bg-accent/25 motion-reduce:animate-none"
        />
        <span
          aria-hidden
          className={cn(
            'inline-flex items-center justify-center rounded-2xl border border-line bg-surface-2 text-brand-600 dark:bg-elevated dark:text-accent-bright',
            size === 'md' ? 'h-12 w-12' : 'h-10 w-10',
          )}
        >
          {Icon ? <Icon className={size === 'md' ? 'h-5 w-5' : 'h-4 w-4'} aria-hidden /> : null}
        </span>
      </div>
      <h3
        className={cn(
          'font-semibold tracking-[-0.01em] text-ink',
          size === 'md' ? 'text-[15px]' : 'text-sm',
        )}
      >
        {title}
      </h3>
      {description ? (
        <p className="max-w-sm text-balance text-[13px] leading-relaxed text-ink-muted">{description}</p>
      ) : null}
      {action || secondaryAction ? (
        <div className="mt-1.5 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}

export default EmptyState;