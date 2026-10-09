import * as React from 'react';
import { cn } from '@/lib/cn';

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function Card({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          'rounded-xl border border-line bg-card text-ink shadow-soft',
          'transition-[border-color,box-shadow,background-color] duration-240 ease-swift',
          className,
        )}
        {...props}
      />
    );
  },
);

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardHeader({ className, ...props }, ref) {
    return <div ref={ref} className={cn('flex flex-col gap-1.5 p-5 sm:p-6', className)} {...props} />;
  },
);

export const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(function CardTitle({ className, ...props }, ref) {
  return (
    <h3
      ref={ref}
      className={cn('text-[15px] font-semibold leading-tight tracking-[-0.01em] text-ink', className)}
      {...props}
    />
  );
});

export const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(function CardDescription({ className, ...props }, ref) {
  return <p ref={ref} className={cn('text-sm leading-relaxed text-ink-muted', className)} {...props} />;
});

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardContent({ className, ...props }, ref) {
    return <div ref={ref} className={cn('p-5 pt-0 sm:p-6 sm:pt-0', className)} {...props} />;
  },
);

export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardFooter({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          'flex items-center gap-3 border-t border-line px-5 py-4 sm:px-6',
          className,
        )}
        {...props}
      />
    );
  },
);

export interface InteractiveCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Lifts and tints the card on hover — use only when the whole card is clickable. */
  interactive?: boolean;
}

export const InteractiveCard = React.forwardRef<HTMLDivElement, InteractiveCardProps>(
  function InteractiveCard({ className, interactive = true, ...props }, ref) {
    return (
      <Card
        ref={ref}
        className={cn(
          interactive &&
            'cursor-pointer hover:-translate-y-0.5 hover:border-accent/45 hover:shadow-card focus-within:border-accent/50 motion-reduce:hover:translate-y-0',
          className,
        )}
        {...props}
      />
    );
  },
);