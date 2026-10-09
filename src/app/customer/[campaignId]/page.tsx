"use client";

import { Link, useParams } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { AlertTriangle, Copy, Dices, Gift, Loader2, MapPin, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useT } from '@/hooks/use-t';
import { cn } from '@/lib/cn';
import { deviceHashFor } from '@/lib/device-fingerprint';
import { interpolate, msg } from '@/lib/i18n';
import { getGoogleReviewUrl } from '@/lib/google-maps';
import {
  DEFAULT_WHEEL_THEME,
  segmentColorAt,
  wheelMotionDurationMs,
} from '@/lib/wheel-theme';
import { PrizeWheel } from '@/components/wheel/prize-wheel';
import {
  PublicCampaignService,
  type ParticipationResult,
  type PublicCampaign,
  type PublicReward,
} from '@/services/public-campaign.service';

const CONFETTI_COLORS = ['#f43f5e', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#06b6d4', '#facc15'];

/** Muted palette for the "Prochaine fois" no-win screen. */
const NO_WIN_CONFETTI_COLORS = ['#cbd5e1', '#94a3b8', '#64748b', '#a5b4fc', '#e2e8f0', '#93c5fd'];

interface ActionCopy {
  label: string;
  step: string;
  cta: string;
}

type Step = 'gate' | 'game' | 'result';

/**
 * `opened` → the action tab is out there, `returned` → the visitor came back
 * and the short countdown is running, `unlocking` → the claim is being sent.
 */
type GateStage = 'idle' | 'opened' | 'returned' | 'unlocking' | 'failed';

/**
 * Live in an object so tests can tighten the timings without fake timers.
 */
export const gateTimings = {
  /** Seconds counted down after the visitor returns, before the wheel opens. */
  unlockDelaySeconds: 3,
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function createUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

/**
 * The visitor id has to survive a fresh tab: a QR scan often opens one, and a
 * per-session id would hand every scan a brand new identity. localStorage is
 * the stickiest thing available without a server-side login.
 */
function anonymousIdFor(publicCode: string): string {
  const storageKey = `cf_anon_${publicCode}`;

  try {
    const sticky = window.localStorage.getItem(storageKey);
    const legacy = window.sessionStorage.getItem(storageKey);
    const existing = sticky ?? legacy;

    if (existing) {
      if (!sticky) window.localStorage.setItem(storageKey, existing);
      return existing;
    }

    const created = createUuid();
    window.localStorage.setItem(storageKey, created);
    return created;
  } catch {
    return createUuid();
  }
}

function playedStorageKey(publicCode: string): string {
  return `cf_spun_${publicCode}`;
}

function hasPlayed(publicCode: string): boolean {
  try {
    return window.localStorage.getItem(playedStorageKey(publicCode)) === '1';
  } catch {
    return false;
  }
}

function markPlayed(publicCode: string): void {
  try {
    window.localStorage.setItem(playedStorageKey(publicCode), '1');
  } catch {
    // Storage unavailable — the server side claim still blocks a second spin.
  }
}

/**
 * Windowed campaigns allow repeat plays, so the local "already played" flag
 * must not lock the visitor out — the server decides when they may spin again.
 */
function isWindowedCampaign(campaign: PublicCampaign): boolean {
  if (!campaign.play_rules) return false;

  try {
    return (JSON.parse(campaign.play_rules) as { mode?: string } | null)?.mode === 'windowed';
  } catch {
    return false;
  }
}

type GeoCoords = { latitude: number; longitude: number };

/**
 * Best-effort browser position for the P2-7 proximity signal. Resolves to
 * null on denial, timeout or unsupported devices — the spin proceeds either
 * way, the signal is soft.
 */
function requestCoords(timeoutMs: number): Promise<GeoCoords | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 300_000 },
    );
  });
}

/** Never let the permission prompt stall the spin past a short deadline. */
function withDeadline<T>(promise: Promise<T | null>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => window.setTimeout(() => resolve(null), ms)),
  ]);
}

