import * as React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  /** `md` centres a dialog; `lg` centres; `drawer` slides in from the right. */
  size?: 'sm' | 'md' | 'lg';
  variant?: 'dialog' | 'drawer';
  /** Set false for destructive confirmations where a stray backdrop click is costly. */
  closeOnBackdrop?: boolean;
  className?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}

/**
 * Replaces the hand-rolled `fixed inset-0` overlays. It adds focus handling,
 * Escape-to-close, scroll locking and enter/exit animation; the open state and
 * the caller's onClose logic are untouched.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  variant = 'dialog',
  closeOnBackdrop = true,
  className,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
}: ModalProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = React.useState(false);
  const [closing, setClosing] = React.useState(false);
  const generatedTitleId = React.useId();
  const generatedDescId = React.useId();

  React.useEffect(() => setMounted(true), []);

  // Exit animation: only after a real close. A modal that mounts closed must
  // never enter `closing` — that would render its content for one frame.
  const wasOpen = React.useRef(false);
  React.useEffect(() => {
    if (open) {
      wasOpen.current = true;
      setClosing(false);
      return undefined;
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      setClosing(true);
      const timer = window.setTimeout(() => setClosing(false), 0);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [open]);

  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTarget = panelRef.current?.querySelector<HTMLElement>(
      '[data-autofocus], button:not([disabled]), [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusTarget?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!mounted || (!open && !closing)) return null;

  const titleId = generatedTitleId;
  const descId = generatedDescId;
  const isDrawer = variant === 'drawer';
  const width = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl' }[size];

  return (
    createPortal(
      <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4">
        <div
          className={cn(
            'absolute inset-0 bg-[#0D120B]/45 backdrop-blur-[3px] transition-opacity duration-240 ease-swift',
            open && !closing ? 'opacity-100' : 'opacity-0',
          )}
          onClick={closeOnBackdrop ? onClose : undefined}
          aria-hidden
        />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={ariaLabelledBy ?? (title ? titleId : undefined)}
          aria-describedby={ariaDescribedBy ?? (description ? descId : undefined)}
          className={cn(
            'relative flex w-full flex-col overflow-hidden border border-line bg-elevated shadow-pop',
            'transition-[transform,opacity] duration-240 ease-swift motion-reduce:transition-none',
            isDrawer
              ? cn(
                  'h-full max-h-full sm:h-auto sm:max-h-[90vh] sm:rounded-2xl',
                  open && !closing ? 'animate-slide-in-right' : 'translate-x-full opacity-0',
                )
              : cn(
                  'max-h-[92vh] rounded-t-2xl sm:rounded-2xl',
                  width,
                  open && !closing ? 'animate-pop-in sm:animate-scale-in' : 'translate-y-4 scale-[0.98] opacity-0',
                ),
            className,
          )}
        >
          {title || description ? (
            <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
              <div className="min-w-0 space-y-1">
                {title ? (
                  <h2 id={titleId} className="text-base font-semibold tracking-[-0.01em] text-ink">
                    {title}
                  </h2>
                ) : null}
                {description ? (
                  <p id={descId} className="text-[13px] leading-relaxed text-ink-muted">
                    {description}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-subtle transition-colors duration-150 hover:bg-ink/[0.06] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </header>
          ) : null}

          <div className="dw-scroll min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>

          {footer ? (
            <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-2/60 px-5 py-4 sm:px-6">
              {footer}
            </footer>
          ) : null}
        </div>
      </div>,
      document.body
    )
  );
}

export default Modal;