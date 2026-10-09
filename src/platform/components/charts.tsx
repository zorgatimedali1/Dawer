const WIDTH = 720;
const HEIGHT = 240;
const PAD = { top: 18, right: 16, bottom: 30, left: 52 };

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * magnitude;
}

function ChartEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-56 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong bg-surface-2/50 px-6 text-center">
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

export interface BarDatum {
  label: string;
  value: number;
  /** Optional secondary label shown in the tooltip title. */
  title?: string;
}

/**
 * Vertical bar chart in pure SVG (no charting dependency). Theme-aware through
 * the same CSS variables the merchant dashboard uses.
 */
export function BarChart({
  data,
  ariaLabel,
  formatValue = (value) => value.toLocaleString(),
}: {
  data: BarDatum[];
  ariaLabel: string;
  formatValue?: (value: number) => string;
}) {
  if (data.length === 0 || data.every((point) => point.value <= 0)) {
    return <ChartEmpty>No data in this window.</ChartEmpty>;
  }

  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const max = niceMax(Math.max(...data.map((point) => point.value), 0));
  const slot = plotWidth / data.length;
  const barWidth = Math.max(3, Math.min(28, slot * 0.62));
  const baseline = PAD.top + plotHeight;

  const ticks = [...new Set(Array.from({ length: 5 }, (_, index) => Math.round((max / 4) * index)))];

  const labelIndexes =
    data.length <= 8
      ? data.map((_, index) => index)
      : [0, Math.floor(data.length / 3), Math.floor((2 * data.length) / 3), data.length - 1];

  return (
    <div className="dw-scroll -mx-1 overflow-x-auto px-1">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-60 w-full min-w-[560px]"
        role="img"
        aria-label={ariaLabel}
      >
        <defs>
          <linearGradient id="dw-bar-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: 'rgb(var(--series-1))' }} />
            <stop offset="100%" style={{ stopColor: 'rgb(var(--accent-bright))' }} />
          </linearGradient>
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

        {data.map((point, index) => {
          const height = point.value > 0 ? Math.max((point.value / max) * plotHeight, 2) : 0;
          const x = PAD.left + index * slot + (slot - barWidth) / 2;
          const y = baseline - height;
          return (
            <g key={`${point.label}-${index}`}>
              {height > 0 ? (
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={height}
                  rx={Math.min(4, barWidth / 3)}
                  fill="url(#dw-bar-fill)"
                  className="animate-bar-grow motion-reduce:animate-none"
                  style={{ animationDelay: `${Math.min(index * 25, 400)}ms`, transformOrigin: `50% ${baseline}px` }}
                >
                  <title>{point.title ? `${point.title}: ${formatValue(point.value)}` : formatValue(point.value)}</title>
                </rect>
              ) : null}
            </g>
          );
        })}

        {labelIndexes.map((index) => {
          const point = data[index];
          if (!point) return null;
          return (
            <text
              key={index}
              x={PAD.left + index * slot + slot / 2}
              y={HEIGHT - 9}
              textAnchor="middle"
              fontSize="10"
              className="numeric"
              style={{ fill: 'rgb(var(--chart-label))' }}
            >
              {point.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

export interface LinePoint {
  label: string;
  values: number[];
}

/**
 * Multi-series line chart for growth metrics. Pure SVG, one polyline per
 * series, colours resolved through theme CSS variables.
 */
export function LineChart({
  points,
  series,
  ariaLabel,
}: {
  points: LinePoint[];
  series: Array<{ key: string; label: string; variable: string }>;
  ariaLabel: string;
}) {
  if (points.length === 0 || points.every((point) => point.values.every((value) => value <= 0))) {
    return <ChartEmpty>No activity in this window.</ChartEmpty>;
  }

  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const max = niceMax(Math.max(...points.flatMap((point) => point.values), 0));
  const xAt = (index: number): number =>
    PAD.left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);

  const ticks = [...new Set(Array.from({ length: 5 }, (_, index) => Math.round((max / 4) * index)))];

  const labelIndexes =
    points.length <= 8
      ? points.map((_, index) => index)
      : [0, Math.floor(points.length / 3), Math.floor((2 * points.length) / 3), points.length - 1];

  return (
    <div className="flex flex-col gap-4">
      <div className="dw-scroll -mx-1 overflow-x-auto px-1">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-60 w-full min-w-[560px]"
          role="img"
          aria-label={ariaLabel}
        >
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

          {series.map((entry, seriesIndex) => {
            const path = points
              .map((point, index) => {
                const value = point.values[seriesIndex] ?? 0;
                const y = PAD.top + plotHeight - (value / max) * plotHeight;
                return `${index === 0 ? 'M' : 'L'}${xAt(index)} ${y}`;
              })
              .join(' ');

            return (
              <path
                key={entry.key}
                d={path}
                fill="none"
                stroke={`rgb(var(${entry.variable}))`}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="animate-fade-in motion-reduce:animate-none"
                style={{ animationDelay: `${seriesIndex * 90}ms` }}
              >
                <title>{entry.label}</title>
              </path>
            );
          })}

          {labelIndexes.map((index) => {
            const point = points[index];
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
                {point.label}
              </text>
            );
          })}
        </svg>
      </div>

      <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
        {series.map((entry) => (
          <li key={entry.key} className="flex items-center gap-2 text-[12.5px] text-ink-muted">
            <span
              aria-hidden
              className="h-2.5 w-2.5 rounded-full ring-1 ring-inset ring-black/5"
              style={{ backgroundColor: `rgb(var(${entry.variable}))` }}
            />
            {entry.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface DonutSlice {
  label: string;
  value: number;
  variable: string;
}

/**
 * Donut chart for plan distribution. Values below 4% are merged into a single
 * "Other" slice so the legend stays readable — callers can pre-merge instead.
 */
export function DonutChart({ slices, ariaLabel, centerLabel }: { slices: DonutSlice[]; ariaLabel: string; centerLabel?: string }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (total <= 0) return <ChartEmpty>No subscriptions yet.</ChartEmpty>;

  const radius = 70;
  const stroke = 26;
  const circumference = 2 * Math.PI * radius;

  const lengths = slices.map((slice) => (slice.value / total) * circumference);
  const offsets = lengths.reduce<number[]>((acc, length) => {
    acc.push((acc[acc.length - 1] ?? 0) + length);
    return acc;
  }, []);
  const arcs = slices.map((slice, index) => ({
    slice,
    length: lengths[index] ?? 0,
    offset: index === 0 ? 0 : (offsets[index - 1] ?? 0),
  }));

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:justify-center sm:gap-8">
      <svg viewBox="0 0 180 180" className="h-44 w-44 shrink-0" role="img" aria-label={ariaLabel}>
        <circle cx="90" cy="90" r={radius} fill="none" stroke="rgb(var(--chart-grid))" strokeWidth={stroke} />
        {arcs.map(({ slice, length, offset }) => (
          <circle
            key={slice.label}
            cx="90"
            cy="90"
            r={radius}
            fill="none"
            stroke={`rgb(var(${slice.variable}))`}
            strokeWidth={stroke}
            strokeDasharray={`${length} ${circumference - length}`}
            strokeDashoffset={-offset}
            transform="rotate(-90 90 90)"
            strokeLinecap="butt"
          >
            <title>{`${slice.label}: ${slice.value}`}</title>
          </circle>
        ))}
        <text x="90" y="86" textAnchor="middle" fontSize="22" fontWeight="600" className="numeric" style={{ fill: 'rgb(var(--chart-label))' }}>
          {total.toLocaleString()}
        </text>
        <text x="90" y="106" textAnchor="middle" fontSize="11" style={{ fill: 'rgb(var(--chart-label))' }}>
          {centerLabel ?? 'total'}
        </text>
      </svg>

      <ul className="flex flex-col gap-2.5">
        {slices.map((slice) => (
          <li key={slice.label} className="flex items-center justify-between gap-6 text-sm">
            <span className="flex items-center gap-2 text-ink-muted">
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-full ring-1 ring-inset ring-black/5"
                style={{ backgroundColor: `rgb(var(${slice.variable}))` }}
              />
              {slice.label}
            </span>
            <span className="numeric font-semibold text-ink">{slice.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Horizontal progress-style bar for a labelled value (marketing volume, rates). */
export function MetricBar({ label, value, max, hint }: { label: string; value: number; max: number; hint?: string }) {
  const width = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
        <span className="text-ink">{label}</span>
        <span className="numeric font-semibold text-ink">
          {value.toLocaleString()}
          {hint ? <span className="ml-2 text-xs font-normal text-ink-subtle">{hint}</span> : null}
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-line">
        <div
          className="h-full origin-left animate-bar-grow rounded-full motion-reduce:animate-none"
          style={{
            width: `${width}%`,
            backgroundImage: 'linear-gradient(90deg, rgb(var(--series-1)), rgb(var(--accent-bright)))',
          }}
        />
      </div>
    </div>
  );
}

export { ChartEmpty };
