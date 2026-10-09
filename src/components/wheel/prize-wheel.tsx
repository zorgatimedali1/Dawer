import { cn } from '@/lib/cn';
import {
  DEFAULT_WHEEL_THEME,
  WHEEL_MOTION_EASING,
  wheelGradient,
  wheelMotionDurationMs,
  type WheelTheme,
} from '@/lib/wheel-theme';

export interface WheelSegment {
  id: string;
  label: string;
  percent: number;
  color: string;
  angle: number;
}

interface PrizeWheelProps {
  segments: WheelSegment[];
  rotation: number;
  spinning: boolean;
  /** Test hook: `preview-wheel` in the dashboard, `prize-wheel` in the public page. */
  testId: string;
  theme?: WheelTheme;
  /** Source of the center-hub image; rendered only when `theme.centerLogo` is on. */
  centerLogoSrc?: string | null;
  centerLogoAlt?: string;
  /** Sizing wrapper around the rotor (width, float animation). */
  wrapperClassName?: string;
  shadowClassName?: string;
}

/**
 * The single wheel renderer shared by the dashboard preview and the public
 * play page: same segments math, same conic gradient, same pointer — only the
 * theme (colors, motion speed, center logo) and sizing differ per surface.
 */
export function PrizeWheel({
  segments,
  rotation,
  spinning,
  testId,
  theme,
  centerLogoSrc,
  centerLogoAlt,
  wrapperClassName,
  shadowClassName,
}: PrizeWheelProps) {
  const activeTheme = theme ?? DEFAULT_WHEEL_THEME;
  const durationMs = wheelMotionDurationMs(activeTheme);
  const showCenterLogo = Boolean(activeTheme.centerLogo && centerLogoSrc);

  return (
    <div
      className={cn('relative aspect-square', wrapperClassName)}
      style={{ containerType: 'inline-size' }}
    >
      <div
        data-testid={testId}
        className={cn(
          'cf-wheel-rotor relative h-full w-full overflow-hidden rounded-full border-[10px] ring-1 ring-line',
          shadowClassName ?? 'shadow-[0_18px_44px_rgba(77,120,45,0.30)]',
        )}
        style={{
          background: wheelGradient(segments),
          transform: `rotate(${rotation}deg)`,
          borderColor: activeTheme.colors.rim,
          transition: `transform ${durationMs}ms ${WHEEL_MOTION_EASING}`,
        }}
      >
        {segments.map((segment) => {
          let labelRotation = segment.angle - 90;
          if (labelRotation >= 90) labelRotation -= 180;
          if (labelRotation < -90) labelRotation += 180;
          const labelWidth = Math.max(
            14,
            Math.min(29, 60 * Math.sin(Math.PI / Math.max(segments.length, 1)) - 2),
          );

          return (
            <span
              key={segment.id}
              data-wheel-segment
              title={segment.label}
              className="pointer-events-none absolute left-1/2 top-1/2 z-10 flex flex-col items-center justify-center break-words text-center font-extrabold leading-[1.05] text-white drop-shadow-[0_1px_2px_rgba(15,23,42,0.95)]"
              style={{
                width: `${labelWidth}%`,
                fontSize: `${segments.length > 10 ? 2.6 : segments.length > 7 ? 3 : 3.4}cqw`,
                transform: `translate(-50%, -50%) rotate(${segment.angle}deg) translateY(-30cqw) rotate(${labelRotation - segment.angle}deg)`,
              }}
            >
              <span>{segment.label}</span>
              <span className="text-[0.78em] font-bold opacity-95">{segment.percent}%</span>
            </span>
          );
        })}
      </div>

      {showCenterLogo ? (
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 h-[24cqw] w-[24cqw] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full bg-white/95 shadow-[0_4px_14px_rgba(15,23,42,0.30)] ring-2 ring-white/80">
          <img
            src={centerLogoSrc ?? undefined}
            alt={centerLogoAlt ?? ''}
            className="h-full w-full object-contain"
            onError={(event) => {
              event.currentTarget.style.display = 'none';
            }}
          />
        </div>
      ) : null}

      <div
        className={cn(
          'pointer-events-none absolute left-1/2 top-0 z-20 -translate-x-1/2',
          spinning && 'cf-wheel-pointer-spinning',
        )}
      >
        <div
          className="h-0 w-0 border-x-[3.5cqw] border-x-transparent border-t-[6.5cqw]"
          style={{ borderTopColor: activeTheme.colors.pointer }}
        />
      </div>
    </div>
  );
}
