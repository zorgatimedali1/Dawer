'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction } from 'react';
import { Loader2, Megaphone, Minus, Move, Plus, Printer, RotateCcw, Save, X } from 'lucide-react';
import QRCode from 'qrcode';
import logoDawer from '@/assets/dawer2.png';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/hooks/use-t';
import { cn } from '@/lib/cn';
import { interpolate, msg, translations, type Dictionary } from '@/lib/i18n';
import { PosterService, type Poster } from '@/services/poster.service';
import { CampaignService, type Campaign } from '@/services/campaign.service';

const THEMES = ['#24558f', '#bc9341', '#168777', '#bf5b6a'];

const SECTION_LABEL = 'text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle';

const ELEMENT_KEYS = ['brand', 'title', 'subtitle', 'steps', 'qr', 'gifts', 'logo'] as const;
type ElementKey = (typeof ELEMENT_KEYS)[number];

type ElementPositions = Partial<Record<ElementKey, { x: number; y: number }>>;
type ElementScales = Partial<Record<ElementKey, number>>;

/** Poster copy slots: `null` means "follow the active locale's default text". */
type PosterTextState = string | null;
type PosterTextKey =
  | 'defaultTitle'
  | 'defaultSubtitle'
  | 'defaultStep1'
  | 'defaultStep2'
  | 'defaultStep3'
  | 'defaultQrCaption';

const POSTER_STEP_KEYS = ['defaultStep1', 'defaultStep2', 'defaultStep3'] as const;

function posterDefaults(t: Dictionary) {
  return {
    title: t.poster.defaultTitle,
    subtitle: t.poster.defaultSubtitle,
    steps: POSTER_STEP_KEYS.map((key) => t.poster[key]),
    qrCaption: t.poster.defaultQrCaption,
  };
}

/** Empty text or the shipped default in ANY locale → the copy is still locale-driven. */
function isPosterDefault(value: PosterTextState, key: PosterTextKey): boolean {
  if (!value) return true;
  return Object.values(translations).some((dictionary) => dictionary.poster[key] === value);
}

function normalizePosterText(value: unknown, key: PosterTextKey): PosterTextState {
  if (typeof value !== 'string') return null;
  return isPosterDefault(value, key) ? null : value;
}

function isElementKey(value: string): value is ElementKey {
  return (ELEMENT_KEYS as readonly string[]).includes(value);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function positionsFromPoster(poster: Poster | null): ElementPositions {
  const raw = poster?.configuration?.positions;
  if (!raw || typeof raw !== 'object') return {};
  const result: ElementPositions = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (
      isElementKey(key) &&
      value &&
      typeof value === 'object' &&
      typeof (value as { x?: unknown }).x === 'number' &&
      typeof (value as { y?: unknown }).y === 'number'
    ) {
      result[key] = { x: (value as { x: number }).x, y: (value as { y: number }).y };
    }
  }
  return result;
}

function backgroundImageFromPoster(poster: Poster | null): string {
  const raw = poster?.configuration?.backgroundImage;
  return typeof raw === 'string' && isHttpUrl(raw) ? raw : '';
}

const MIN_SCALE = 0.6;
const MAX_SCALE = 1.6;

/** Global element-size multiplier persisted with the poster draft. */
function scaleFromPoster(poster: Poster | null): number {
  const raw = poster?.configuration?.scale;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(raw * 10) / 10));
}

/** Per-element size multipliers persisted with the poster draft (1 entries dropped). */
function elementScalesFromPoster(poster: Poster | null): ElementScales {
  const raw = poster?.configuration?.elementScales;
  if (!raw || typeof raw !== 'object') return {};
  const result: ElementScales = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isElementKey(key) && typeof value === 'number' && Number.isFinite(value)) {
      const rounded = Math.round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, value)) * 10) / 10;
      if (rounded !== 1) result[key] = rounded;
    }
  }
  return result;
}

interface PosterContent {
  brandName: string;
  steps: PosterTextState[];
  qrCaption: PosterTextState;
}

function contentFromPoster(poster: Poster | null, defaultBrand: string): PosterContent {
  const configuration = poster?.configuration ?? {};
  const savedSteps = Array.isArray(configuration.steps) ? configuration.steps : [];

  return {
    brandName: typeof configuration.brandName === 'string' && configuration.brandName.trim()
      ? configuration.brandName
      : defaultBrand,
    steps: POSTER_STEP_KEYS.map((key, index) =>
      typeof savedSteps[index] === 'string' ? normalizePosterText(String(savedSteps[index]), key) : null,
    ),
    qrCaption: normalizePosterText(configuration.qrCaption, 'defaultQrCaption'),
  };
}


