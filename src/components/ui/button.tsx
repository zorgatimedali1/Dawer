import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'subtle'
  | 'danger'
  | 'link'
  /* Legacy aliases kept so older call sites keep resolving to the new palette. */
  | 'default'
  | 'destructive';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';

export const buttonVariants: Record<ButtonVariant, string> = {
  /* Filled brand green. Ink-on-green keeps the label legible against the
     mid-tone brand colour instead of washing out to white. */
  primary:
    'bg-brand-500 text-accent-ink hover:bg-brand-600 active:bg-brand-700 shadow-xs hover:shadow-glow-sm dark:bg-brand-400 dark:hover:bg-brand-300',
  secondary:
    'bg-ink text-surface hover:bg-ink/90 active:bg-ink shadow-xs dark:bg-ink-inverse dark:text-surface-2 dark:hover:bg-ink-inverse/90',
  outline:
    'border border-line-strong bg-transparent text-ink hover:bg-accent-soft hover:border-accent active:bg-accent-soft',
  subtle: 'bg-accent-soft text-brand-800 hover:bg-brand-200/70 dark:bg-accent-soft dark:text-accent-bright dark:hover:bg-brand-900/60',
  ghost:
    'bg-transparent text-ink-muted hover:bg-ink/[0.06] hover:text-ink active:bg-ink/[0.09] dark:hover:bg-white/[0.07] dark:hover:text-ink',
  danger:
    'bg-danger-600 text-white hover:bg-danger-700 active:bg-danger-800 shadow-xs dark:bg-danger-500 dark:hover:bg-danger-400',
  link: 'bg-transparent text-brand-700 underline-offset-4 hover:underline hover:text-brand-800 dark:text-accent-bright dark:hover:text-brand-300',
  default: 'bg-brand-500 text-accent-ink hover:bg-brand-600 active:bg-brand-700 shadow-xs hover:shadow-glow-sm dark:bg-brand-400 dark:hover:bg-brand-300',
  destructive:
    'bg-danger-600 text-white hover:bg-danger-700 active:bg-danger-800 shadow-xs dark:bg-danger-500 dark:hover:bg-danger-400',
};

export const buttonSizes: Record<ButtonSize, string> = {
  xs: 'h-7 gap-1.5 rounded-sm px-2.5 text-xs',
  sm: 'h-[34px] gap-1.5 rounded-md px-3 text-[13px]',
  md: 'h-10 gap-2 rounded-md px-4 text-sm',
  lg: 'h-11 gap-2 rounded-lg px-5 text-[15px]',
  icon: 'h-10 w-10 rounded-md',
  'icon-sm': 'h-8 w-8 rounded-md',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  asChild?: boolean;
  /** Shows a spinner and blocks interaction. */
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = 'primary',
    size = 'md',
    asChild = false,
    loading = false,
    disabled,
    children,
    type,
    ...props
  },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  const isNativeButton = !asChild;
  const iconOnly = size === 'icon' || size === 'icon-sm';

  return (
    <Comp
      ref={ref}
      className={cn(
        'relative inline-flex select-none items-center justify-center whitespace-nowrap font-medium',
        'transition-[background-color,border-color,color,box-shadow,transform] duration-180 ease-swift',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
        'active:scale-[0.985] motion-reduce:active:scale-100',
        'disabled:pointer-events-none disabled:opacity-55',
        iconOnly && 'px-0',
        buttonSizes[size],
        buttonVariants[variant],
        className,
      )}
      {...(isNativeButton ? { type: type ?? 'button', disabled: disabled || loading } : { disabled })}
      aria-busy={loading || undefined}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
          ) : null}
          <span className={cn('inline-flex items-center gap-2', loading && 'opacity-0')}>{children}</span>
        </>
      )}
    </Comp>
  );
});

export default Button;