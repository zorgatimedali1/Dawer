import * as React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, ...props }, ref) => {
    return (
      <div
        className={
          "bg-white rounded-lg shadow-sm border border-gray-200 " +
          (className || "")
        }
        ref={ref}
        {...props}
      />
    );
  }
);

Card.displayName = 'Card';

export { Card };