function GiftBox({ accent, small = false }: { accent: string; small?: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={`relative shrink-0 ${small ? 'h-[12cqw] w-[17cqw]' : 'h-[15cqw] w-[21cqw]'}`}
    >
      <div className="absolute inset-x-[5%] bottom-0 h-[68%] rounded-[1cqw] bg-white shadow-md ring-1 ring-slate-200/70" />
      <div className="absolute inset-x-0 bottom-[61%] h-[18%] rounded-[1cqw] bg-white shadow-sm ring-1 ring-slate-200/70" />
      <div className="absolute bottom-0 left-[44%] h-[75%] w-[12%]" style={{ backgroundColor: accent }} />
      <div className="absolute bottom-[65%] left-0 h-[9%] w-full" style={{ backgroundColor: accent }} />
      <span
        className="absolute left-[25%] top-[2%] h-[28%] w-[27%] -rotate-45 rounded-full border-[0.8cqw] border-current border-b-transparent"
        style={{ color: accent }}
      />
      <span
        className="absolute right-[25%] top-[2%] h-[28%] w-[27%] rotate-45 rounded-full border-[0.8cqw] border-current border-b-transparent"
        style={{ color: accent }}
      />
    </div>
  );
}

interface PosterPreviewProps {
  brandName: string;
  title: PosterTextState;
  subtitle: PosterTextState;
  steps: PosterTextState[];
  qrCaption: PosterTextState;
  theme: string;
  template: string;
  qrDataUrl: string;
  qrError: string;
  campaignUrl: string;
  backgroundUrl: string;
  positions: ElementPositions;
  setPositions: Dispatch<SetStateAction<ElementPositions>>;
  elementScales: ElementScales;
  setElementScales: Dispatch<SetStateAction<ElementScales>>;
  scale: number;
  setScale: Dispatch<SetStateAction<number>>;
}

interface DragState {
  key: ElementKey;
  pointerId: number;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  containerW: number;
  minDX: number;
  maxDX: number;
  minDY: number;
  maxDY: number;
}

