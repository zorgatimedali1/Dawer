import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * Presentational table primitives. The rendered element order and ARIA roles
 * are unchanged from the hand-written tables they replace.
 */

export function TableWrap({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('dw-scroll -mx-px w-full overflow-x-auto', className)}
      {...props}
    />
  );
}

export const Table = React.forwardRef<
  HTMLTableElement,
  React.TableHTMLAttributes<HTMLTableElement> & { density?: 'comfortable' | 'compact' }
>(function Table({ className, density = 'comfortable', ...props }, ref) {
  return (
    <table
      ref={ref}
      className={cn(
        'w-full min-w-[36rem] border-collapse text-left',
        density === 'compact' ? 'text-[13px]' : 'text-sm',
        className,
      )}
      {...props}
    />
  );
});

export function TableHead({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        'border-b border-line bg-surface-2/70 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-subtle',
        className,
      )}
      {...props}
    />
  );
}

export function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('divide-y divide-line', className)} {...props} />;
}

export const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean }
>(function TableRow({ className, interactive = false, ...props }, ref) {
  return (
    <tr
      ref={ref}
      className={cn(
        'transition-colors duration-150',
        interactive && 'hover:bg-accent-soft/40 focus-within:bg-accent-soft/50 dark:hover:bg-white/[0.03]',
        className,
      )}
      {...props}
    />
  );
});

export function TableHeadCell({
  className,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn('px-4 py-3 font-semibold', className)} {...props} />;
}

export function TableCell({
  className,
  numeric,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={cn('px-4 py-3 align-middle text-ink', numeric && 'numeric text-right', className)}
      {...props}
    />
  );
}

export function TableCaption({ className, ...props }: React.HTMLAttributes<HTMLTableCaptionElement>) {
  return (
    <caption className={cn('mt-3 text-xs text-ink-subtle', className)} {...props} />
  );
}