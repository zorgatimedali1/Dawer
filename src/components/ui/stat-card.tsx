import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Card } from '@/components/ui/card';

export interface StatCardProps {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Rendered as a badge; tone controls whether it reads positive or negative. */
  delta?: React.ReactNode;
  deltaTone?: 'positive' | 'negative' | 'neutral';
  icon?: LucideIcon;
  hint?: React.ReactNode;
  footer?: React.ReactNode;
  /** Highlights the card as the primary metric of a group. */
  featured?: boolean | undefined;
  className?: string | undefined;
}

const deltaToneClasses = {
  positive: 'text-success-600 dark:text-success-300',
  negative: 'text-danger-600 dark:text-danger-300',
  neutral: 'text-ink-muted',
} as const;

/**
 * Metric card. Presentation only — the caller passes the already-computed
 * numbers, so no calculation moves into the design system.
 */
export function StatCard({
  label,
  value,
  delta,
  deltaTone = 'positive',
  icon: Icon,
  hint,
  footer,
  featured = false,
  className,
}: StatCardProps) {
  const DeltaIcon = deltaTone === 'negative' ? ArrowDownRight : ArrowUpRight;

  return (
    <Card
      className={cn(
        'group relative overflow-hidden p-5',
        featured && 'border-accent/40 bg-gradient-to-br from-accent-soft/70 to-card shadow-glow-sm',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">{label}</p>
        {Icon ? (
          <span
            aria-hidden
            className={cn(
              'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-240',
              featured
                ? 'bg-brand-500 text-accent-ink dark:bg-brand-400'
                : 'bg-surface-2 text-ink-subtle group-hover:bg-accent-soft group-hover:text-brand-700 dark:text-accent-bright',
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
          </span>
        ) : null}
      </div>

      <p className="numeric mt-3 text-[28px] font-semibold leading-none tracking-[-0.03em] text-ink sm:text-[30px]">
        {value}
      </p>

      {delta || hint ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          {delta ? (
            <span className={cn('inline-flex items-center gap-0.5 text-[13px] font-semibold', deltaToneClasses[deltaTone])}>
              {deltaTone !== 'neutral' ? <DeltaIcon className="h-3.5 w-3.5" aria-hidden /> : null}
              {delta}
            </span>
          ) : null}
          {hint ? <span className="text-[12.5px] text-ink-subtle">{hint}</span> : null}
        </div>
      ) : null}

      {footer ? <div className="mt-4 border-t border-line pt-3">{footer}</div> : null}
    </Card>
  );
}

export default StatCard;