function GoogleWordmark() {
  const t = useT();
  const letters: Array<[string, string]> = [
    ['G', '#4285F4'],
    ['o', '#EA4335'],
    ['o', '#FBBC05'],
    ['g', '#4285F4'],
    ['l', '#34A853'],
    ['e', '#EA4335'],
  ];

  return (
    <div className="flex flex-col items-center">
      <p className="text-2xl font-bold tracking-tight" role="img" aria-label="Google Reviews">
        {letters.map(([letter, color], index) => (
          <span key={`${letter}-${index}`} style={{ color }}>
            {letter}
          </span>
        ))}
        <span className="text-ink"> Reviews</span>
      </p>
      <p className="mt-0.5 text-sm tracking-[0.2em] text-amber-400" aria-label={t.customer.ratedFive}>
        ★★★★★
      </p>
    </div>
  );
}

export default function CampaignCustomerPage() {
  const { campaignId = '' } = useParams<{ campaignId: string }>();
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [campaign, setCampaign] = useState<PublicCampaign | null>(null);
  const [rewards, setRewards] = useState<PublicReward[]>([]);
  const [step, setStep] = useState<Step>('gate');
  const [gateStage, setGateStage] = useState<GateStage>('idle');
  const [countdown, setCountdown] = useState(0);
  const [confirmedAction, setConfirmedAction] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);
  const unlockingRef = useRef(false);
  const leftPageRef = useRef(false);
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [spinError, setSpinError] = useState<string | null>(null);
  const [result, setResult] = useState<ParticipationResult | null>(null);
  const [couponCode, setCouponCode] = useState('');
  const [copyMessage, setCopyMessage] = useState('');
  const [winner, setWinner] = useState({ fullName: '', email: '', phone: '' });
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [detailsSending, setDetailsSending] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [detailsSent, setDetailsSent] = useState(false);
  const [alreadyPlayed, setAlreadyPlayed] = useState(false);
  // One in-flight geolocation request for the campaign, started non-blocking
  // as soon as the page knows the campaign has a location (P2-7).
  const locationRequestRef = useRef<Promise<GeoCoords | null> | null>(null);

  useEffect(() => {
    if (!campaign || campaign.latitude == null || campaign.longitude == null) return;
    locationRequestRef.current ??= requestCoords(8_000);
  }, [campaign]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    PublicCampaignService.load(campaignId)
      .then((loaded) => {
        if (cancelled) return;
        if (!loaded) {
          setLoadError(t.customer.unavailable);
          return;
        }
        setCampaign(loaded.campaign);
        setRewards(loaded.rewards);
        setAlreadyPlayed(!isWindowedCampaign(loaded.campaign) && hasPlayed(loaded.campaign.public_code));
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(msg(t, error instanceof Error ? error.message : 'Unable to load this campaign.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [campaignId, t]);

  useEffect(() => {
    if (!campaign) return;
    const previous = document.title;
    document.title = campaign.name ? `${campaign.name} · Dawer` : previous;
    return () => {
      document.title = previous;
    };
  }, [campaign]);

  // The payload already carries the resolved design (plan gate + operator
  // override applied server-side); fall back to the shipped default.
  const wheelTheme = campaign?.wheel_theme ?? DEFAULT_WHEEL_THEME;

  const segments = useMemo(() => {
    const weights = rewards.map((reward) =>
      Number.isFinite(Number(reward.weight)) ? Number(reward.weight) : 0,
    );
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    // An all-zero wheel cannot be spun: fall through to the "no prizes"
    // empty state instead of rendering 0% slices.
    if (total <= 0) return [];
    return rewards.map((reward, index) => ({
      id: reward.id,
      label: reward.name,
      // True odds: the backend spreads the spin over the prizes entered,
      // so display weight relative to their total, not the raw weight.
      percent: Math.round(((weights[index] ?? 0) * 100) / total),
      color: segmentColorAt(index, wheelTheme.colors.segments),
      angle: ((index + 0.5) * 360) / Math.max(rewards.length, 1),
    }));
  }, [rewards, wheelTheme]);

  const gradient = useMemo(() => {
    if (!segments.length) return 'conic-gradient(#e2e8f0 0deg 360deg)';
    const stepSize = 360 / segments.length;
    return `conic-gradient(${segments
      .map((segment, index) => `${segment.color} ${index * stepSize}deg ${(index + 1) * stepSize}deg`)
      .join(', ')})`;
  }, [segments]);

  // A `none` reward means the visitor landed on the "Prochaine fois" slice.
  const isPrize = (result?.reward.type ?? 'custom_reward') !== 'none';

  const confetti = useMemo(() => {
    const palette = isPrize ? CONFETTI_COLORS : NO_WIN_CONFETTI_COLORS;

    return Array.from({ length: 36 }, (_, index) => ({
      id: index,
      left: (index * 37) % 100,
      color: palette[index % palette.length] ?? '#94a3b8',
      size: 6 + (index % 4) * 3,
      duration: 4 + (index % 5),
      delay: (index % 7) * 0.6,
      round: index % 3 === 0,
    }));
  }, [isPrize]);

  const ACTION_COPY: Record<string, ActionCopy> = {
    GOOGLE_REVIEW: {
      label: t.customer.actionGoogleReviewLabel,
      step: t.customer.actionGoogleReviewStep,
      cta: t.customer.actionGoogleReviewCta,
    },
    INSTAGRAM: {
      label: t.customer.actionInstagramLabel,
      step: t.customer.actionInstagramStep,
      cta: t.customer.actionInstagramCta,
    },
    FACEBOOK: {
      label: t.customer.actionFacebookLabel,
      step: t.customer.actionFacebookStep,
      cta: t.customer.actionFacebookCta,
    },
    NEWSLETTER: {
      label: t.customer.actionNewsletterLabel,
      step: t.customer.actionNewsletterStep,
      cta: t.customer.actionNewsletterCta,
    },
    PURCHASE: {
      label: t.customer.actionPurchaseLabel,
      step: t.customer.actionPurchaseStep,
      cta: t.customer.actionPurchaseCta,
    },
    NONE: { label: '', step: '', cta: t.customer.actionNoneCta },
  };

  const DEFAULT_ACTION_COPY: ActionCopy = ACTION_COPY.NONE ?? { label: '', step: '', cta: t.customer.actionNoneCta };

  const requireAction = campaign?.require_action ?? 'NONE';
  const actionCopy = ACTION_COPY[requireAction] ?? DEFAULT_ACTION_COPY;
  const isNoAction = requireAction === 'NONE';
  const isGoogleReview = requireAction === 'GOOGLE_REVIEW';
  const gateSteps = isNoAction
    ? [t.customer.stepSpin, t.customer.stepWin]
    : [actionCopy.step, t.customer.stepSpin, t.customer.stepWin];

  const actionUrl = useMemo(() => {
    if (!campaign || isNoAction) return null;

    if (campaign.require_action === 'GOOGLE_REVIEW') {
      return getGoogleReviewUrl(
        campaign.google_maps_url || campaign.google_maps_name || campaign.business_name || '',
        campaign.google_place_id || undefined,
      );
    }
    if (campaign.require_action === 'INSTAGRAM' && campaign.instagram_url) return campaign.instagram_url;
    if (campaign.require_action === 'FACEBOOK' && campaign.facebook_url) return campaign.facebook_url;

    return null;
  }, [campaign, isNoAction]);

  const canSubmitDetails = useMemo(
    () =>
      Boolean(
        winner.fullName.trim() &&
        (!winner.email.trim() || EMAIL_PATTERN.test(winner.email.trim())) &&
        winner.phone.trim().length >= 6,
      ),
    [winner],
  );

  const unlockWheel = useCallback(async () => {
    if (unlockingRef.current || !campaign || isNoAction) return;

    unlockingRef.current = true;
    setGateStage('unlocking');
    setGateError(null);

    try {
      await PublicCampaignService.recordAction(campaign.public_code, {
        anonymousId: anonymousIdFor(campaign.public_code),
        deviceHash: deviceHashFor(),
        action: campaign.require_action ?? 'NONE',
      });
      setStep('game');
    } catch (error: unknown) {
      unlockingRef.current = false;
      setGateStage('failed');
      setGateError(msg(t, error instanceof Error ? error.message : 'Unable to unlock the wheel.'));
    }
  }, [campaign, isNoAction, t]);

  const beginUnlock = useCallback(() => {
    setGateStage((current) =>
      current === 'idle' || current === 'opened' || current === 'failed' ? 'returned' : current,
    );
    setCountdown(gateTimings.unlockDelaySeconds);
  }, []);

  // The visitor left for the action tab and is expected to come back to us.
  useEffect(() => {
    if (gateStage !== 'opened') return;

    leftPageRef.current = false;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        leftPageRef.current = true;
        return;
      }
      if (leftPageRef.current) beginUnlock();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [gateStage, beginUnlock]);

  useEffect(() => {
    if (gateStage !== 'returned') return;

    const ticker = window.setInterval(() => setCountdown((value) => Math.max(value - 1, 0)), 1000);
    const unlockTimer = window.setTimeout(() => void unlockWheel(), gateTimings.unlockDelaySeconds * 1000);

    return () => {
      window.clearInterval(ticker);
      window.clearTimeout(unlockTimer);
    };
  }, [gateStage, unlockWheel]);

  const handleActionClick = () => {
    if (unlockingRef.current || gateStage !== 'idle') return;

    setGateError(null);
    setGateStage('opened');
  };

  const handleConfirmToggle = (event: ChangeEvent<HTMLInputElement>) => {
    const checked = event.target.checked;
    setConfirmedAction(checked);
    setGateError(null);

    if (checked) {
      beginUnlock();
      return;
    }

    unlockingRef.current = false;
    setGateStage('idle');
    setCountdown(0);
  };

  const handleRetry = () => {
    setGateError(null);
    void unlockWheel();
  };

  const handleNoActionClick = () => setStep('game');

  const handleSpin = async () => {
    if (spinning || !campaign || result) return;

    setSpinning(true);
    setSpinError(null);

    try {
      const wantsLocation = campaign.latitude != null && campaign.longitude != null;
      const coords = wantsLocation
        ? await withDeadline(locationRequestRef.current ?? requestCoords(2_000), 1_500)
        : null;

      const participation = await PublicCampaignService.participate(campaign.public_code, {
        anonymousId: anonymousIdFor(campaign.public_code),
        deviceHash: deviceHashFor(),
        ...(coords ? { latitude: coords.latitude, longitude: coords.longitude } : {}),
      });
      markPlayed(campaign.public_code);

      const winningIndex = Math.max(0, segments.findIndex((segment) => segment.id === participation.reward.id));
      const segmentAngle = 360 / Math.max(segments.length, 1);
      const target = winningIndex * segmentAngle + segmentAngle / 2;
      const desired = ((-target % 360) + 360) % 360;
      const current = ((rotation % 360) + 360) % 360;
      const delta = ((desired - current) % 360 + 360) % 360;
      setRotation(rotation + 2160 + delta);

      window.setTimeout(() => {
        setResult(participation);
        setCouponCode(participation.couponCode);
        setSpinning(false);
        setStep('result');
      }, wheelMotionDurationMs(wheelTheme));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unable to spin right now.';
      setSpinning(false);

      // The visitor already holds the claim for this campaign — show them the
      // same card they get on arrival instead of an error on the wheel.
      if (message.toLowerCase().includes('already participated')) {
        markPlayed(campaign.public_code);
        setAlreadyPlayed(true);
        setStep('gate');
        return;
      }

      setSpinError(msg(t, message));
    }
  };

  const submitDetails = async () => {
    if (!campaign || !result || detailsSending || !canSubmitDetails) return;

    setDetailsSending(true);
    setDetailsError(null);

    const [firstName = '', ...rest] = winner.fullName.trim().split(/\s+/);

    try {
      const code = await PublicCampaignService.submitCustomerDetails(
        campaign.public_code,
        result.participationId,
        {
          firstName,
          lastName: rest.join(' '),
          email: winner.email.trim(),
          phone: winner.phone.trim(),
          marketingConsent,
        },
      );
      setCouponCode(code || result.couponCode);
      setDetailsSent(true);
    } catch (error: unknown) {
      setDetailsError(msg(t, error instanceof Error ? error.message : 'Unable to save your details.'));
    } finally {
      setDetailsSending(false);
    }
  };

  const copyCode = async () => {
    if (!couponCode) return;
    try {
      await navigator.clipboard.writeText(couponCode);
      setCopyMessage(t.customer.codeCopied);
    } catch {
      setCopyMessage(t.customer.copyManually);
    }
    window.setTimeout(() => setCopyMessage(''), 2500);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface text-ink-muted">
        <Loader2 className="mr-2 h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden />
        {t.customer.loading}
      </div>
    );
  }

  if (loadError || !campaign) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface p-6 text-ink">
        <div className="w-full max-w-sm rounded-2xl border border-line bg-card p-6 text-center shadow-card">
          <AlertTriangle className="mx-auto h-9 w-9 text-warning-500" aria-hidden />
          <h1 className="mt-4 text-xl font-semibold">{t.customer.campaignUnavailable}</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            {loadError ?? t.customer.unavailable}
          </p>
        </div>
      </div>
    );
  }

  const merchantName = campaign.business_name ?? t.customer.merchant;
  const locationLabel = campaign.google_maps_name || merchantName;

  return (
    <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(120%_85%_at_50%_-15%,rgb(var(--accent-soft))_0%,rgb(var(--surface))_45%,rgb(var(--surface-2))_100%)] text-ink">
      {step === 'gate' && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 h-[540px] w-[540px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-30 blur-3xl"
          style={{ background: gradient }}
        />
      )}

      {step === 'result' && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          {confetti.map((piece) => (
            <span
              key={piece.id}
              className="cf-confetti-piece"
              style={{
                left: `${piece.left}%`,
                width: piece.size,
                height: piece.round ? piece.size : piece.size * 1.6,
                backgroundColor: piece.color,
                borderRadius: piece.round ? '9999px' : '2px',
                animationDuration: `${piece.duration}s`,
                animationDelay: `${piece.delay}s`,
              }}
            />
          ))}
        </div>
      )}

      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-4 py-10">
        <main className="w-full max-w-md">
          <h1 className="sr-only">{campaign.name}</h1>

          <div className="flex flex-col items-center">
            {campaign.business_logo ? (
              <img
                src={campaign.business_logo}
                alt={merchantName}
                className="h-48 w-48 rounded-2xl object-cover shadow-soft ring-1 ring-line"
              />
            ) : (
              <div className="flex h-48 w-48 items-center justify-center rounded-2xl bg-brand-500 text-5xl font-bold text-accent-ink shadow-soft">
                {merchantName.charAt(0).toUpperCase()}
              </div>
            )}
            <p className="mt-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-subtle">
              {merchantName}
            </p>
          </div>

          {step === 'gate' && (
            <div className="mt-6">
              {alreadyPlayed ? (
                <Card className="p-6 text-center">
                  <CardContent className="p-0">
                    <p className="text-4xl" aria-hidden="true">
                      🎁
                    </p>
                    <h2 className="mt-3 text-xl font-semibold">{t.customer.alreadyPlayedTitle}</h2>
                    <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                      {interpolate(t.customer.alreadyPlayedBody, { merchant: merchantName })}
                    </p>
                    <p className="mt-4 text-xs text-ink-subtle">{t.customer.thanksForScanning}</p>
                  </CardContent>
                </Card>
              ) : (
                <Card className="p-6">
                  <CardContent className="p-0">
                    <p className="text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-600 dark:text-accent-bright">
                      {t.customer.howItWorks}
                    </p>

                    <ol className="mt-5 flex flex-col gap-2.5">
                      {gateSteps.map((label, index) => (
                        <li
                          key={label}
                          className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/70 p-3"
                        >
                          <span className="numeric flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-500 text-[13px] font-semibold text-accent-ink">
                            {index + 1}
                          </span>
                          <span className="text-sm font-medium text-ink">{label}</span>
                        </li>
                      ))}
                    </ol>

                    {isGoogleReview && (
                      <div className="mt-5 flex justify-center">
                        <GoogleWordmark />
                      </div>
                    )}

                    {!isNoAction && (
                      <p className="mt-4 text-center text-xs leading-relaxed text-ink-subtle">
                        {actionUrl ? t.customer.gateNewTabHint : t.customer.gateLocalHint}
                      </p>
                    )}

                    {isNoAction && (
                      <Button size="lg" className="mt-5 w-full" onClick={handleNoActionClick}>
                        <Dices className="h-4 w-4" aria-hidden />
                        {t.customer.spinCta}
                      </Button>
                    )}

                    {actionUrl && gateStage === 'idle' && (
                      <Button asChild size="lg" className="mt-5 w-full">
                        <a
                          href={actionUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={handleActionClick}
                        >
                          <Star className="h-4 w-4" aria-hidden />
                          {actionCopy.cta} ›
                        </a>
                      </Button>
                    )}

                    {actionUrl && gateStage === 'opened' && (
                      <Button
                        variant="outline"
                        size="lg"
                        className="mt-5 w-full"
                        onClick={beginUnlock}
                      >
                        {t.customer.continueToWheel}›
                      </Button>
                    )}

                    {!isNoAction && !actionUrl && (
                      <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface-2/70 p-4 transition-colors duration-180 ease-swift hover:border-accent/45">
                        <input
                          type="checkbox"
                          checked={confirmedAction}
                          onChange={handleConfirmToggle}
                          className="mt-0.5 h-5 w-5 shrink-0 rounded border-line-strong accent-brand-500"
                        />
                        <span className="text-sm font-medium text-ink">{t.customer.completedStep}</span>
                      </label>
                    )}

                    {gateStage === 'opened' && (
                      <p className="mt-4 flex items-center justify-center gap-2 text-center text-xs text-ink-subtle">
                        <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
                        {t.customer.waitingReturn}
                      </p>
                    )}

                    {gateStage === 'returned' && (
                      <p className="mt-4 text-center text-xs font-semibold text-brand-700 dark:text-accent-bright">
                        {interpolate(t.customer.thanksOpening, { count: countdown })}
                      </p>
                    )}

                    {gateStage === 'unlocking' && (
                      <p className="mt-4 flex items-center justify-center gap-2 text-center text-xs text-ink-subtle">
                        <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
                        {t.customer.unlocking}
                      </p>
                    )}

                    {gateError && (
                      <div className="mt-4 rounded-xl border border-danger-300/60 bg-danger-50 p-3 text-sm text-danger-800 dark:border-danger-900/60 dark:bg-danger-900/30 dark:text-danger-200">
                        {gateError}
                      </div>
                    )}

                    {gateStage === 'failed' && (
                      <Button
                        variant="outline"
                        size="lg"
                        className="mt-3 w-full border-danger-300 text-danger-700 hover:bg-danger-50 dark:border-danger-800 dark:text-danger-300 dark:hover:bg-danger-900/30"
                        onClick={handleRetry}
                      >
                        {t.customer.tryAgain} ›
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )}

              <div className="mt-4 rounded-2xl border border-line bg-card/85 p-4 backdrop-blur-sm">
                <div className="flex items-center gap-2 text-sm text-ink-muted">
                  <MapPin className="h-4 w-4 shrink-0 text-brand-600 dark:text-accent-bright" aria-hidden />
                  <span className="truncate">{locationLabel}</span>
                </div>

                {rewards.length > 0 && (
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {rewards.map((reward, index) => (
                      <li
                        key={reward.id}
                        className="flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink ring-1 ring-line"
                      >
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: segmentColorAt(index, wheelTheme.colors.segments) }}
                        />
                        {reward.name}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {step === 'game' && (
            <div className="mt-6">
              <h1 className="text-center text-[32px] font-semibold leading-tight tracking-[-0.03em] text-brand-700 dark:text-accent-bright">
                {t.customer.spinHeading} <span aria-hidden="true">🎉</span>
              </h1>
              <p className="mt-2 text-center text-sm text-ink-muted">
                {t.customer.gameSubtitle}
              </p>

              {segments.length === 0 && (
                <p className="mt-3 text-center text-sm font-medium text-danger-600 dark:text-danger-300">
                  {t.customer.noPrizes}
                </p>
              )}

              <div className="mt-6 flex justify-center">
                <PrizeWheel
                  segments={segments}
                  rotation={rotation}
                  spinning={spinning}
                  testId="prize-wheel"
                  theme={wheelTheme}
                  centerLogoSrc={wheelTheme.centerLogo ? (campaign?.wheel_logo ?? null) : null}
                  centerLogoAlt={campaign?.business_name ?? ''}
                  wrapperClassName="cf-wheel-float w-[min(90vw,380px,58vh)]"
                  shadowClassName="shadow-[0_20px_50px_rgba(77,120,45,0.28)]"
                />
              </div>

              {spinError && (
                <div className="mt-4 rounded-xl border border-danger-300/60 bg-danger-50 p-3 text-sm text-danger-800 dark:border-danger-900/60 dark:bg-danger-900/30 dark:text-danger-200">
                  {spinError}
                </div>
              )}

              <Button
                size="lg"
                className="mt-6 w-full"
                disabled={spinning || segments.length === 0}
                onClick={() => void handleSpin()}
                loading={spinning}
              >
                <Dices className="h-4 w-4" aria-hidden />
                {spinning ? t.customer.spinning : t.customer.spinButton}
              </Button>
            </div>
          )}

          {step === 'result' && result && (
            <Card className={cn('mt-6 p-6', !isPrize && 'cf-no-win-card')}>
              <CardContent className="p-0">
                <p className={cn('text-center text-4xl', !isPrize && 'cf-no-win-emoji')} aria-hidden="true">
                  {isPrize ? '🎉' : '🍀'}
                </p>
                <h2 className="mt-3 text-center text-[26px] font-semibold tracking-[-0.03em]">
                  {isPrize ? t.customer.winTitle : t.customer.noWinTitle}
                </h2>
                <p className="mt-1 text-center text-sm text-ink-subtle">
                  {isPrize ? t.customer.winBody : t.customer.landedOn}
                </p>

                <div
                  className={cn(
                    'mt-4 rounded-xl border px-4 py-3 text-center text-lg font-bold',
                    isPrize
                      ? 'border-brand-200 bg-brand-50 text-brand-800 dark:border-brand-700 dark:bg-brand-900/40 dark:text-brand-200'
                      : 'border-dashed border-line-strong bg-surface-2 text-ink-muted',
                  )}
                >
                  {result.reward.name}
                  {isPrize && <span aria-hidden="true"> 🔥</span>}
                </div>

                {result.reward.description && (
                  <p className="mt-2 text-center text-sm text-ink-subtle">{result.reward.description}</p>
                )}

                {!isPrize && (
                  <p className="mt-4 rounded-xl border border-line bg-surface-2 p-4 text-center text-sm leading-relaxed text-ink-muted">
                    Come back another day for a fresh spin and a new chance to win!
                  </p>
                )}

                {isPrize && !detailsSent && (
                  <>
                    <div className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-accent-soft px-4 py-3 text-center text-sm font-medium text-brand-800 dark:text-accent-bright">
                      <Gift className="h-4 w-4 shrink-0" aria-hidden />
                      {t.customer.detailsCta}
                    </div>

                    <div className="mt-4 flex flex-col gap-3">
                      <Field label={t.customer.fullNameLabel} htmlFor="winner-name" required>
                        <Input
                          id="winner-name"
                          value={winner.fullName}
                          onChange={(event) => setWinner({ ...winner, fullName: event.target.value })}
                          placeholder="Jean Dupont"
                        />
                      </Field>

                      <Field label={t.customer.emailOptionalLabel} htmlFor="winner-email">
                        <Input
                          id="winner-email"
                          type="email"
                          value={winner.email}
                          onChange={(event) => setWinner({ ...winner, email: event.target.value })}
                          placeholder="jean.dupont@email.com"
                        />
                      </Field>

                      <Field label={t.customer.phoneLabel} htmlFor="winner-phone" required>
                        <Input
                          id="winner-phone"
                          type="tel"
                          value={winner.phone}
                          onChange={(event) => setWinner({ ...winner, phone: event.target.value })}
                          placeholder="+216 12 345 678"
                        />
                      </Field>

                      <label
                        htmlFor="marketing-consent"
                        className="flex items-start gap-2.5 text-xs leading-5 text-ink-muted"
                      >
                        <input
                          id="marketing-consent"
                          type="checkbox"
                          checked={marketingConsent}
                          onChange={(event) => setMarketingConsent(event.target.checked)}
                          className="mt-1 h-4 w-4 shrink-0 accent-brand-500"
                        />
                        <span>
                          {t.customer.marketingConsent}{' '}
                          <Link
                            to="/privacy"
                            className="font-medium text-brand-700 underline underline-offset-2 dark:text-accent-bright"
                          >
                            Politique de confidentialité
                          </Link>
                        </span>
                      </label>

                      {detailsError && (
                        <p className="rounded-lg border border-danger-300/60 bg-danger-50 p-2.5 text-xs font-medium text-danger-800 dark:border-danger-900/60 dark:bg-danger-900/30 dark:text-danger-200">
                          {detailsError}
                        </p>
                      )}

                      <Button
                        size="lg"
                        className="w-full"
                        onClick={() => void submitDetails()}
                        disabled={!canSubmitDetails || detailsSending}
                        loading={detailsSending}
                      >
                        <Gift className="h-4 w-4" aria-hidden />
                        {detailsSending ? t.customer.sending : t.customer.receiveGift}
                      </Button>
                    </div>
                  </>
                )}

                {isPrize && detailsSent && (
                  <div className="mt-4 rounded-xl border border-line bg-surface-2 p-4">
                    <p className="text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-subtle">
                      {t.customer.yourCode}
                    </p>
                    <p className="numeric mt-2 text-center text-2xl font-bold tracking-[0.2em]">{couponCode}</p>
                    <Button variant="outline" className="mt-3 w-full" onClick={() => void copyCode()}>
                      <Copy className="h-4 w-4" aria-hidden />
                      {t.customer.copyCode}
                    </Button>
                    {copyMessage && (
                      <p className="mt-2 text-center text-xs font-medium text-success-700 dark:text-success-300">
                        {copyMessage}
                      </p>
                    )}
                  </div>
                )}

                <div className="mt-5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-ink-subtle">
                  <span className="font-medium text-ink-muted">{merchantName}</span>
                  <span aria-hidden="true">·</span>
                  <span>{locationLabel}</span>
                </div>
              </CardContent>
            </Card>
          )}
        </main>

        <p className="mt-8 text-xs text-ink-subtle">Powered by Dawer</p>
      </div>
    </div>
  );
}