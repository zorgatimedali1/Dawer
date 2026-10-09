import * as React from 'react';
import dawerLogo from '@/assets/dawer-logo.png';

/**
 * The official Dawer wordmark.
 *
 * The asset is a flat #7DAB4B logotype on a fully transparent background, so
 * it stays legible on both the light (#FFFFFF / #F5F9EF) and dark (#0D120B)
 * surfaces without any filter, plate or recolouring. It is never cropped,
 * scaled non-proportionally, or reinterpreted.
 *
 * Size it with a height class and let width follow the intrinsic 953x232
 * aspect ratio: `<DawerLogo className="h-9 w-auto" />`
 */
export interface DawerLogoProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'> {
  /** Accessible name. Pass empty string when a nearby heading already names the product. */
  alt?: string;
}

export const DAWER_LOGO_SRC = dawerLogo;

export function DawerLogo({ alt = 'Dawer', className, ...props }: DawerLogoProps) {
  return (
    <img
      src={dawerLogo}
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