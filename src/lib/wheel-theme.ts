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
};

/** Custom wheel design (colors/motion) is a Business-tier feature. */
export const WHEEL_DESIGN_PLAN_SLUGS = ['scale', 'premium'] as const;

/** The merchant logo at the wheel hub ships from the Pro tier up. */
export const WHEEL_CENTER_LOGO_PLAN_SLUGS = ['growth', 'scale', 'premium'] as const;

export function wheelDesignAllowedForPlan(slug: string | null | undefined): boolean {
  return Boolean(slug && (WHEEL_DESIGN_PLAN_SLUGS as readonly string[]).includes(slug));
}

export function wheelCenterLogoAllowedForPlan(slug: string | null | undefined): boolean {
  return Boolean(slug && (WHEEL_CENTER_LOGO_PLAN_SLUGS as readonly string[]).includes(slug));
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
