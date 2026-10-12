'use client';

import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties, type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction } from 'react';
import {
  ChevronRight,
  Gift,
  Loader2,
  Megaphone,
  Minus,
  Move,
  Plus,
  Printer,
  QrCode,
  RotateCcw,
  Save,
  Smartphone,
  Star,
  UserRound,
} from 'lucide-react';
import QRCode from 'qrcode';
import { DawerLogo } from '@/components/brand/dawer-logo';
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

const SECTION_LABEL = 'text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle';

const ELEMENT_KEYS = ['title', 'subtitle', 'steps', 'qr', 'gifts', 'logo'] as const;
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
    titleAccent: t.poster.defaultTitleAccent,
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


/** Brand palette lifted from the reference poster so every layer stays in tune. */
const BRAND_GREEN = '#5BA143';
const BRAND_GREEN_DEEP = '#3E8C34';
const BRAND_GREEN_SOFT = '#E7F3E4';
const BRAND_INK = '#17223B';

/**
 * A softly rendered gift box: rounded body with a lid, a satin ribbon band and
 * a looped bow, shaded with linear gradients to read as three-dimensional like
 * the reference art (a flat fill would look like a wireframe placeholder).
 */
function GiftBox({
  body,
  ribbon,
  className = '',
  rotate = 0,
}: {
  body: string;
  ribbon: string;
  className?: string;
  rotate?: number;
}) {
  return (
    <div
      aria-hidden="true"
      className={`relative ${className}`}
      style={{ transform: `rotate(${rotate}deg)` }}
    >
      {/* bow loops sit above the lid */}
      <span
        className="absolute left-[16%] top-0 h-[26%] w-[32%] rounded-full"
        style={{
          border: `${'0.9cqw'} solid ${ribbon}`,
          borderBottomColor: 'transparent',
          transform: 'rotate(-32deg)',
          filter: 'drop-shadow(0 0.3cqw 0.4cqw rgba(20,60,20,0.18))',
        }}
      />
      <span
        className="absolute right-[16%] top-0 h-[26%] w-[32%] rounded-full"
        style={{
          border: `${'0.9cqw'} solid ${ribbon}`,
          borderBottomColor: 'transparent',
          transform: 'rotate(32deg)',
          filter: 'drop-shadow(0 0.3cqw 0.4cqw rgba(20,60,20,0.18))',
        }}
      />
      {/* lid */}
      <div
        className="absolute inset-x-0 top-[22%] h-[22%] rounded-[1cqw]"
        style={{
          background: `linear-gradient(180deg, ${body} 0%, ${body} 55%, rgba(0,0,0,0.08) 100%)`,
          boxShadow: '0 0.6cqw 1.2cqw rgba(20,60,20,0.16)',
        }}
      />
      {/* body */}
      <div
        className="absolute inset-x-[6%] bottom-0 top-[42%] rounded-[1cqw]"
        style={{
          background: `linear-gradient(160deg, ${body} 0%, ${body} 60%, rgba(0,0,0,0.1) 100%)`,
          boxShadow: 'inset 0 -1cqw 1.6cqw rgba(0,0,0,0.12), 0 1cqw 2cqw rgba(20,60,20,0.14)',
        }}
      />
      {/* ribbon band down the centre */}
      <div
        className="absolute left-1/2 top-[22%] bottom-0 w-[14%] -translate-x-1/2"
        style={{ background: `linear-gradient(90deg, ${ribbon} 0%, rgba(255,255,255,0.28) 45%, ${ribbon} 100%)` }}
      />
    </div>
  );
}

/** Small rotated ribbon scrap used as festive confetti. */
function Confetti({ className, rotate = 0, tone }: { className: string; rotate?: number; tone: string }) {
  return (
    <span
      aria-hidden="true"
      className={`absolute rounded-[0.3cqw] ${className}`}
      style={{ backgroundColor: tone, transform: `rotate(${rotate}deg)`, opacity: 0.85 }}
    />
  );
}

