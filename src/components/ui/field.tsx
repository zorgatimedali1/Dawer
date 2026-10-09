import * as React from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Select, Textarea } from '@/components/ui/input';

export const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean | undefined }
>(function Label({ className, required, children, ...props }, ref) {
  return (
    <label
      ref={ref}
      className={cn('text-[13px] font-medium leading-none text-ink', className)}
      {...props}
    >
      {children}
      {required ? (
        <span className="ml-0.5 text-danger-500" aria-hidden>
          *
        </span>
      ) : null}
    </label>
  );
});

export interface FieldProps {
  label?: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  className?: string;
  /** Rendered at the right of the label row — e.g. a "Forgot password?" link. */
  action?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Wraps a control with its label, hint and error message. Purely presentational:
 * it renders the same markup/ARIA wiring the pages already used, it does not
 * validate or change submission behaviour.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  className,
  action,
  children,
}: FieldProps) {
  const hasError = Boolean(error);
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      {label || action ? (
        <div className="flex items-baseline justify-between gap-3">
          {label ? (
            <Label htmlFor={htmlFor} required={required}>
              {label}
            </Label>
          ) : (
            <span />
          )}
          {action}
        </div>
      ) : null}
      {children}
      {hasError ? (
        <p
          className="flex items-start gap-1.5 text-[12.5px] font-medium leading-snug text-danger-600 dark:text-danger-300"
          role="alert"
        >
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p className="text-[12.5px] leading-snug text-ink-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

/** Compact variant for dense filter bars and toolbars. */
export function InlineField({
  label,
  htmlFor,
  className,
  children,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Label htmlFor={htmlFor} className="shrink-0 text-xs text-ink-subtle">
        {label}
      </Label>
      {children}
    </div>
  );
}

export { Select, Textarea };