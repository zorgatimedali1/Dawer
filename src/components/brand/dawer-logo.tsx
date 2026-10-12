import * as React from 'react';
import dawerLogo from '@/assets/dawer-logo.png';
import dawerLogoWhite from '@/assets/logo dawer blanc.png';

/**
 * The official Dawer wordmark.
 *
 * The default asset is a flat #7DAB4B logotype on a fully transparent
 * background, so it stays legible on the light (#FFFFFF / #F5F9EF) surfaces
 * without any filter, plate or recolouring. `tone="white"` swaps in the
 * identical white wordmark for dark or saturated backgrounds (never recoloured
 * with a CSS filter). It is never cropped or scaled non-proportionally.
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
export const DAWER_LOGO_WHITE_SRC = dawerLogoWhite;

export function DawerLogo({ alt = 'Dawer', className, tone = 'green', ...props }: DawerLogoProps) {
  const src = tone === 'white' ? dawerLogoWhite : dawerLogo;
  return (
    <img
      src={src}
      alt={alt}
      width={953}
      height={232}
      decoding="async"
      className={className ?? 'h-9 w-auto'}
      {...props}
    />
  );
}

export default DawerLogo;