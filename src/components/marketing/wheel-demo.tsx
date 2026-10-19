import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Gift, Sparkles } from 'lucide-react';
import { PrizeWheel, type WheelSegment } from '@/components/wheel/prize-wheel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { wheelMotionDurationMs, type WheelTheme } from '@/lib/wheel-theme';
import { useT } from '@/hooks/use-t';

/**
 * Sample rewards for the hero simulator. Weights are display odds (sum 100);
 * the retry slices keep the game believable ("Réessayez" is a non-prize).
 */
type DemoSegmentKey =
  | 'wheelSegCoffee'
  | 'wheelSegDiscount10'
  | 'wheelSegDessert'
  | 'wheelSegGift'
  | 'wheelSegDiscount20'
  | 'wheelSegRetry';

const DEMO_SEGMENTS: readonly {
  key: DemoSegmentKey;
  weight: number;
  color: string;
}[] = [
  { key: 'wheelSegCoffee', weight: 24, color: '#7DAB4B' },
  { key: 'wheelSegDiscount10', weight: 22, color: '#A5CF68' },
  { key: 'wheelSegDessert', weight: 16, color: '#F59E0B' },
  { key: 'wheelSegGift', weight: 10, color: '#A78BFA' },
  { key: 'wheelSegDiscount20', weight: 14, color: '#60A5FA' },
  { key: 'wheelSegRetry', weight: 14, color: '#CBD5E1' },
];

const RETRY_INDEX = DEMO_SEGMENTS.length - 1;

const DEMO_THEME: WheelTheme = {
  colors: {
    segments: DEMO_SEGMENTS.map((segment) => segment.color),
    rim: '#ffffff',
    pointer: '#0f172a',
  },
  motion: { preset: 'fast' },
  centerLogo: false,
  stepsColor: '#7DAB4B',
};

/**
 * The landing hero centerpiece: the actual `PrizeWheel` renderer used on the
 * public play page, wired to a client-only simulator so visitors can spin the
 * real product experience (QR scan → wheel → coupon) without any backend.
 */
export function WheelDemo() {
  const t = useT();
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [resultIndex, setResultIndex] = useState<number | null>(null);
  const timerRef = useRef<number | null>(null);

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

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const spin = useCallback(() => {
    if (spinning) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    setSpinning(true);
    setResultIndex(null);

    // Weighted draw across the six slices, then the exact landing math of the
    // public play page so the winning slice truly centres under the pointer.
    const total = DEMO_SEGMENTS.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = Math.random() * total;
    let index = 0;
    for (let i = 0; i < DEMO_SEGMENTS.length; i += 1) {
      roll -= DEMO_SEGMENTS[i]?.weight ?? 0;
      if (roll <= 0) {
        index = i;
        break;
      }
    }

    const segmentAngle = 360 / DEMO_SEGMENTS.length;
    const target = index * segmentAngle + segmentAngle / 2;
    const desired = ((-target % 360) + 360) % 360;
    const current = ((rotation % 360) + 360) % 360;
    const delta = ((desired - current) % 360 + 360) % 360;
    setRotation(rotation + 2160 + delta);

    // Reduced-motion users see the rotor land instantly (globals.css) and get
    // the result right away instead of waiting out the travel time.
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const delay = reduced ? 100 : wheelMotionDurationMs(DEMO_THEME) + 250;
    timerRef.current = window.setTimeout(() => {
      setResultIndex(index);
      setSpinning(false);
    }, delay);
  }, [spinning, rotation]);

  const result = resultIndex === null ? null : { index: resultIndex, label: labels[resultIndex] ?? '' };

  return (
    <Card className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-24 h-44 bg-[radial-gradient(70%_100%_at_50%_0%,rgb(125_171_75/0.22),transparent_70%)]"
      />

      <div className="relative flex items-center gap-2.5 border-b border-line px-5 py-3.5">
        <Gift aria-hidden className="h-4 w-4 text-brand-600 dark:text-accent-bright" />
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-subtle">
          {t.landing.wheelDemoHeader}
        </p>
        <Badge tone="brand" size="sm" className="ml-auto">
          {t.landing.wheelDemoBadge}
        </Badge>
      </div>

      <div className="relative px-5 pb-6 pt-6">
        <div className="relative mx-auto w-full max-w-[300px]">
          <PrizeWheel
            segments={segments}
            rotation={rotation}
            spinning={spinning}
            testId="landing-wheel-demo"
            theme={DEMO_THEME}
            wrapperClassName="cf-wheel-float"
          />

          {/* Floating prize hints framing the wheel (decorative). */}
          <span
            aria-hidden
            className="cf-wheel-float pointer-events-none absolute left-0 top-8 hidden rounded-full border border-line bg-elevated px-3 py-1.5 text-[12px] font-semibold text-ink shadow-card md:inline-flex motion-reduce:hidden"
            style={{ animationDelay: '0.8s' }}
          >
            {t.landing.wheelSegDiscount10}
          </span>
          <span
            aria-hidden
            className="cf-wheel-float pointer-events-none absolute bottom-20 right-0 hidden rounded-full border border-line bg-elevated px-3 py-1.5 text-[12px] font-semibold text-ink shadow-card md:inline-flex motion-reduce:hidden"
            style={{ animationDelay: '2.2s' }}
          >
            {t.landing.wheelSegCoffee}
          </span>
        </div>

        <div className="mt-6 flex flex-col items-center gap-3">
          <Button onClick={spin} disabled={spinning} className="w-full max-w-[300px]">
            {spinning ? t.landing.wheelDemoSpinning : result ? t.landing.wheelDemoAgain : t.landing.wheelDemoSpin}
          </Button>

          <div aria-live="polite" className="flex min-h-[34px] items-center justify-center text-center">
            {result ? (
              result.index !== RETRY_INDEX ? (
                <p className="animate-pop-in inline-flex items-center gap-2 rounded-full bg-accent-soft px-4 py-2 text-[13.5px] font-semibold text-brand-800 dark:text-accent-bright motion-reduce:animate-none">
                  <Sparkles aria-hidden className="h-4 w-4" />
                  <span>
                    {t.landing.wheelDemoWin} <strong>{result.label}</strong>
                  </span>
                </p>
              ) : (
                <p className="animate-pop-in text-[13.5px] font-medium text-ink-muted motion-reduce:animate-none">
                  {t.landing.wheelDemoRetry}
                </p>
              )
            ) : null}
          </div>

          <p className="text-center text-[12px] leading-relaxed text-ink-subtle">
            {t.landing.wheelDemoCaption}
          </p>
        </div>
      </div>
    </Card>
  );
}
