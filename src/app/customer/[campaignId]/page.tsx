"use client";

import { useParams } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Copy, Gift, Loader2, MapPin, Trophy, X } from 'lucide-react';
import { getGoogleMapsUrl } from '@/lib/google-maps';
import {
  PublicCampaignService,
  type ParticipationResult,
  type PublicCampaign,
  type PublicReward,
} from '@/services/public-campaign.service';

const SEGMENT_COLORS = ['#f59e0b', '#a78bfa', '#34d399', '#60a5fa', '#fb7185', '#cbd5e1', '#facc15', '#2dd4bf'];

const ACTION_LABELS: Record<string, string> = {
  GOOGLE_REVIEW: 'Google Review',
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  NEWSLETTER: 'Newsletter',
  PURCHASE: 'Achat en boutique',
  NONE: 'Aucune action',
};

type Step = 'intro' | 'details' | 'game' | 'result';

export default function CampaignCustomerPage() {
  const { campaignId = '' } = useParams<{ campaignId: string }>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [campaign, setCampaign] = useState<PublicCampaign | null>(null);
  const [rewards, setRewards] = useState<PublicReward[]>([]);
  const [showAction, setShowAction] = useState(false);
  const [step, setStep] = useState<Step>('intro');
  const [submitted, setSubmitted] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [result, setResult] = useState<ParticipationResult | null>(null);
  const [copyMessage, setCopyMessage] = useState('');
  const [customer, setCustomer] = useState({ firstName: '', lastName: '', email: '', phone: '' });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    PublicCampaignService.load(campaignId)
      .then((loaded) => {
        if (cancelled) return;
        if (!loaded) {
          setLoadError('This campaign is unavailable or has ended.');
          return;
        }
        setCampaign(loaded.campaign);
        setRewards(loaded.rewards);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Unable to load this campaign.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  const segments = useMemo(
    () => rewards.map((reward, index) => ({
      id: reward.id,
      label: reward.name,
      color: SEGMENT_COLORS[index % SEGMENT_COLORS.length] ?? '#cbd5e1',
    })),
    [rewards],
  );

  const canSubmit = useMemo(
    () => Boolean(customer.firstName && customer.lastName && customer.email),
    [customer],
  );

  const gradient = useMemo(() => {
    if (!segments.length) return 'conic-gradient(#e2e8f0 0deg 360deg)';
    const step = 360 / segments.length;
    return `conic-gradient(${segments
      .map((segment, index) => `${segment.color} ${index * step}deg ${(index + 1) * step}deg`)
      .join(', ')})`;
  }, [segments]);

  const actionLabel = ACTION_LABELS[campaign?.require_action ?? 'NONE'] ?? 'Action requise';
  const needsDetails =
    Boolean(campaign) &&
    ((campaign?.require_action ?? 'NONE') !== 'NONE' || Number(campaign?.require_customer_information ?? 1) === 1);

  const startGame = () => setStep(needsDetails ? 'details' : 'game');

  const handleSpin = async () => {
    if (spinning || !campaign || result) return;

    setSpinning(true);
    setActionError(null);

    try {
      const participation = await PublicCampaignService.participate(campaign.public_code, {
        firstName: customer.firstName || undefined,
        lastName: customer.lastName || undefined,
        email: customer.email || undefined,
        phone: customer.phone || undefined,
        marketingConsent: Boolean(customer.email || customer.phone),
      });

      const winningIndex = Math.max(0, segments.findIndex((segment) => segment.id === participation.reward.id));
      const segmentAngle = 360 / Math.max(segments.length, 1);
      const target = winningIndex * segmentAngle + segmentAngle / 2;
      const desired = (((-target) % 360) + 360) % 360;
      const current = ((rotation % 360) + 360) % 360;
      const delta = ((((desired - current) % 360) + 360) % 360);
      setRotation(rotation + 1800 + delta);

      window.setTimeout(() => {
        setResult(participation);
        setSpinning(false);
        setStep('result');
      }, 2200);
    } catch (error: unknown) {
      setSpinning(false);
      setActionError(error instanceof Error ? error.message : 'Unable to spin right now.');
    }
  };

  const copyCode = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.couponCode);
      setCopyMessage('Code copied.');
    } catch {
      setCopyMessage('Copy the code manually.');
    }
    window.setTimeout(() => setCopyMessage(''), 2500);
  };

  const openActionLink = () => {
    if (!campaign) return;
    if (campaign.require_action === 'GOOGLE_REVIEW') {
      window.open(
        getGoogleMapsUrl(campaign.google_maps_url || campaign.google_maps_name || campaign.business_name || '', campaign.google_place_id || undefined),
        '_blank',
        'noopener,noreferrer',
      );
      return;
    }
    if (campaign.require_action === 'INSTAGRAM' && campaign.instagram_url) {
      window.open(campaign.instagram_url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (campaign.require_action === 'FACEBOOK' && campaign.facebook_url) {
      window.open(campaign.facebook_url, '_blank', 'noopener,noreferrer');
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading campaign…
      </div>
    );
  }

  if (loadError || !campaign) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-sm rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <AlertTriangle className="mx-auto h-10 w-10 text-amber-500" />
          <h1 className="mt-4 text-xl font-semibold text-slate-900">Campaign unavailable</h1>
          <p className="mt-2 text-sm text-slate-600">{loadError ?? 'This campaign is unavailable or has ended.'}</p>
        </div>
      </div>
    );
  }

  const merchantName = campaign.business_name ?? 'Merchant';
  const locationLabel = campaign.google_maps_name || merchantName;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.22),transparent_28%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] p-4 text-slate-900 sm:p-6">
      <div className="mx-auto max-w-md">
        <div className="overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-[0_20px_50px_rgba(15,23,42,0.08)]">
          <div className="bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 p-5 text-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-lg font-bold text-white">
                  {merchantName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.2em] text-indigo-100">Merchant</p>
                  <p className="font-medium">{merchantName}</p>
                </div>
              </div>
              <span className="rounded-full bg-emerald-400/20 px-2 py-2 text-[10px] font-medium text-emerald-100">Live</span>
            </div>

            <div className="mt-5">
              <p className="text-[10px] uppercase tracking-[0.2em] text-indigo-100">Campaign</p>
              <h1 className="mt-2 text-3xl font-semibold">{campaign.name}</h1>
              <p className="mt-2 text-sm text-indigo-100">
                {campaign.description || 'Tournez la roue et découvrez votre cadeau immédiatement.'}
              </p>
            </div>
          </div>

          {step === 'intro' && (
            <div className="space-y-5 p-5">
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
                <div className="flex items-center gap-3">
                  <MapPin className="h-5 w-5 text-indigo-600" />
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-indigo-600">Lieu</p>
                    <p className="text-sm font-medium text-slate-900">{locationLabel}</p>
                  </div>
                </div>
              </div>

              {rewards.length > 0 && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Lots à gagner</p>
                  <ul className="mt-3 space-y-2">
                    {rewards.map((reward, index) => (
                      <li key={reward.id} className="flex items-center gap-2 text-sm text-slate-700">
                        <span
                          className="h-3 w-3 shrink-0 rounded-full"
                          style={{ backgroundColor: SEGMENT_COLORS[index % SEGMENT_COLORS.length] }}
                        />
                        <span>{reward.name}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="space-y-3">
                {[
                  '1. Complétez l’action requise',
                  '2. Revenez sur cette page',
                  '3. Tournez la roue et gagnez',
                ].map((item) => (
                  <div key={item} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700">✓</div>
                    <span>{item}</span>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={startGame}
                className="w-full rounded-2xl bg-indigo-600 px-4 py-3 text-base font-medium text-white hover:bg-indigo-500"
              >
                Commencer
              </button>
            </div>
          )}

          {step === 'details' && (
            <div className="space-y-5 p-5">
              <div>
                <h2 className="text-2xl font-semibold text-slate-900">Action requise</h2>
                <p className="mt-1 text-sm text-slate-600">Complétez cette étape pour débloquer le tirage.</p>
              </div>

              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-amber-700">{actionLabel}</p>
                    <p className="mt-2 text-sm text-amber-800">Laissez un avis puis revenez pour tourner la roue.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAction(true)}
                    className="rounded-full bg-amber-500 px-3 py-1.5 text-xs font-medium text-white"
                  >
                    How it works
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="mb-3 text-sm font-medium text-slate-700">Informations client</p>
                <div className="grid gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      value={customer.firstName}
                      onChange={(e) => setCustomer({ ...customer, firstName: e.target.value })}
                      placeholder="Prénom"
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-400"
                    />
                    <input
                      value={customer.lastName}
                      onChange={(e) => setCustomer({ ...customer, lastName: e.target.value })}
                      placeholder="Nom"
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-400"
                    />
                  </div>
                  <input
                    value={customer.email}
                    onChange={(e) => setCustomer({ ...customer, email: e.target.value })}
                    type="email"
                    placeholder="Email"
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-400"
                  />
                  <input
                    value={customer.phone}
                    onChange={(e) => setCustomer({ ...customer, phone: e.target.value })}
                    type="tel"
                    placeholder="Téléphone"
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-400"
                  />
                </div>
                <p className="mt-3 text-xs text-slate-500">Consentement requis pour traiter les données de participation.</p>
              </div>

              <button
                type="button"
                onClick={() => setSubmitted(true)}
                disabled={!canSubmit}
                className="w-full rounded-2xl bg-indigo-600 px-4 py-3 text-base font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Confirmer l’action
              </button>

              {submitted && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                  Action complétée. Vous pouvez maintenant lancer la roue.
                </div>
              )}

              <button
                type="button"
                onClick={() => setStep('game')}
                disabled={!submitted}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Tourner la roue
              </button>
            </div>
          )}

          {step === 'game' && (
            <div className="space-y-5 p-5">
              <div className="text-center">
                <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Prize wheel</p>
                <h2 className="mt-2 text-2xl font-semibold text-slate-900">Spin to win</h2>
                {segments.length === 0 && (
                  <p className="mt-2 text-sm text-rose-600">No prizes are available right now.</p>
                )}
              </div>

              <div className="flex justify-center">
                <div className="relative flex h-72 w-72 items-center justify-center">
                  <div
                    className="h-72 w-72 rounded-full border-[10px] border-slate-200"
                    style={{
                      background: gradient,
                      transform: `rotate(${rotation}deg)`,
                      transition: 'transform 2200ms cubic-bezier(0.2, 0.8, 0.2, 1)',
                    }}
                  />
                  <div className="pointer-events-none absolute left-1/2 top-0 h-0 w-0 -translate-x-1/2 border-x-[14px] border-x-transparent border-b-[26px] border-b-slate-900" />
                  <div className="pointer-events-none absolute flex h-24 w-24 items-center justify-center rounded-full border-8 border-slate-200 bg-white text-xl font-bold text-slate-900 shadow-lg">
                    <Trophy className="h-8 w-8 text-indigo-600" />
                  </div>
                </div>
              </div>

              {segments.length > 0 && (
                <div className="flex flex-wrap justify-center gap-2">
                  {segments.map((segment) => (
                    <span
                      key={segment.id}
                      className="rounded-full px-2.5 py-1 text-xs font-medium text-white"
                      style={{ backgroundColor: segment.color }}
                    >
                      {segment.label}
                    </span>
                  ))}
                </div>
              )}

              {actionError && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{actionError}</div>
              )}

              <button
                type="button"
                disabled={spinning || segments.length === 0}
                onClick={() => void handleSpin()}
                className="w-full rounded-2xl bg-amber-400 px-4 py-3 text-base font-semibold text-slate-900 shadow-sm transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {spinning ? 'Rotation…' : 'Spin the wheel'}
              </button>
            </div>
          )}

          {step === 'result' && result && (
            <div className="space-y-5 p-5">
              <div className="rounded-3xl bg-gradient-to-r from-emerald-500 to-teal-500 p-5 text-white">
                <div className="flex items-center justify-center">
                  <Gift className="h-10 w-10" />
                </div>
                <p className="mt-4 text-center text-[10px] uppercase tracking-[0.24em] text-emerald-100">Bravo</p>
                <h2 className="mt-2 text-center text-3xl font-semibold">Félicitations !</h2>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm text-slate-500">Vous avez gagné</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">{result.reward.name}</p>
                {result.reward.description && (
                  <p className="mt-1 text-sm text-slate-600">{result.reward.description}</p>
                )}

                <div className="mt-4 rounded-xl bg-white p-3 text-left shadow-sm ring-1 ring-slate-200">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Code</p>
                  <p className="mt-2 text-xl font-bold tracking-[0.22em] text-slate-900">{result.couponCode}</p>
                </div>

                <div className="mt-4 space-y-2 text-sm text-slate-600">
                  <div className="flex items-center justify-between">
                    <span>Merchant</span>
                    <span className="font-medium text-slate-900">{merchantName}</span>
                  </div>
                </div>

                {copyMessage && <p className="mt-3 text-xs text-emerald-600">{copyMessage}</p>}
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => void copyCode()}
                  className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700"
                >
                  <Copy className="h-4 w-4" />
                  Copier le code
                </button>
                <button
                  type="button"
                  onClick={() => setStep('intro')}
                  className="flex-1 rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white"
                >
                  Retour
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {showAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[28px] bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">How it works</p>
                <h3 className="mt-2 text-2xl font-semibold text-slate-900">{actionLabel}</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAction(false)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              {['Complete the action', 'Return here', 'Spin the wheel'].map((text, index) => (
                <div key={text} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700">
                    {index + 1}
                  </div>
                  <span className="text-sm text-slate-700">{text}</span>
                </div>
              ))}
            </div>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              Vous serez redirigé vers la page demandée. Revenez ici après avoir complété l’action.
            </div>

            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setShowAction(false)}
                className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700"
              >
                Fermer
              </button>
              <button
                type="button"
                onClick={openActionLink}
                className="flex-1 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500"
              >
                Ouvrir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
