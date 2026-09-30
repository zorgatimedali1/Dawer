import * as React from 'react';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline';
  className?: string;
}

const badgeVariants = {
  default: 'bg-indigo-600 text-white px-2 py-1 text-xs rounded',
  secondary: 'bg-gray-600 text-white px-2 py-1 text-xs rounded',
  destructive: 'bg-red-600 text-white px-2 py-1 text-xs rounded',
  outline: 'border border-gray-300 text-gray-600 px-2 py-1 text-xs rounded',
} as const;

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = 'default', ...props }, ref) => {
    return (
      <span
        className={
          "inline-flex items-center rounded-text border " +
          badgeVariants[variant] +
          " " +
          (className || "")
        }
        ref={ref}
        {...props}
      />
    );
  }
);

Badge.displayName = 'Badge';

export { Badge };
