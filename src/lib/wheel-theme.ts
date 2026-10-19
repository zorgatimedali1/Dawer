/**
 * Frontend mirror of `Backend/src/lib/validation.ts` wheel-theme helpers.
 * The server is authoritative (it gates and resolves the effective theme);
 * these constants keep the preview, the public page and the admin editor in
 * sync with what it will accept.
 */

export const WHEEL_MOTION_PRESETS = ['fast', 'standard', 'slow'] as const;

export type WheelMotionPreset = (typeof WHEEL_MOTION_PRESETS)[number];

/** Spin duration per preset; matches the rotor transition below. */
export const WHEEL_MOTION_DURATION_MS: Record<WheelMotionPreset, number> = {
  fast: 2000,
  standard: 3800,
  slow: 6000,
};

export const WHEEL_MOTION_EASING = 'cubic-bezier(0.12, 0.82, 0.16, 1)';

export interface WheelTheme {
  colors: {
    segments: string[];
    rim: string;
    pointer: string;
  };
  motion: {
    preset: WheelMotionPreset;
  };
  centerLogo: boolean;
  /** Brand colour for the gate step badges + CTA buttons on the public page. */
  stepsColor: string;
  /**
   * Slice label ink: 'light' (default) renders the historic white labels on
   * every slice; 'auto' picks black or white per slice by fill luminance so
   * light slices like white stay readable.
   */
  labelInk?: 'light' | 'auto';
}

/** The palette and timing every wheel falls back to. */
export const DEFAULT_WHEEL_THEME: WheelTheme = {
  colors: {
    segments: ['#f59e0b', '#a78bfa', '#34d399', '#60a5fa', '#fb7185', '#cbd5e1', '#facc15', '#2dd4bf'],
    rim: '#ffffff',
    pointer: '#0f172a',
  },
  motion: { preset: 'standard' },
  centerLogo: false,
  stepsColor: '#7DAB4B',
};

/** Custom wheel design (colors/motion) ships from the Pro tier up. */
export const WHEEL_DESIGN_PLAN_SLUGS = ['growth', 'scale', 'premium'] as const;

/** Arabic twin of the "Prochaine fois" no-win slice, shown under the label. */
export const NO_WIN_ARABIC_NOTE = 'المرة القادمة';

/** The merchant logo at the wheel hub ships from the Pro tier up. */
export const WHEEL_CENTER_LOGO_PLAN_SLUGS = ['growth', 'scale', 'premium'] as const;

/** The gate step colour ships from the Pro tier up. */
export const WHEEL_STEPS_COLOR_PLAN_SLUGS = ['growth', 'scale', 'premium'] as const;

export function wheelDesignAllowedForPlan(slug: string | null | undefined): boolean {
  return Boolean(slug && (WHEEL_DESIGN_PLAN_SLUGS as readonly string[]).includes(slug));
}

export function wheelCenterLogoAllowedForPlan(slug: string | null | undefined): boolean {
  return Boolean(slug && (WHEEL_CENTER_LOGO_PLAN_SLUGS as readonly string[]).includes(slug));
}

export function wheelStepsColorAllowedForPlan(slug: string | null | undefined): boolean {
  return Boolean(slug && (WHEEL_STEPS_COLOR_PLAN_SLUGS as readonly string[]).includes(slug));
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** The ink to place on a filled accent surface so the label stays legible. */
export function gateAccentInk(hex: string | undefined | null): string {
  const value = hex && HEX_COLOR.test(hex) ? hex : DEFAULT_WHEEL_THEME.stepsColor;
  const channel = (offset: number) => {
    const c = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  // Contrast crossover for the two ink tones: brighter accents keep dark ink,
  // darker accents flip to the light tone.
  return luminance > 0.2 ? '#0D120B' : '#F7FBF2';
}

export function labelInkForSlice(hex: string | undefined | null): string {
  const value = hex && HEX_COLOR.test(hex) ? hex : '#ffffff';
  const channel = (offset: number) => {
    const c = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.6 ? '#0F172A' : '#FFFFFF';
}

export function wheelMotionDurationMs(theme: WheelTheme | undefined | null): number {
  return WHEEL_MOTION_DURATION_MS[theme?.motion.preset ?? 'standard'] ?? WHEEL_MOTION_DURATION_MS.standard;
}

export function segmentColorAt(index: number, colors: readonly string[] | undefined): string {
  const palette = colors?.length ? colors : DEFAULT_WHEEL_THEME.colors.segments;
  return palette[index % palette.length] ?? '#cbd5e1';
}

export function wheelGradient(segments: readonly { color: string }[]): string {
  if (!segments.length) return 'conic-gradient(#e2e8f0 0deg 360deg)';
  const stepSize = 360 / segments.length;
  return `conic-gradient(${segments
    .map((segment, index) => `${segment.color} ${index * stepSize}deg ${(index + 1) * stepSize}deg`)
    .join(', ')})`;
}
