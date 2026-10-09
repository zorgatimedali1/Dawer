import { DawerLogo } from '@/components/brand/dawer-logo';
import { cn } from '@/lib/cn';

/**
 * Branded route-level loader. Used as the Suspense fallback and wherever a
 * first paint needs the product identity before data arrives.
 */
export function BrandLoader({
  label = 'Loading',
  className,
  fullScreen = true,
}: {
  label?: string;
  className?: string;
  fullScreen?: boolean;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex flex-col items-center justify-center gap-5 bg-surface',
        fullScreen ? 'min-h-screen' : 'min-h-[60vh]',
        className,
      )}
    >
      <div className="relative flex flex-col items-center gap-4">
        <DawerLogo className="h-9 w-auto animate-fade-in" />
        <span className="h-0.5 w-24 overflow-hidden rounded-full bg-line">
          <span className="block h-full w-1/2 rounded-full bg-brand-500 motion-safe:animate-[dw-loader_1.1s_ease-in-out_infinite] dark:bg-brand-400" />
        </span>
      </div>
      <p className="text-[12.5px] font-medium text-ink-subtle">{label}</p>
    </div>
  );
}

export default BrandLoader;