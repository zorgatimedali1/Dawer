import { useCallback, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ChartEmpty } from '@/components/charts';
import type { FunnelResult, TimeseriesPoint } from '@/services/analytics.service';
import { cn } from '@/lib/cn';

/** Caller-supplied copy so the charts stay presentational and localizable. */
export interface TimeSeriesLabels {
  played: string;
  rewards: string;
  redeemed: string;
  scans: string;
  empty: string;
  aria: string;
}

export interface FunnelLabels {
  rewardRate: string;
  redemptionRate: string;
  uniqueCustomers: string;
}

type StackedKey = 'participations' | 'rewardsClaimed' | 'couponsRedeemed';

interface StackedSeries {
  key: StackedKey;
  labelKey: 'played' | 'rewards' | 'redeemed';
  variable: string;
}

/**
 * Stack order: participations sits on the baseline, then rewards, then
 * redeemed, so the bands read bottom-up as a funnel. Scans are drawn as a
 * separate dashed overlay line (not stacked) — they are traffic, not wins.
 */
const STACKED_SERIES: StackedSeries[] = [
  { key: 'participations', labelKey: 'played', variable: '--series-1' },
  { key: 'rewardsClaimed', labelKey: 'rewards', variable: '--series-2' },
  { key: 'couponsRedeemed', labelKey: 'redeemed', variable: '--series-3' },
];

const SCANS_VARIABLE = '--series-4';

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
 * Stacked area chart over UTC calendar days with a dashed scans overlay.
 * Pure SVG so the dashboard does not need a charting dependency. Every
 * colour resolves through a CSS variable so the chart follows the light/dark
 * theme automatically. Hover or focus and use arrow keys for a crosshair
 * tooltip with the exact per-series values of a day.
 */