/** Full-bleed decorative field: gradient, corner ribbon, confetti and the bottom wave. */
function PosterBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* soft green → white radial wash */}
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(120% 90% at 50% 8%, #ffffff 0%, #f2f9ef 32%, ${BRAND_GREEN_SOFT} 62%, #dcefdd 100%)`,
        }}
      />
      {/* top-right green ribbon sweep */}
      <div
        className="absolute -right-[18%] -top-[14%] h-[42cqw] w-[42cqw] rounded-full"
        style={{
          background: `radial-gradient(circle at 30% 30%, ${BRAND_GREEN} 0%, ${BRAND_GREEN_DEEP} 70%, rgba(62,140,52,0) 100%)`,
          filter: 'blur(0.2cqw)',
          opacity: 0.92,
        }}
      />
      {/* left ribbon curl */}
      <div
        className="absolute -left-[16%] -top-[6%] h-[26cqw] w-[26cqw] rounded-full"
        style={{
          background: `radial-gradient(circle at 60% 40%, #8ec96f 0%, ${BRAND_GREEN} 55%, rgba(91,161,67,0) 100%)`,
          opacity: 0.5,
        }}
      />
      {/* bottom wave */}
      <svg
        viewBox="0 0 100 26"
        preserveAspectRatio="none"
        className="absolute inset-x-0 bottom-0 h-[24%] w-full"
      >
        <defs>
          <linearGradient id="poster-wave" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={BRAND_GREEN} />
            <stop offset="100%" stopColor={BRAND_GREEN_DEEP} />
          </linearGradient>
        </defs>
        <path
          d="M0 10 C 22 2, 40 16, 62 12 C 82 8, 92 2, 100 6 L100 26 L0 26 Z"
          fill="url(#poster-wave)"
        />
        <path
          d="M0 12 C 24 5, 42 18, 64 14 C 83 10, 93 5, 100 8"
          fill="none"
          stroke="#ffffff"
          strokeOpacity="0.35"
          strokeWidth="0.6"
        />
      </svg>
      {/* confetti */}
      <Confetti className="left-[6%] top-[52%] h-[1.6cqw] w-[4cqw]" rotate={-24} tone="#7cc158" />
      <Confetti className="left-[2%] top-[58%] h-[1.4cqw] w-[3.4cqw]" rotate={38} tone="#ffffff" />
      <Confetti className="right-[7%] top-[54%] h-[1.5cqw] w-[3.8cqw]" rotate={22} tone="#7cc158" />
      <Confetti className="right-[3%] top-[61%] h-[1.3cqw] w-[3cqw]" rotate={-40} tone="#ffffff" />
      <Confetti className="left-[12%] top-[66%] h-[1.2cqw] w-[3cqw]" rotate={12} tone="#a9d98c" />
      <Confetti className="right-[14%] top-[68%] h-[1.2cqw] w-[2.8cqw]" rotate={-16} tone="#a9d98c" />
    </div>
  );
}

/** The two gift boxes flanking the QR block in the reference art. */
function GiftPair() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <GiftBox
        body="#ffffff"
        ribbon={BRAND_GREEN}
        rotate={-8}
        className="absolute left-[-2%] top-[48%] h-[22cqw] w-[26cqw]"
      />
      <GiftBox
        body={BRAND_GREEN}
        ribbon="#ffffff"
        rotate={9}
        className="absolute right-[-2%] top-[50%] h-[21cqw] w-[25cqw]"
      />
    </div>
  );
}

/** Decorative accent chevrons that flank the headline and QR caption. */
function AccentChevrons({ side, tone }: { side: 'left' | 'right'; tone: string }) {
  return (
    <span aria-hidden="true" className="inline-flex shrink-0 items-center gap-[0.4cqw]">
      {Array.from({ length: 3 }).map((_, i) => (
        <span
          key={i}
          style={{
            width: '0.9cqw',
            height: `${2.4 - i * 0.5}cqw`,
            backgroundColor: tone,
            borderRadius: '0.4cqw',
            transform: `rotate(${(side === 'left' ? -1 : 1) * (18 + i * 6)}deg)`,
          }}
        />
      ))}
    </span>
  );
}