function PosterPreview({
  brandName,
  title,
  subtitle,
  steps,
  qrCaption,
  theme,
  template,
  qrDataUrl,
  qrError,
  campaignUrl,
  backgroundUrl,
  positions,
  setPositions,
  elementScales,
  setElementScales,
  scale,
  setScale,
}: PosterPreviewProps) {
  const t = useT();
  const defaults = posterDefaults(t);
  const background = template === 'minimal' ? '#f5fbf8' : template === 'festive' ? '#e4f5f0' : '#d9f2ea';
  const [moveMode, setMoveMode] = useState(false);
  const [activeKey, setActiveKey] = useState<ElementKey | null>(null);
  const [selectedKey, setSelectedKey] = useState<ElementKey | null>(null);
  const [failedBackgroundUrl, setFailedBackgroundUrl] = useState('');
  const articleRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const bgUsable = isHttpUrl(backgroundUrl.trim()) && failedBackgroundUrl !== backgroundUrl.trim();

  const startDrag = (key: ElementKey, event: ReactPointerEvent<HTMLElement>) => {
    if (!moveMode) return;
    const container = articleRef.current?.getBoundingClientRect();
    if (!container || !container.width) return;
    const el = event.currentTarget.getBoundingClientRect();
    const current = positions[key] ?? { x: 0, y: 0 };
    const offsetXpx = (current.x / 100) * container.width;
    const offsetYpx = (current.y / 100) * container.width;
    const baseLeft = el.left - offsetXpx;
    const baseTop = el.top - offsetYpx;
    dragRef.current = {
      key,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: current.x,
      offsetY: current.y,
      containerW: container.width,
      minDX: container.left - baseLeft,
      maxDX: container.right - baseLeft - el.width,
      minDY: container.top - baseTop,
      maxDY: container.bottom - baseTop - el.height,
    };
    setActiveKey(key);
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* pointer capture is best-effort */
    }
  };

  const moveDrag = (key: ElementKey, event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.key !== key || drag.pointerId !== event.pointerId) return;
    const offsetXpx = (drag.offsetX / 100) * drag.containerW + (event.clientX - drag.startX);
    const offsetYpx = (drag.offsetY / 100) * drag.containerW + (event.clientY - drag.startY);
    const loX = Math.min(drag.minDX, drag.maxDX);
    const hiX = Math.max(drag.minDX, drag.maxDX);
    const loY = Math.min(drag.minDY, drag.maxDY);
    const hiY = Math.max(drag.minDY, drag.maxDY);
    const x = (Math.min(Math.max(offsetXpx, loX), hiX) / drag.containerW) * 100;
    const y = (Math.min(Math.max(offsetYpx, loY), hiY) / drag.containerW) * 100;
    setPositions((prev) => ({
      ...prev,
      [key]: { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 },
    }));
  };

  const endDrag = (key: ElementKey, event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.key !== key || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setActiveKey(null);
    // Keep the element selected after the gesture so its resize controls stay available.
    setSelectedKey(key);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* pointer capture is best-effort */
    }
  };

  /** Global × per-element multiplier applied to one moveable element. */
  const combinedScale = (key: ElementKey) =>
    Math.round(scale * (elementScales[key] ?? 1) * 100) / 100;

  const bumpElementScale = (key: ElementKey, delta: number) => {
    setElementScales((prev) => {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(((prev[key] ?? 1) + delta) * 10) / 10));
      const updated = { ...prev };
      if (next === 1) delete updated[key];
      else updated[key] = next;
      return updated;
    });
  };

  const elementLabel = (key: ElementKey): string => {
    switch (key) {
      case 'brand': return t.poster.brandLabel;
      case 'title': return t.poster.titleLabel;
      case 'subtitle': return t.poster.subtitleLabel;
      case 'steps': return t.poster.stepsLegend;
      case 'qr': return t.poster.elQr;
      case 'gifts': return t.poster.elGifts;
      case 'logo': return t.poster.logoAlt;
    }
  };

  const moveableStyle = (key: ElementKey, base?: CSSProperties): CSSProperties => {
    const position = positions[key];
    return {
      ...base,
      transform: `translate(${position ? position.x : 0}cqw, ${position ? position.y : 0}cqw) scale(${combinedScale(key)})`,
      ...(moveMode ? { touchAction: 'none', cursor: 'grab' as const } : {}),
      ...(activeKey === key ? { cursor: 'grabbing' as const } : {}),
    };
  };

  const moveableClass = (key: ElementKey, base: string) =>
    cn(
      base,
      moveMode && 'select-none rounded-sm hover:ring-1 hover:ring-accent',
      (activeKey === key || selectedKey === key) && 'ring-1 ring-accent',
    );

  return (
    <section className="order-1 xl:order-2">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">{t.poster.previewTitle}</h3>
        <div className="flex items-center gap-2">
          <div
            className="flex items-center gap-0.5 rounded-md border border-line bg-surface-2/70 px-1 py-0.5"
            role="group"
            aria-label={t.poster.resizeLabel}
          >
            <button
              type="button"
              aria-label={t.poster.resizeSmaller}
              onClick={() => setScale((value) => Math.max(MIN_SCALE, Math.round((value - 0.1) * 10) / 10))}
              className="inline-flex h-6 w-6 items-center justify-center rounded text-ink-muted transition-colors hover:bg-ink/[0.06] hover:text-ink"
            >
              <Minus className="h-3.5 w-3.5" aria-hidden />
            </button>
            <span aria-live="polite" className="w-9 text-center text-[11px] font-medium tabular-nums text-ink-muted">
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              aria-label={t.poster.resizeLarger}
              onClick={() => setScale((value) => Math.min(MAX_SCALE, Math.round((value + 0.1) * 10) / 10))}
              className="inline-flex h-6 w-6 items-center justify-center rounded text-ink-muted transition-colors hover:bg-ink/[0.06] hover:text-ink"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
          <Button
            type="button"
            variant={moveMode ? 'subtle' : 'ghost'}
            size="xs"
            aria-pressed={moveMode}
            onClick={() => {
              const next = !moveMode;
              setMoveMode(next);
              if (!next) {
                setSelectedKey(null);
                setActiveKey(null);
                dragRef.current = null;
              }
            }}
          >
            <Move className="h-3.5 w-3.5" aria-hidden />
            {t.poster.moveMode}
          </Button>
          <span className="text-xs text-ink-subtle">Portrait · 5 × 7</span>
        </div>
      </div>
      <article
        ref={articleRef}
        data-testid="poster-preview"
        className="poster-print-area relative mx-auto flex aspect-[5/7] w-full max-w-[620px] flex-col overflow-hidden border border-slate-200 text-center shadow-lg"
        style={{ backgroundColor: background, containerType: 'inline-size' }}
      >
        {bgUsable ? (
          <img
            src={backgroundUrl.trim()}
            alt=""
            aria-hidden
            draggable={false}
            className="pointer-events-none absolute inset-0 h-full w-full object-cover"
            onError={() => setFailedBackgroundUrl(backgroundUrl.trim())}
          />
        ) : null}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <span className="absolute -left-[13%] top-[36%] h-[28cqw] w-[28cqw] rounded-full bg-white/35" />
          <span className="absolute -right-[14%] top-[53%] h-[36cqw] w-[36cqw] rounded-full bg-white/30" />
          <span className="absolute left-[18%] top-[76%] h-[1.2cqw] w-[1.2cqw] rounded-full bg-amber-300/80" />
          <span className="absolute right-[19%] top-[74%] h-[1cqw] w-[1cqw] rounded-full bg-amber-300/80" />
        </div>

        <div className="relative z-10 flex h-full flex-col items-center px-[7cqw] pb-[3cqw] pt-[3cqw]">
          <header
            className={moveableClass('brand', 'flex items-center justify-center gap-[2cqw]')}
            style={moveableStyle('brand')}
            onPointerDown={moveMode ? (event) => startDrag('brand', event) : undefined}
            onPointerMove={moveMode ? (event) => moveDrag('brand', event) : undefined}
            onPointerUp={moveMode ? (event) => endDrag('brand', event) : undefined}
            onPointerCancel={moveMode ? (event) => endDrag('brand', event) : undefined}
          >
            <span
              className="grid h-[8cqw] w-[8cqw] shrink-0 place-items-center rounded-full text-white"
              style={{ backgroundColor: theme, fontSize: '3.8cqw', fontWeight: 700 }}
            >
              {brandName.trim().charAt(0).toUpperCase() || 'C'}
            </span>
            <span
              className="max-w-[75cqw] min-w-0 overflow-wrap-anywhere font-bold uppercase tracking-[0.08em]"
              style={{ color: theme, fontSize: '3.4cqw' }}
            >
              {brandName || t.poster.brandFallback}
            </span>
          </header>

          <h3
            className={moveableClass('title', 'mt-[4cqw] max-w-[94%] font-extrabold leading-[1.04]')}
            style={moveableStyle('title', { color: theme, fontSize: 'clamp(1.15rem, 5.6cqw, 2rem)', overflowWrap: 'anywhere' })}
            onPointerDown={moveMode ? (event) => startDrag('title', event) : undefined}
            onPointerMove={moveMode ? (event) => moveDrag('title', event) : undefined}
            onPointerUp={moveMode ? (event) => endDrag('title', event) : undefined}
            onPointerCancel={moveMode ? (event) => endDrag('title', event) : undefined}
          >
            {title || defaults.title}
          </h3>
          <p
            className={moveableClass('subtitle', 'mt-[2cqw] max-w-[92%] leading-[1.2] text-slate-600')}
            style={moveableStyle('subtitle', { fontSize: 'clamp(0.72rem, 3.1cqw, 1rem)' })}
            onPointerDown={moveMode ? (event) => startDrag('subtitle', event) : undefined}
            onPointerMove={moveMode ? (event) => moveDrag('subtitle', event) : undefined}
            onPointerUp={moveMode ? (event) => endDrag('subtitle', event) : undefined}
            onPointerCancel={moveMode ? (event) => endDrag('subtitle', event) : undefined}
          >
            {subtitle || defaults.subtitle}
          </p>

          <ol
            className={moveableClass('steps', 'mt-[4cqw] flex w-full flex-col gap-[1.4cqw] text-left')}
            style={moveableStyle('steps')}
            onPointerDown={moveMode ? (event) => startDrag('steps', event) : undefined}
            onPointerMove={moveMode ? (event) => moveDrag('steps', event) : undefined}
            onPointerUp={moveMode ? (event) => endDrag('steps', event) : undefined}
            onPointerCancel={moveMode ? (event) => endDrag('steps', event) : undefined}
          >
            {steps.map((step, index) => (
              <li
                key={index}
                className="flex min-h-[10cqw] items-center gap-[3cqw] rounded-[2.5cqw] bg-white/80 px-[3cqw] py-[1.5cqw] shadow-sm ring-1 ring-white"
              >
                <span
                  className="grid h-[8cqw] w-[8cqw] shrink-0 place-items-center rounded-full font-bold text-white"
                  style={{ backgroundColor: '#d1aa51', fontSize: '3.5cqw' }}
                >
                  {index + 1}
                </span>
                <span className="min-w-0 font-semibold leading-tight text-slate-800" style={{ fontSize: '3.4cqw', overflowWrap: 'anywhere' }}>
                  {step || defaults.steps[index]}
                </span>
              </li>
            ))}
          </ol>

          <div
            className={moveableClass('qr', 'mt-[3cqw] flex w-full flex-col items-center')}
            style={moveableStyle('qr')}
            onPointerDown={moveMode ? (event) => startDrag('qr', event) : undefined}
            onPointerMove={moveMode ? (event) => moveDrag('qr', event) : undefined}
            onPointerUp={moveMode ? (event) => endDrag('qr', event) : undefined}
            onPointerCancel={moveMode ? (event) => endDrag('qr', event) : undefined}
          >
            <div className="grid aspect-square w-[34cqw] shrink-0 place-items-center rounded-[3cqw] bg-white p-[2cqw] shadow-md ring-1 ring-slate-200/70">
              {qrDataUrl ? (
                <img
                  className="h-full w-full object-contain"
                  src={qrDataUrl}
                   alt={interpolate(t.poster.qrAlt, { brand: brandName })}
                  draggable={false}
                />
              ) : (
                 <Loader2 className="h-[16%] w-[16%] animate-spin text-slate-400" aria-label={t.poster.qrLoading} />
              )}
            </div>
            <p className="mt-[2cqw] max-w-full font-bold leading-tight" style={{ color: theme, fontSize: '3.2cqw' }}>
              {qrCaption || defaults.qrCaption}
            </p>
          </div>

          <div
            className={moveableClass('gifts', 'mt-auto flex w-full items-start justify-start gap-[6cqw] px-[5cqw] pt-[2cqw]')}
            style={moveableStyle('gifts')}
            onPointerDown={moveMode ? (event) => startDrag('gifts', event) : undefined}
            onPointerMove={moveMode ? (event) => moveDrag('gifts', event) : undefined}
            onPointerUp={moveMode ? (event) => endDrag('gifts', event) : undefined}
            onPointerCancel={moveMode ? (event) => endDrag('gifts', event) : undefined}
          >
            <GiftBox accent={theme} />
            <GiftBox accent="#d1aa51" small />
          </div>
          <div
            className={moveableClass('logo', 'absolute bottom-[4cqw] right-[4cqw]')}
            style={moveableStyle('logo')}
            data-testid="poster-logo"
            onPointerDown={moveMode ? (event) => startDrag('logo', event) : undefined}
            onPointerMove={moveMode ? (event) => moveDrag('logo', event) : undefined}
            onPointerUp={moveMode ? (event) => endDrag('logo', event) : undefined}
            onPointerCancel={moveMode ? (event) => endDrag('logo', event) : undefined}
          >
            <img
              src={logoDawer}
              alt={t.poster.logoAlt}
              draggable={false}
              className="block h-[7cqw] w-auto max-w-[34cqw] object-contain"
            />
          </div>
          {qrError && <p className="absolute bottom-1 left-2 right-2 text-[10px] text-rose-700">{qrError}</p>}
        </div>
      </article>
      {moveMode ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-ink-muted">{t.poster.moveModeHint}</p>
          {selectedKey ? (
            <div
              className="flex items-center gap-0.5 rounded-md border border-line bg-surface-2/70 px-1 py-0.5"
              role="group"
              aria-label={interpolate(t.poster.resizeOneLabel, { name: elementLabel(selectedKey) })}
            >
              <button
                type="button"
                aria-label={interpolate(t.poster.resizeOneSmaller, { name: elementLabel(selectedKey) })}
                onClick={() => bumpElementScale(selectedKey, -0.1)}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-ink-muted transition-colors hover:bg-ink/[0.06] hover:text-ink"
              >
                <Minus className="h-3.5 w-3.5" aria-hidden />
              </button>
              <span aria-live="polite" className="w-9 text-center text-[11px] font-medium tabular-nums text-ink-muted">
                {Math.round(combinedScale(selectedKey) * 100)}%
              </span>
              <button
                type="button"
                aria-label={interpolate(t.poster.resizeOneLarger, { name: elementLabel(selectedKey) })}
                onClick={() => bumpElementScale(selectedKey, 0.1)}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-ink-muted transition-colors hover:bg-ink/[0.06] hover:text-ink"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => {
              setPositions({});
              dragRef.current = null;
              setActiveKey(null);
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            {t.poster.resetPositions}
          </Button>
        </div>
      ) : null}
      {failedBackgroundUrl && failedBackgroundUrl === backgroundUrl.trim() ? (
        <p className="mt-2 text-center text-xs text-danger-600 dark:text-danger-300" role="alert">
          {t.poster.backgroundLoadError}
        </p>
      ) : null}
      <p className="mx-auto mt-3 max-w-[620px] break-all text-center font-mono text-[10px] text-ink-subtle">{campaignUrl}</p>
    </section>
  );
}