export function TimeSeriesChart({ data, labels }: { data: TimeseriesPoint[]; labels: TimeSeriesLabels }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tooltipId = useId();

  const clearActive = useCallback(() => setActiveIndex(null), []);

  const indexFromClientX = useCallback(
    (clientX: number): number | null => {
      const svg = svgRef.current;
      if (!svg || data.length === 0) return null;
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0) return null;
      const ratio = (clientX - rect.left) / rect.width;
      const viewX = ratio * WIDTH;
      const plotWidth = WIDTH - PAD.left - PAD.right;
      const clamped = Math.min(Math.max(viewX, PAD.left), WIDTH - PAD.right);
      const ratioInPlot = data.length === 1 ? 0.5 : (clamped - PAD.left) / plotWidth;
      return Math.min(data.length - 1, Math.max(0, Math.round(ratioInPlot * (data.length - 1))));
    },
    [data.length],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      setActiveIndex(indexFromClientX(event.clientX));
    },
    [indexFromClientX],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<SVGSVGElement>) => {
      if (data.length === 0) return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        setActiveIndex((current) => {
          const base = current ?? (event.key === 'ArrowRight' ? -1 : data.length);
          const next = event.key === 'ArrowRight' ? base + 1 : base - 1;
          return Math.min(data.length - 1, Math.max(0, next));
        });
      } else if (event.key === 'Escape') {
        setActiveIndex(null);
      }
    },
    [data.length],
  );

  if (data.length === 0) {
    return <ChartEmpty>{labels.empty}</ChartEmpty>;
  }

  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;

  const peaks = data.map((point) => point.participations + point.rewardsClaimed + point.couponsRedeemed);
  const max = niceMax(Math.max(...peaks, ...data.map((point) => point.scans ?? 0), 0));

  const xAt = (index: number): number =>
    PAD.left + (data.length === 1 ? plotWidth / 2 : (index / (data.length - 1)) * plotWidth);

  // Stacks each series cumulatively so the shaded bands sum to the daily total.
  const layers = STACKED_SERIES.map((series) => {
    let running = 0;
    return data.map((point, index) => {
      running += point[series.key];
      return { x: xAt(index), y: PAD.top + plotHeight - (running / max) * plotHeight };
    });
  });

  const scanLayer = data.map((point, index) => ({
    x: xAt(index),
    y: PAD.top + plotHeight - ((point.scans ?? 0) / max) * plotHeight,
  }));

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

  const active = activeIndex !== null ? (data[activeIndex] ?? null) : null;
  const activeX = activeIndex !== null ? xAt(activeIndex) : 0;
  const hasAnyScans = data.some((point) => (point.scans ?? 0) > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative dw-scroll -mx-1 overflow-x-auto px-1">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-60 w-full min-w-[560px] touch-none"
          role="img"
          aria-label={labels.aria}
          aria-describedby={active ? tooltipId : undefined}
          tabIndex={0}
          onPointerMove={handlePointerMove}
          onPointerLeave={clearActive}
          onKeyDown={handleKeyDown}
          onBlur={clearActive}
        >
          <defs>
            {STACKED_SERIES.map((series) => (
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
            const series = STACKED_SERIES[layerIndex];

            if (!series) return null;

            return (
              <path
                key={series.key}
                d={`${topEdge} ${bottomEdge} Z`}
                fill={`url(#dw-area-${series.key})`}
                className="animate-chart-draw motion-reduce:animate-none"
                style={{
                  animationDelay: `${layerIndex * 90}ms`,
                  transformBox: 'fill-box',
                  transformOrigin: 'bottom',
                }}
              />
            );
          })}

          {layers.map((layer, layerIndex) => {
            const series = STACKED_SERIES[layerIndex];
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

          {hasAnyScans ? (
            <path
              key="scans"
              d={linePath(scanLayer)}
              fill="none"
              stroke={`rgb(var(${SCANS_VARIABLE}))`}
              strokeWidth="1.75"
              strokeDasharray="5 4"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="animate-fade-in motion-reduce:animate-none"
              style={{ animationDelay: '400ms' }}
            />
          ) : null}

          {activeIndex !== null ? (
            <g aria-hidden>
              <line
                x1={activeX}
                x2={activeX}
                y1={PAD.top}
                y2={baseline}
                stroke="rgb(var(--chart-label))"
                strokeWidth="1"
                strokeDasharray="2 3"
              />
              {STACKED_SERIES.map((series, layerIndex) => {
                const y = layers[layerIndex]?.[activeIndex]?.y;
                if (y === undefined) return null;
                return (
                  <circle
                    key={series.key}
                    cx={activeX}
                    cy={y}
                    r="3.5"
                    fill="rgb(var(--surface))"
                    stroke={`rgb(var(${series.variable}))`}
                    strokeWidth="2"
                  />
                );
              })}
              {hasAnyScans ? (
                <circle
                  cx={activeX}
                  cy={scanLayer[activeIndex]?.y ?? baseline}
                  r="3"
                  fill="rgb(var(--surface))"
                  stroke={`rgb(var(${SCANS_VARIABLE}))`}
                  strokeWidth="2"
                />
              ) : null}
            </g>
          ) : null}

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

        {active && activeIndex !== null ? (
          <div
            id={tooltipId}
            role="status"
            className="pointer-events-none absolute top-1 z-10 min-w-[9.5rem] -translate-x-1/2 rounded-lg border border-line bg-elevated px-3 py-2 shadow-card"
            style={{
              left: `${Math.min(Math.max((activeX / WIDTH) * 100, 10), 90)}%`,
            }}
          >
            <p className="numeric mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-subtle">
              {active.day}
            </p>
            <dl className="flex flex-col gap-1 text-[12px]">
              <TooltipRow label={labels.played} value={active.participations} variable="--series-1" />
              <TooltipRow label={labels.rewards} value={active.rewardsClaimed} variable="--series-2" />
              <TooltipRow label={labels.redeemed} value={active.couponsRedeemed} variable="--series-3" />
              {hasAnyScans ? (
                <TooltipRow label={labels.scans} value={active.scans ?? 0} variable={SCANS_VARIABLE} dashed />
              ) : null}
            </dl>
          </div>
        ) : null}
      </div>

      <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
        {STACKED_SERIES.map((series) => (
          <li key={series.key} className="flex items-center gap-2 text-[12.5px] text-ink-muted">
            <span
              aria-hidden
              className="h-2.5 w-2.5 rounded-full ring-1 ring-inset ring-black/5"
              style={{ backgroundColor: `rgb(var(${series.variable}))` }}
            />
            {labels[series.labelKey]}
          </li>
        ))}
        {hasAnyScans ? (
          <li className="flex items-center gap-2 text-[12.5px] text-ink-muted">
            <span aria-hidden className="inline-block h-0 w-4 border-t-2 border-dashed" style={{ borderColor: `rgb(var(${SCANS_VARIABLE}))` }} />
            {labels.scans}
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function TooltipRow({
  label,
  value,
  variable,
  dashed = false,
}: {
  label: string;
  value: number;
  variable: string;
  dashed?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="flex items-center gap-1.5 text-ink-muted">
        <span
          aria-hidden
          className={cn('inline-block', dashed ? 'h-0 w-3 border-t-2 border-dashed' : 'h-2 w-2 rounded-full')}
          style={dashed ? { borderColor: `rgb(var(${variable}))` } : { backgroundColor: `rgb(var(${variable}))` }}
        />
        {label}
      </dt>
      <dd className="numeric font-semibold text-ink">{value.toLocaleString()}</dd>
    </div>
  );
}

export function FunnelChart({ result, labels }: { result: FunnelResult; labels: FunnelLabels }) {
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
        <Rate label={labels.rewardRate} value={result.conversion.rewardRate} />
        <Rate label={labels.redemptionRate} value={result.conversion.redemptionRate} />
        <Rate label={labels.uniqueCustomers} value={result.conversion.uniqueCustomers} isCount />
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
