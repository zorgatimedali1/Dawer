import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  tone?: 'neutral' | 'success' | 'danger' | 'warning';
}

interface ToastContextValue {
  toast: (item: Omit<ToastItem, 'id'>) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

const toneStyles = {
  neutral: 'border-line-strong',
  success: 'border-success-600/40',
  danger: 'border-danger-600/40',
  warning: 'border-warning-600/40',
} as const;

const toneBar = {
  neutral: 'bg-ink-subtle',
  success: 'bg-success-500',
  danger: 'bg-danger-500',
  warning: 'bg-warning-500',
} as const;

/**
 * Minimal toast surface. Opt-in: nothing renders it until `toast()` is called,
 * so existing pages keep their current feedback behaviour.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const toast = React.useCallback((item: Omit<ToastItem, 'id'>) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setItems((prev) => [...prev.slice(-3), { ...item, id }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((entry) => entry.id !== id));
    }, 4600);
  }, []);

  const value = React.useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {mounted
        ? createPortal(
            <div
              role="region"
              aria-label="Notifications"
              className="pointer-events-none fixed inset-x-0 bottom-0 z-[120] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end"
            >
              {items.map((item) => (
                <div
                  key={item.id}
                  role="status"
                  className={cn(
                    'pointer-events-auto flex w-full max-w-sm animate-slide-up items-start gap-3 overflow-hidden rounded-lg border bg-elevated px-4 py-3 shadow-pop',
                    'motion-reduce:animate-none',
                    toneStyles[item.tone ?? 'neutral'],
                  )}
                >
                  <span
                    aria-hidden
                    className={cn('absolute left-0 top-0 h-full w-1', toneBar[item.tone ?? 'neutral'])}
                  />
                  <div className="min-w-0 pl-1">
                    <p className="text-[13.5px] font-semibold text-ink">{item.title}</p>
                    {item.description ? (
                      <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-muted">{item.description}</p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  return React.useContext(ToastContext) ?? { toast: () => undefined };
}

/** Single-line progress bar. Decorative; pair with a labelled value. */
export function Progress({
  value,
  className,
  tone = 'brand',
  label,
}: {
  value: number;
  className?: string;
  tone?: 'brand' | 'ink';
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-line', className)}
    >
      <div
        className={cn(
          'h-full origin-left animate-bar-grow rounded-full motion-reduce:animate-none',
          tone === 'brand' ? 'bg-brand-500 dark:bg-brand-400' : 'bg-ink-subtle',
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}