/** Chevron used between the three step cards. */
function StepArrow() {
  return <ChevronRight aria-hidden className="shrink-0 text-[#8fc97a]" style={{ width: '4.5cqw', height: '4.5cqw', strokeWidth: 3 }} />;
}

function StepIcon({ kind }: { kind: 0 | 1 | 2 }) {
  const tone = BRAND_GREEN;
  if (kind === 0) {
    return (
      <span className="relative grid h-full w-full place-items-center">
        <Smartphone style={{ width: '5.2cqw', height: '5.2cqw' }} color={tone} strokeWidth={1.8} />
        <QrCode
          style={{ width: '2.6cqw', height: '2.6cqw', position: 'absolute', top: '18%', left: '32%' }}
          color={tone}
          strokeWidth={2.4}
        />
      </span>
    );
  }
  if (kind === 1) {
    return (
      <span className="relative grid h-full w-full place-items-center">
        <UserRound style={{ width: '5.4cqw', height: '5.4cqw' }} color={tone} strokeWidth={1.8} />
        <Star
          style={{ width: '2.6cqw', height: '2.6cqw', position: 'absolute', bottom: '18%', right: '26%' }}
          color={tone}
          fill={tone}
          strokeWidth={1.5}
        />
      </span>
    );
  }
  return <Gift style={{ width: '5.4cqw', height: '5.4cqw' }} color={tone} strokeWidth={1.8} />;
}

