import * as React from 'react';
import { cn } from '@/lib/cn';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn('relative overflow-hidden rounded-md bg-line/70 dark:bg-white/[0.06]', className)}
      {...props}
    >
      <span className="absolute inset-0 -translate-x-full animate-[shimmer_1.8s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-ink/[0.07] to-transparent motion-reduce:animate-none" />
    </div>
  );
}

export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          className={cn('h-3', index === lines - 1 ? 'w-2/3' : index % 2 === 0 ? 'w-full' : 'w-5/6')}
        />
      ))}
    </div>
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-xl border border-line bg-card p-5', className)}>
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-lg" />
        <div className="flex-1">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-2 h-2.5 w-16" />
        </div>
      </div>
      <Skeleton className="mt-5 h-7 w-20" />
    </div>
  );
}

/** Full-area loader used while a route segment resolves. */
export function LoadingScreen({ label = 'Loading', className }: { label?: string; className?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8', className)}
    >
      <span className="relative flex h-9 w-9 items-center justify-center">
        <span className="absolute inset-0 rounded-full border-2 border-line" />
        <span className="absolute inset-0 animate-spin-slow rounded-full border-2 border-transparent border-t-brand-500 motion-reduce:animate-none" />
      </span>
      <p className="text-[13px] font-medium text-ink-subtle">{label}</p>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn('h-4 w-4 animate-spin motion-reduce:animate-none', className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}