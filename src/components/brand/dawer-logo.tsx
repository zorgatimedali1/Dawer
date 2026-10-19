import * as React from 'react';
import dawerLogo from '@/assets/dawer-logo.png';

/**
 * The official Dawer wordmark.
 *
 * The asset is a fully transparent PNG: the wheel-badge "D" followed by the
 * green (#7DAB4B) logotype, so it stays legible on the light (#FFFFFF /
 * #F5F9EF) surfaces as-is. `tone="white"` re-renders the whole logo as a pure
 * white silhouette via a `brightness-0 invert` filter — there is no separate
 * white wordmark asset (the "blanc" files in src/assets are wheel icons). It
 * is never cropped or scaled non-proportionally.
 *
 * Size it with a height class and let width follow the intrinsic aspect
 * ratio: `<DawerLogo className="h-9 w-auto" />`
 */
export interface DawerLogoProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'> {
  /** Accessible name. Pass empty string when a nearby heading already names the product. */
  alt?: string;
  /** Wordmark colour variant. Defaults to the standard green. */
  tone?: 'green' | 'white';
}

export const DAWER_LOGO_SRC = dawerLogo;

export function DawerLogo({ alt = 'Dawer', className, tone = 'green', ...props }: DawerLogoProps) {
  const cls = `${className ?? 'h-9 w-auto'}${tone === 'white' ? ' brightness-0 invert' : ''}`;
  return (
    <img
      src={dawerLogo}
      alt={alt}
      width={940}
      height={181}
      decoding="async"
      className={cls}
      {...props}
    />
  );
}

export default DawerLogo;