export default function PosterEditorPage() {
  const t = useT();
  const defaults = posterDefaults(t);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState('');
  const [posters, setPosters] = useState<Poster[]>([]);
  const [poster, setPoster] = useState<Poster | null>(null);
  const [brandName, setBrandName] = useState('');
  const [title, setTitle] = useState<PosterTextState>(null);
  const [subtitle, setSubtitle] = useState<PosterTextState>(null);
  const [steps, setSteps] = useState<PosterTextState[]>([null, null, null]);
  const [qrCaption, setQrCaption] = useState<PosterTextState>(null);
  const [theme, setTheme] = useState('#24558f');
  const [template, setTemplate] = useState('gradient');
  const [positions, setPositions] = useState<ElementPositions>({});
  const [elementScales, setElementScales] = useState<ElementScales>({});
  const [scale, setScale] = useState(1);
  const [backgroundUrl, setBackgroundUrl] = useState('');
  const [qrResult, setQrResult] = useState<{ url: string; dataUrl?: string; error?: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const loadPosters = useCallback(async (selectedCampaignId: string) => {
    const list = await PosterService.list({ campaignId: selectedCampaignId });
    setPosters(list);
    return list;
  }, []);

  const applyPosterDraft = useCallback((loadedPoster: Poster | undefined, campaignName: string) => {
    const content = contentFromPoster(loadedPoster ?? null, campaignName);
    setPoster(loadedPoster ?? null);
    setBrandName(content.brandName);
    setTitle(normalizePosterText(loadedPoster?.title, 'defaultTitle'));
    setSubtitle(normalizePosterText(loadedPoster?.subtitle, 'defaultSubtitle'));
    setSteps(content.steps);
    setQrCaption(content.qrCaption);
    setTheme(loadedPoster?.theme || '#24558f');
    setTemplate(loadedPoster?.template || 'gradient');
    setPositions(positionsFromPoster(loadedPoster ?? null));
    setElementScales(elementScalesFromPoster(loadedPoster ?? null));
    setScale(scaleFromPoster(loadedPoster ?? null));
    setBackgroundUrl(backgroundImageFromPoster(loadedPoster ?? null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    CampaignService.getCampaigns({ limit: 100 })
      .then(async (list) => {
        if (cancelled) return;
        setCampaigns(list);
        const first = list[0];
        setCampaignId(first?.id ?? '');
        if (!first) return;
        const loaded = await loadPosters(first.id);
        if (!cancelled) applyPosterDraft(loaded[0], first.name);
      })
      .catch((cause: unknown) => setError(msg(t, cause instanceof Error ? cause.message : 'Unable to load the poster editor.')))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [applyPosterDraft, loadPosters, t]);

  const selectedCampaign = campaigns.find((campaign) => campaign.id === campaignId);
  const campaignUrl = selectedCampaign
    ? `${window.location.origin}/wheels/${encodeURIComponent(selectedCampaign.publicCode)}`
    : '';
  const qrDataUrl = qrResult?.url === campaignUrl ? qrResult.dataUrl ?? '' : '';
  const qrError = qrResult?.url === campaignUrl && qrResult.error ? t.poster.qrError : '';

  useEffect(() => {
    let cancelled = false;
    if (!campaignUrl) return;

    QRCode.toDataURL(campaignUrl, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 512,
      color: { dark: '#173344', light: '#ffffff' },
    })
      .then((dataUrl) => {
        if (!cancelled) setQrResult({ url: campaignUrl, dataUrl });
      })
      .catch(() => {
        if (!cancelled) setQrResult({ url: campaignUrl, error: true });
      });

    return () => {
      cancelled = true;
    };
  }, [campaignUrl]);

  const handleCampaignChange = async (nextCampaignId: string) => {
    setCampaignId(nextCampaignId);
    setError('');
    setStatus('');
    try {
      const loaded = await loadPosters(nextCampaignId);
      const campaign = campaigns.find((item) => item.id === nextCampaignId);
      applyPosterDraft(loaded[0], campaign?.name ?? 'Dawer');
    } catch (cause) {
      setError(msg(t, cause instanceof Error ? cause.message : 'Unable to load posters.'));
    }
  };

  const handleSave = async () => {
    if (!campaignId) return;
    setSaving(true);
    setStatus('');
    setError('');
    try {
      const trimmedBackground = backgroundUrl.trim();
      const configuration = {
        brandName,
        steps: steps.map((step, index) => step ?? defaults.steps[index]),
        qrCaption: qrCaption ?? defaults.qrCaption,
        positions,
        scale,
        elementScales,
        ...(isHttpUrl(trimmedBackground) ? { backgroundImage: trimmedBackground } : {}),
      };
      const resolvedTitle = title ?? defaults.title;
      const resolvedSubtitle = subtitle ?? defaults.subtitle;
      const saved = poster
        ? await PosterService.update(poster.id, { title: resolvedTitle, subtitle: resolvedSubtitle, theme, template, configuration })
        : await PosterService.create({ campaignId, title: resolvedTitle, subtitle: resolvedSubtitle, theme, template, configuration });
      setPoster(saved);
      setPosters(await loadPosters(campaignId));
      setStatus(t.poster.saved);
    } catch (cause) {
      setError(msg(t, cause instanceof Error ? cause.message : 'Unable to save the poster.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-7 w-72" />
        </div>
        <div className="grid gap-6 xl:grid-cols-[minmax(300px,0.75fr)_minmax(460px,1.25fr)]">
          <Skeleton className="order-2 h-[32rem] w-full rounded-xl xl:order-1" />
          <Skeleton className="order-1 h-[32rem] w-full rounded-xl xl:order-2" />
        </div>
        <p className="text-[13.5px] text-ink-muted">{t.poster.loadingEditor}</p>
      </div>
    );
  }

  if (campaigns.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          eyebrow={t.poster.eyebrow}
          title={t.poster.title}
        />
        <Card>
          <CardContent className="pt-5 sm:pt-6">
            <EmptyState
              size="sm"
              icon={Megaphone}
              title={t.poster.emptyTitle}
              description={t.poster.emptyDescription}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={t.poster.eyebrow}
        title={t.poster.title}
        description={t.poster.description}
        actions={
          <div className="flex flex-col items-start gap-1 text-[13px] sm:items-end">
            {status ? (
              <p className="inline-flex items-center gap-1.5 font-medium text-success-700 dark:text-success-300">
                <Save className="h-3.5 w-3.5" aria-hidden />
                {status}
              </p>
            ) : null}
            {error ? (
              <p className="font-medium text-danger-600 dark:text-danger-300">{error}</p>
            ) : null}
            {saving ? <p className="text-ink-subtle">{t.common.saving}</p> : null}
          </div>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(300px,0.75fr)_minmax(460px,1.25fr)]">
        <Card className="order-2 flex flex-col xl:order-1">
          <CardHeader>
            <p className={SECTION_LABEL}>{t.poster.sectionContent}</p>
            <CardTitle className="text-lg">{t.poster.contentTitle}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field
              label={t.poster.campaignLabel}
              htmlFor="poster-campaign"
              hint={
                posters.length > 0
                  ? interpolate(t.poster.savedCount, {
                      count: posters.length,
                      s: posters.length > 1 ? 's' : '',
                    })
                  : undefined
              }
            >
              <Select
                id="poster-campaign"
                value={campaignId}
                onChange={(event) => void handleCampaignChange(event.target.value)}
              >
                {campaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t.poster.brandLabel} htmlFor="poster-brand">
              <Input
                id="poster-brand"
                maxLength={60}
                value={brandName}
                onChange={(event) => setBrandName(event.target.value)}
              />
            </Field>

            <Field label={t.poster.titleLabel} htmlFor="poster-title">
              <Input
                id="poster-title"
                maxLength={56}
                value={title ?? defaults.title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>

            <Field label={t.poster.subtitleLabel} htmlFor="poster-subtitle">
              <Input
                id="poster-subtitle"
                maxLength={92}
                value={subtitle ?? defaults.subtitle}
                onChange={(event) => setSubtitle(event.target.value)}
              />
            </Field>

            <fieldset className="flex flex-col gap-3 border-t border-line pt-4">
              <legend className={SECTION_LABEL}>{t.poster.stepsLegend}</legend>
              {steps.map((step, index) => (
                <div key={index} className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className="numeric inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[12.5px] font-semibold text-brand-800 dark:bg-brand-900/50 dark:text-accent-bright"
                  >
                    {index + 1}
                  </span>
                  <Input
                    aria-label={interpolate(t.poster.stepAria, { n: index + 1 })}
                    maxLength={60}
                    value={step ?? defaults.steps[index]}
                    onChange={(event) => setSteps((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}
                  />
                </div>
              ))}
            </fieldset>

            <Field label={t.poster.qrCaptionLabel} htmlFor="poster-qr-caption">
              <Input
                id="poster-qr-caption"
                maxLength={60}
                value={qrCaption ?? defaults.qrCaption}
                onChange={(event) => setQrCaption(event.target.value)}
              />
            </Field>

            <Field label={t.poster.templateLabel} htmlFor="poster-template">
              <Select id="poster-template" value={template} onChange={(event) => setTemplate(event.target.value)}>
                <option value="gradient">{t.poster.templateGradient}</option>
                <option value="minimal">{t.poster.templateMinimal}</option>
                <option value="festive">{t.poster.templateFestive}</option>
              </Select>
            </Field>

            <Field
              label={t.poster.backgroundUrlLabel}
              htmlFor="poster-background"
              error={
                backgroundUrl.trim() && !isHttpUrl(backgroundUrl.trim())
                  ? t.poster.backgroundUrlInvalid
                  : undefined
              }
              action={
                backgroundUrl ? (
                  <button
                    type="button"
                    onClick={() => setBackgroundUrl('')}
                    className="inline-flex items-center gap-1 text-[12.5px] font-medium text-ink-subtle transition-colors hover:text-ink"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                    {t.poster.backgroundRemove}
                  </button>
                ) : undefined
              }
            >
              <Input
                id="poster-background"
                type="url"
                inputMode="url"
                maxLength={500}
                placeholder={t.poster.backgroundPlaceholder}
                value={backgroundUrl}
                onChange={(event) => setBackgroundUrl(event.target.value)}
              />
            </Field>

            <div className="flex flex-col gap-2">
              <p className={SECTION_LABEL}>{t.poster.colorLabel}</p>
              <div className="flex flex-wrap gap-2.5">
                {THEMES.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setTheme(color)}
                    className={cn(
                      'h-9 w-9 rounded-full border transition-transform duration-180 ease-swift motion-reduce:transition-none',
                      theme === color
                        ? 'border-ink ring-2 ring-accent/50 ring-offset-2 ring-offset-card'
                        : 'border-line hover:scale-105 motion-reduce:hover:scale-100',
                    )}
                    style={{ backgroundColor: color }}
                    aria-label={interpolate(t.poster.colorAria, { color })}
                    aria-pressed={theme === color}
                    title={color}
                  />
                ))}
              </div>
            </div>
          </CardContent>

          <CardFooter className="mt-auto flex-wrap">
            <Button type="button" variant="outline" onClick={() => window.print()} disabled={!qrDataUrl}>
              <Printer className="h-4 w-4" aria-hidden />
              {t.poster.print}
            </Button>
            <Button type="button" onClick={() => void handleSave()} disabled={saving || !campaignId}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
              {t.poster.savePoster}
            </Button>
            <p className="basis-full text-xs text-ink-muted">{t.poster.printTip}</p>
          </CardFooter>
        </Card>

        <PosterPreview
          brandName={brandName}
          title={title}
          subtitle={subtitle}
          steps={steps}
          qrCaption={qrCaption}
          theme={theme}
          template={template}
          qrDataUrl={qrDataUrl}
          qrError={qrError}
          campaignUrl={campaignUrl}
          backgroundUrl={backgroundUrl}
          positions={positions}
          setPositions={setPositions}
          elementScales={elementScales}
          setElementScales={setElementScales}
          scale={scale}
          setScale={setScale}
        />
      </div>
    </div>
  );
}
