import * as React from 'react';
import { cn } from '@/lib/cn';

export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0] ?? '').slice(0, 2).toUpperCase();
  return `${parts[0]?.[0] ?? ''}${parts[parts.length - 1]?.[0] ?? ''}`.toUpperCase();
}

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  name?: string | null;
  src?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}

const avatarSizes = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-[11px]',
  md: 'h-9 w-9 text-xs',
  lg: 'h-11 w-11 text-sm',
  xl: 'h-16 w-16 text-lg',
} as const;

export function Avatar({ name, src, size = 'md', className, ...props }: AvatarProps) {
  const [failed, setFailed] = React.useState(false);
  const showImage = Boolean(src) && !failed;

  return (
    <span
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full',
        'bg-accent-soft font-semibold text-brand-800 ring-1 ring-inset ring-line',
        'dark:bg-brand-900/50 dark:text-accent-bright dark:ring-white/10',
        avatarSizes[size],
        className,
      )}
      {...props}
    >
      {showImage ? (
        <img
          src={src as string}
          alt={name ?? ''}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden>{initialsOf(name)}</span>
      )}
    </span>
  );
}

/** Gradient-free tinted square used to break up long lists of records. */
export function EntityTile({
  children,
  tone = 'brand',
  className,
}: {
  children: React.ReactNode;
  tone?: 'brand' | 'neutral';
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[13px] font-semibold',
        tone === 'brand'
          ? 'bg-accent-soft text-brand-800 dark:bg-brand-900/50 dark:text-accent-bright'
          : 'bg-surface-2 text-ink-muted',
        className,
      )}
    >
      {children}
    </span>
  );
}