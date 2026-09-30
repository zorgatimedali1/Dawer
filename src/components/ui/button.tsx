import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';

export const buttonVariants = {
  default: 'bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-4 rounded-md',
  destructive: 'bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-md',
  outline: 'border border-gray-300 bg-white hover:bg-gray-50 py-2 px-4 rounded-md',
  secondary: 'bg-gray-600 hover:bg-gray-700 text-white font-medium py-2 px-4 rounded-md',
  ghost: 'hover:bg-gray-100 text-gray-700 py-2 px-4 rounded-md',
  link: 'text-indigo-600 hover:text-indigo-500 underline',
} as const;

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof buttonVariants;
  size?: 'default' | 'sm' | 'lg';
  asChild?: boolean;
}

export function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : 'button';

  const baseClasses = 'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-width-2';

  const sizeClasses = {
    sm: 'h-9 px-3',
    default: 'h-10 px-4 py-2',
    lg: 'h-11 px-8',
  }[size];

  return (
    <Comp
      className={`${baseClasses} ${buttonVariants[variant]} ${sizeClasses} ${className}`}
      {...props}
    />
  );
}