interface PosterPreviewProps {
  brandName: string;
  title: PosterTextState;
  subtitle: PosterTextState;
  steps: PosterTextState[];
  qrCaption: PosterTextState;
  qrDataUrl: string;
  qrError: string;
  campaignUrl: string;
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
  qrDataUrl,
  qrError,
  campaignUrl,
  positions,
  setPositions,
  elementScales,
  setElementScales,
  scale,
  setScale,
}: PosterPreviewProps) {
  const t = useT();
  const defaults = posterDefaults(t);
  const [moveMode, setMoveMode] = useState(false);
  const [activeKey, setActiveKey] = useState<ElementKey | null>(null);
  const [selectedKey, setSelectedKey] = useState<ElementKey | null>(null);
  const articleRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  // Reference art splits the headline into an ink first line and a green
  // accent phrase. Custom titles without the accent keyword stay single-tone.
  const renderTitle = () => {
    const copy = title || defaults.title;
    const idx = copy.toLowerCase().indexOf(defaults.titleAccent.toLowerCase());
    if (!defaults.titleAccent || idx === -1) return copy;
    return (
      <>
        <span className="block" style={{ color: BRAND_INK }}>{copy.slice(0, idx)}</span>
        <span className="block" style={{ color: BRAND_GREEN }}>{copy.slice(idx)}</span>
      </>
    );
  };

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
        style={{ backgroundColor: '#f2f9ef', containerType: 'inline-size' }}
      >
        <PosterBackdrop />

        <div className="relative z-10 flex h-full flex-col items-center px-[7cqw] pb-[5cqw] pt-[9cqw]">
          <h3
            data-testid="poster-title"
            className={moveableClass('title', 'max-w-[96%] text-center font-extrabold leading-[1.02]')}
            style={moveableStyle('title', { color: BRAND_INK, fontSize: 'clamp(1.6rem, 8.4cqw, 3.2rem)', overflowWrap: 'anywhere', letterSpacing: '-0.02em' })}
            onPointerDown={moveMode ? (event) => startDrag('title', event) : undefined}
            onPointerMove={moveMode ? (event) => moveDrag('title', event) : undefined}
            onPointerUp={moveMode ? (event) => endDrag('title', event) : undefined}
            onPointerCancel={moveMode ? (event) => endDrag('title', event) : undefined}
          >
            {renderTitle()}
          </h3>

          <div
            className={moveableClass('subtitle', 'mt-[2.4cqw] flex max-w-[94%] items-center justify-center gap-[2.4cqw]')}
            style={moveableStyle('subtitle')}
            onPointerDown={moveMode ? (event) => startDrag('subtitle', event) : undefined}
            onPointerMove={moveMode ? (event) => moveDrag('subtitle', event) : undefined}
            onPointerUp={moveMode ? (event) => endDrag('subtitle', event) : undefined}
            onPointerCancel={moveMode ? (event) => endDrag('subtitle', event) : undefined}
          >
            <AccentChevrons side="left" tone={BRAND_GREEN} />
            <span className="text-center leading-[1.25] text-slate-500" style={{ fontSize: 'clamp(0.7rem, 3.3cqw, 1.05rem)' }}>
              {subtitle || defaults.subtitle}
            </span>
            <AccentChevrons side="right" tone={BRAND_GREEN} />
          </div>

          <ol
            className={moveableClass('steps', 'mt-[5.5cqw] flex w-full items-stretch justify-center gap-[1cqw]')}
            style={moveableStyle('steps')}
            onPointerDown={moveMode ? (event) => startDrag('steps', event) : undefined}
            onPointerMove={moveMode ? (event) => moveDrag('steps', event) : undefined}
            onPointerUp={moveMode ? (event) => endDrag('steps', event) : undefined}
            onPointerCancel={moveMode ? (event) => endDrag('steps', event) : undefined}
          >
            {steps.map((step, index) => (
              <Fragment key={index}>
                {index > 0 ? (
                  <li className="flex shrink-0 items-center" aria-hidden="true">
                    <StepArrow />
                  </li>
                ) : null}
                <li
                  className="flex min-w-0 flex-1 flex-col items-center gap-[1.4cqw] rounded-[3cqw] bg-white px-[1.6cqw] py-[2.4cqw] text-center"
                  style={{ boxShadow: '0 1.4cqw 3cqw rgba(20,60,20,0.12)', border: '0.2cqw solid #ffffff' }}
                >
                  <span className="flex w-full items-center justify-center gap-[1.2cqw]">
                    <span
                      className="grid h-[4.4cqw] w-[4.4cqw] shrink-0 place-items-center rounded-full font-bold text-white"
                      style={{ background: `linear-gradient(145deg, ${BRAND_GREEN} 0%, ${BRAND_GREEN_DEEP} 100%)`, fontSize: '2.4cqw' }}
                    >
                      {index + 1}
                    </span>
                    <span
                      className="grid h-[7.4cqw] w-[7.4cqw] shrink-0 place-items-center rounded-full"
                      style={{ backgroundColor: BRAND_GREEN_SOFT }}
                    >
                      <StepIcon kind={index as 0 | 1 | 2} />
                    </span>
                  </span>
                  <span
                    className="min-w-0 font-bold leading-[1.15]"
                    style={{ color: BRAND_INK, fontSize: '2.7cqw', overflowWrap: 'anywhere' }}
                  >
                    {step || defaults.steps[index]}
                  </span>
                </li>
              </Fragment>
            ))}
          </ol>

          <div
            className={moveableClass('qr', 'relative mt-[6cqw] flex w-full flex-col items-center')}
            style={moveableStyle('qr')}
            onPointerDown={moveMode ? (event) => startDrag('qr', event) : undefined}
            onPointerMove={moveMode ? (event) => moveDrag('qr', event) : undefined}
            onPointerUp={moveMode ? (event) => endDrag('qr', event) : undefined}
            onPointerCancel={moveMode ? (event) => endDrag('qr', event) : undefined}
          >
            <div
              className="relative grid aspect-square w-[42cqw] shrink-0 place-items-center rounded-[3.4cqw] bg-white p-[3.2cqw]"
              style={{
                border: `0.35cqw dashed ${BRAND_GREEN}`,
                boxShadow: '0 1.8cqw 4cqw rgba(20,60,20,0.16)',
                backgroundColor: '#ffffff',
              }}
            >
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
            <div className="mt-[2.6cqw] flex items-center justify-center gap-[1.6cqw]">
              <AccentChevrons side="left" tone={BRAND_GREEN} />
              <p className="text-center font-bold leading-[1.15]" style={{ color: BRAND_GREEN_DEEP, fontSize: '3.4cqw' }}>
                {qrCaption || defaults.qrCaption}
              </p>
              <AccentChevrons side="right" tone={BRAND_GREEN} />
            </div>
          </div>

          {/* Fixed decorative gift boxes pinned to the composition, behind the interactive layer. */}
          <GiftPair />

          <div
            className={moveableClass('gifts', 'pointer-events-none absolute inset-0')}
            style={moveableStyle('gifts')}
            aria-hidden="true"
            onPointerDown={moveMode ? (event) => startDrag('gifts', event) : undefined}
            onPointerMove={moveMode ? (event) => moveDrag('gifts', event) : undefined}
            onPointerUp={moveMode ? (event) => endDrag('gifts', event) : undefined}
            onPointerCancel={moveMode ? (event) => endDrag('gifts', event) : undefined}
          />

          <span
            className={moveableClass('logo', 'absolute bottom-[7cqw] left-[6cqw] max-w-[36cqw] select-none font-semibold italic')}
            style={{
              ...moveableStyle('logo', { color: '#ffffff', fontSize: '4cqw' }),
              transform: `${moveableStyle('logo').transform} rotate(-7deg)`,
              textShadow: '0 0.2cqw 0.6cqw rgba(15,50,15,0.35)',
            }}
            data-testid="poster-slogan"
          >
            {t.poster.posterSlogan}
          </span>

          <div
            className={moveableClass('logo', 'absolute bottom-[5cqw] right-[5cqw] flex flex-row items-center gap-[4cqw]')}
            style={moveableStyle('logo')}
            data-testid="poster-logo"
            onPointerDown={moveMode ? (event) => startDrag('logo', event) : undefined}
            onPointerMove={moveMode ? (event) => moveDrag('logo', event) : undefined}
            onPointerUp={moveMode ? (event) => endDrag('logo', event) : undefined}
            onPointerCancel={moveMode ? (event) => endDrag('logo', event) : undefined}
          >
            <span className="font-semibold text-white/90" style={{ fontSize: '3.4cqw' }}>
              Powered by
            </span>
            <DawerLogo
              alt={t.poster.logoAlt}
              tone="white"
              draggable={false}
              className="block h-[4.2cqw] w-auto object-contain drop-shadow-[0_0.2cqw_0.4cqw_rgba(20,60,20,0.25)]"
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
  const [positions, setPositions] = useState<ElementPositions>({});
  const [elementScales, setElementScales] = useState<ElementScales>({});
  const [scale, setScale] = useState(1);
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
    setPositions(positionsFromPoster(loadedPoster ?? null));
    setElementScales(elementScalesFromPoster(loadedPoster ?? null));
    setScale(scaleFromPoster(loadedPoster ?? null));
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
      const configuration = {
        brandName,
        steps: steps.map((step, index) => step ?? defaults.steps[index]),
        qrCaption: qrCaption ?? defaults.qrCaption,
        positions,
        scale,
        elementScales,
      };
      const resolvedTitle = title ?? defaults.title;
      const resolvedSubtitle = subtitle ?? defaults.subtitle;
      const saved = poster
        ? await PosterService.update(poster.id, { title: resolvedTitle, subtitle: resolvedSubtitle, configuration })
        : await PosterService.create({ campaignId, title: resolvedTitle, subtitle: resolvedSubtitle, configuration });
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
          qrDataUrl={qrDataUrl}
          qrError={qrError}
          campaignUrl={campaignUrl}
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
