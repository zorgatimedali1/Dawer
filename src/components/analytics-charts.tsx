import type { FunnelResult, TimeseriesPoint } from '@/services/analytics.service';
import { cn } from '@/lib/cn';

type Series = {
  key: 'participations' | 'rewardsClaimed' | 'couponsRedeemed';
  label: string;
  /** CSS variable holding the theme-aware hue for this series. */
  variable: string;
};

/**
 * Series order drives the stack: participations sits on the baseline, then
 * rewards, then redeemed, so the bands read bottom-up as a funnel.
 */
const SERIES: Series[] = [
  { key: 'participations', label: 'Played', variable: '--series-1' },
  { key: 'rewardsClaimed', label: 'Rewards', variable: '--series-2' },
  { key: 'couponsRedeemed', label: 'Redeemed', variable: '--series-3' },
];

const WIDTH = 720;
const HEIGHT = 240;
const PAD = { top: 18, right: 16, bottom: 30, left: 42 };

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * magnitude;
}

function linePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' ');
}

/**
 * Stacked area chart over UTC calendar days. Pure SVG so the dashboard does not
 * need a charting dependency. Every colour resolves through a CSS variable so
 * the chart follows the light/dark theme automatically.
 */
export function TimeSeriesChart({ data }: { data: TimeseriesPoint[] }) {
  if (data.length === 0) {
    return <ChartEmpty>No activity in this window.</ChartEmpty>;
  }

  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;

  const peaks = data.map((point) => point.participations + point.rewardsClaimed + point.couponsRedeemed);
  const max = niceMax(Math.max(...peaks, 0));

  const xAt = (index: number): number =>
    PAD.left + (data.length === 1 ? plotWidth / 2 : (index / (data.length - 1)) * plotWidth);

  // Stacks each series cumulatively so the shaded bands sum to the daily total.
  const layers = SERIES.map((series) => {
    let running = 0;
    return data.map((point, index) => {
      running += point[series.key];
      return { x: xAt(index), y: PAD.top + plotHeight - (running / max) * plotHeight };
    });
  });

  const baseline = PAD.top + plotHeight;
  const tickCount = 4;
  // Rounding can collapse ticks when the peak is small (e.g. max=2 -> 0,1,1,1,2),
  // which would otherwise produce duplicate React keys.
  const ticks = [
    ...new Set(Array.from({ length: tickCount + 1 }, (_, index) => Math.round((max / tickCount) * index))),
  ];

  const labelIndexes =
    data.length <= 8
      ? data.map((_, index) => index)
      : [0, Math.floor(data.length / 3), Math.floor((2 * data.length) / 3), data.length - 1];

  return (
    <div className="flex flex-col gap-4">
      <div className="dw-scroll -mx-1 overflow-x-auto px-1">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-60 w-full min-w-[560px]"
          role="img"
          aria-label="Daily campaign activity"
        >
          <defs>
            {SERIES.map((series) => (
              <linearGradient key={series.key} id={`dw-area-${series.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" style={{ stopColor: `rgb(var(${series.variable}) / 0.34)` }} />
                <stop offset="100%" style={{ stopColor: `rgb(var(${series.variable}) / 0.04)` }} />
              </linearGradient>
            ))}
          </defs>

          {ticks.map((tick) => {
            const y = PAD.top + plotHeight - (tick / max) * plotHeight;
            return (
              <g key={tick}>
                <line
                  x1={PAD.left}
                  x2={WIDTH - PAD.right}
                  y1={y}
                  y2={y}
                  stroke="rgb(var(--chart-grid))"
                  strokeWidth="1"
                  strokeDasharray={tick === 0 ? undefined : '3 4'}
                />
                <text
                  x={PAD.left - 10}
                  y={y + 4}
                  textAnchor="end"
                  fontSize="10"
                  className="numeric"
                  style={{ fill: 'rgb(var(--chart-label))' }}
                >
                  {tick}
                </text>
              </g>
            );
          })}

          {layers.map((layer, layerIndex) => {
            const previous = layerIndex === 0 ? null : layers[layerIndex - 1];
            const topEdge = layer
              .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`)
              .join(' ');
            const bottomEdge = (previous ?? data.map((_, index) => ({ x: xAt(index), y: baseline })))
              .slice()
              .reverse()
              .map((point) => `L${point.x} ${point.y}`)
              .join(' ');
            const series = SERIES[layerIndex];

            if (!series) return null;

            return (
              <path
                key={series.key}
                d={`${topEdge} ${bottomEdge} Z`}
                fill={`url(#dw-area-${series.key})`}
                className="animate-fade-in motion-reduce:animate-none"
                style={{ animationDelay: `${layerIndex * 90}ms` }}
              />
            );
          })}

          {layers.map((layer, layerIndex) => {
            const series = SERIES[layerIndex];
            if (!series) return null;

            return (
              <path
                key={series.key}
                d={linePath(layer)}
                fill="none"
                stroke={`rgb(var(${series.variable}))`}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="animate-fade-in motion-reduce:animate-none"
                style={{ animationDelay: `${120 + layerIndex * 90}ms` }}
              />
            );
          })}

          {labelIndexes.map((index) => {
            const point = data[index];
            if (!point) return null;

            return (
              <text
                key={index}
                x={xAt(index)}
                y={HEIGHT - 9}
                textAnchor="middle"
                fontSize="10"
                className="numeric"
                style={{ fill: 'rgb(var(--chart-label))' }}
              >
                {point.day.slice(5)}
              </text>
            );
          })}
        </svg>
      </div>

      <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
        {SERIES.map((series) => (
          <li key={series.key} className="flex items-center gap-2 text-[12.5px] text-ink-muted">
            <span
              aria-hidden
              className="h-2.5 w-2.5 rounded-full ring-1 ring-inset ring-black/5"
              style={{ backgroundColor: `rgb(var(${series.variable}))` }}
            />
            {series.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FunnelChart({ result }: { result: FunnelResult }) {
  const top = Math.max(result.stages[0]?.value ?? 0, 1);

  return (
    <div className="flex flex-col gap-5">
      <ol className="flex flex-col gap-4">
        {result.stages.map((stage, index) => {
          const width = Math.max((stage.value / top) * 100, stage.value > 0 ? 4 : 0);
          return (
            <li key={stage.key}>
              <div className="mb-2 flex items-baseline justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2.5 text-ink">
                  <span className="numeric inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-brand-800 dark:bg-brand-900/50 dark:text-accent-bright">
                    {index + 1}
                  </span>
                  <span className="truncate font-medium">{stage.label}</span>
                </span>
                <span className="numeric shrink-0 font-semibold text-ink">
                  {stage.value.toLocaleString()}
                  {index > 0 ? (
                    <span className="ml-2 text-xs font-normal text-ink-subtle">{stage.rateFromPrevious}%</span>
                  ) : null}
                </span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-line">
                <div
                  className="h-full origin-left animate-bar-grow rounded-full motion-reduce:animate-none"
                  style={{
                    width: `${width}%`,
                    backgroundImage:
                      'linear-gradient(90deg, rgb(var(--series-1)), rgb(var(--accent-bright)))',
                    animationDelay: `${index * 90}ms`,
                  }}
                />
              </div>
            </li>
          );
        })}
      </ol>

      <dl className="grid grid-cols-1 gap-3 border-t border-line pt-5 sm:grid-cols-3">
        <Rate label="Reward rate" value={result.conversion.rewardRate} />
        <Rate label="Redemption rate" value={result.conversion.redemptionRate} />
        <Rate label="Unique customers" value={result.conversion.uniqueCustomers} isCount />
      </dl>
    </div>
  );
}

function Rate({ label, value, isCount = false }: { label: string; value: number; isCount?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2/60 px-3 py-3 text-center">
      <dd className="numeric text-lg font-semibold tracking-[-0.02em] text-ink">
        {isCount ? value.toLocaleString() : `${value}%`}
      </dd>
      <dt className="mt-0.5 text-[11.5px] leading-snug text-ink-subtle">{label}</dt>
    </div>
  );
}

function ChartEmpty({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex h-56 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong bg-surface-2/50 px-6 text-center',
        className,
      )}
    >
      <svg viewBox="0 0 48 32" className="h-8 w-12 text-brand-500/70" aria-hidden fill="none">
        <path
          d="M2 26l10-9 8 6 12-16 14 9"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <line x1="2" y1="30" x2="46" y2="30" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
      </svg>
      <p className="text-[13px] text-ink-subtle">{children}</p>
    </div>
  );
}