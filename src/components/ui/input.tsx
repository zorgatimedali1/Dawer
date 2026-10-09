import * as React from 'react';
import { cn } from '@/lib/cn';

const controlBase =
  'block w-full max-w-full box-border rounded-md border border-line bg-elevated text-ink placeholder:text-ink-subtle ' +
  'shadow-xs transition-[border-color,box-shadow,background-color] duration-180 ease-swift ' +
  'hover:border-line-strong ' +
  'focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/35 focus:ring-offset-0 ' +
  'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-line ' +
  'aria-[invalid=true]:border-danger-400 aria-[invalid=true]:focus:ring-danger-500/30';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Renders a leading icon; the field keeps normal padding. */
  iconStart?: React.ReactNode;
  iconEnd?: React.ReactNode;
  inputSize?: 'sm' | 'md' | 'lg';
}

const inputSizes = {
  sm: 'h-9 px-3 text-[13px]',
  md: 'h-10 px-3.5 text-sm',
  lg: 'h-11 px-4 text-[15px]',
} as const;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, iconStart, iconEnd, inputSize = 'md', type = 'text', ...props },
  ref,
) {
  if (!iconStart && !iconEnd) {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(controlBase, inputSizes[inputSize], className)}
        {...props}
      />
    );
  }

  return (
    <div className="relative">
      {iconStart ? (
        <span
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle [&>svg]:h-4 [&>svg]:w-4"
          aria-hidden
        >
          {iconStart}
        </span>
      ) : null}
      <input
        ref={ref}
        type={type}
        className={cn(
          controlBase,
          inputSizes[inputSize],
          Boolean(iconStart) && 'pl-9',
          Boolean(iconEnd) && 'pr-9',
          className,
        )}
        {...props}
      />
      {iconEnd ? (
        <span
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-subtle [&>svg]:h-4 [&>svg]:w-4"
          aria-hidden
        >
          {iconEnd}
        </span>
      ) : null}
    </div>
  );
});

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, rows = 4, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(controlBase, 'resize-y px-3.5 py-2.5 text-sm leading-relaxed', className)}
      {...props}
    />
  );
});

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  inputSize?: 'sm' | 'md' | 'lg';
}

/**
 * Native <select> kept for form semantics and mobile ergonomics; only the
 * chrome is restyled and the chevron is drawn on top.
 */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, inputSize = 'md', children, ...props },
  ref,
) {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          controlBase,
          inputSizes[inputSize],
          'cursor-pointer appearance-none pr-9',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <svg
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="m6 8 4 4 4-4" />
      </svg>
    </div>
  );
});

export default Input;