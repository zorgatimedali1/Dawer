import * as React from 'react';
import { cn } from '@/lib/cn';

export interface PageHeaderProps {
  /** Small uppercase label above the title — the route or section context. */
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Filter / search strip rendered under the title row. */
  toolbar?: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}

/**
 * Shared page header. Establishes one type scale across the whole product:
 * eyebrow → title → description, with actions right-aligned on desktop and
 * stacked on mobile.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  toolbar,
  meta,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-4', className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0 space-y-1.5">
          {eyebrow ? (
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-brand-600 dark:text-accent-bright">
              {eyebrow}
            </p>
          ) : null}
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.025em] text-ink sm:text-[26px]">
              {title}
            </h1>
            {meta}
          </div>
          {description ? (
            <p className="max-w-2xl text-[13.5px] leading-relaxed text-ink-muted">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{actions}</div>
        ) : null}
      </div>
      {toolbar ? <div className="flex flex-wrap items-center gap-2">{toolbar}</div> : null}
    </header>
  );
}

export interface SectionProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export function Section({ title, description, actions, className, children }: SectionProps) {
  return (
    <section className={cn('flex flex-col gap-3.5', className)}>
      {title || actions ? (
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            {title ? (
              <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
            ) : null}
            {description ? <p className="mt-0.5 text-[13px] text-ink-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export default PageHeader;