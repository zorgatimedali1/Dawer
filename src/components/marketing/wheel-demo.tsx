import { useEffect, useMemo, useRef, useState } from 'react';
import { PrizeWheel, type WheelSegment } from '@/components/wheel/prize-wheel';
import { type WheelTheme } from '@/lib/wheel-theme';
import { useT } from '@/hooks/use-t';

/**
 * Sample rewards for the hero simulator. Weights are display odds (sum 100);
 * the retry slices keep the game believable ("Réessayez" is a non-prize).
 * Slices alternate between the Dawer brand green and white.
 */
type DemoSegmentKey =
  | 'wheelSegCoffee'
  | 'wheelSegDiscount10'
  | 'wheelSegDessert'
  | 'wheelSegGift'
  | 'wheelSegDiscount20'
  | 'wheelSegRetry';

const BRAND_GREEN = '#7DAB4B';

const DEMO_SEGMENTS: readonly {
  key: DemoSegmentKey;
  weight: number;
  color: string;
}[] = [
  { key: 'wheelSegCoffee', weight: 24, color: BRAND_GREEN },
  { key: 'wheelSegDiscount10', weight: 22, color: '#ffffff' },
  { key: 'wheelSegDessert', weight: 16, color: BRAND_GREEN },
  { key: 'wheelSegGift', weight: 10, color: '#ffffff' },
  { key: 'wheelSegDiscount20', weight: 14, color: BRAND_GREEN },
  { key: 'wheelSegRetry', weight: 14, color: '#ffffff' },
];

const DEMO_THEME: WheelTheme = {
  colors: {
    segments: DEMO_SEGMENTS.map((segment) => segment.color),
    rim: '#ffffff',
    pointer: '#0f172a',
  },
  motion: { preset: 'fast' },
  centerLogo: false,
  stepsColor: BRAND_GREEN,
  labelInk: 'auto',
};

/**
 * Idle pace of the hero wheel: 1 "vitesse" = 60°/s, and 0.5 vitesse keeps the
 * showcase turning noticeably slower (one full revolution every 12s).
 */
const DEMO_SPEED = 0.5;
const DEMO_BASE_DPS = 60;

/**
 * The landing hero centerpiece: the actual `PrizeWheel` renderer used on the
 * public play page, drifting on its own at a slow steady pace so visitors see
 * the product experience (QR scan → wheel → coupon) without touching it.
 */
export function WheelDemo() {
  const t = useT();
  const [rotation, setRotation] = useState(0);
  const rafRef = useRef<number | null>(null);

  const labels = useMemo(
    () => DEMO_SEGMENTS.map((segment) => t.landing[segment.key]),
    [t],
  );

  const segments = useMemo<WheelSegment[]>(
    () =>
      DEMO_SEGMENTS.map((segment, index) => {
        const total = DEMO_SEGMENTS.reduce((sum, entry) => sum + entry.weight, 0);
        return {
          id: `demo-${index}`,
          label: labels[index] ?? '',
          percent: Math.round((segment.weight * 100) / total),
          color: segment.color,
          angle: ((index + 0.5) * 360) / DEMO_SEGMENTS.length,
        };
      }),
    [labels],
  );

  // Continuous slow roll driven by a delta-time RAF loop (frame-rate
  // independent). The rotor transition is severed so the transform tracks the
  // requested angle every frame instead of easing after it.
  useEffect(() => {
    if (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }
    let previous: number | null = null;
    let cancelled = false;
    const tick = (now: number) => {
      if (cancelled) return;
      if (previous !== null) {
        const seconds = (now - previous) / 1000;
        if (seconds > 0) {
          setRotation((current) => current + DEMO_BASE_DPS * DEMO_SPEED * seconds);
        }
      }
      previous = now;
      rafRef.current = window.requestAnimationFrame(tick);
    };
    rafRef.current = window.requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-full max-w-[400px]">
        <PrizeWheel
          segments={segments}
          rotation={rotation}
          spinning={false}
          transitionMs={0}
          testId="landing-wheel-demo"
          theme={DEMO_THEME}
          wrapperClassName="cf-wheel-float"
        />

        {/* Floating prize hints framing the wheel (decorative). */}
        <span
          aria-hidden
          className="cf-wheel-float pointer-events-none absolute -left-3 top-10 hidden rounded-full border border-line bg-elevated px-3 py-1.5 text-[12px] font-semibold text-ink shadow-card md:inline-flex motion-reduce:hidden"
          style={{ animationDelay: '0.8s' }}
        >
          {t.landing.wheelSegDiscount10}
        </span>
        <span
          aria-hidden
          className="cf-wheel-float pointer-events-none absolute -right-3 top-28 hidden rounded-full border border-line bg-elevated px-3 py-1.5 text-[12px] font-semibold text-ink shadow-card md:inline-flex motion-reduce:hidden"
          style={{ animationDelay: '2.2s' }}
        >
          {t.landing.wheelSegCoffee}
        </span>
      </div>
    </div>
  );
}
