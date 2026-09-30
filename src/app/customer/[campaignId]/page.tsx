"use client";

import { useParams } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { Check, Gift, MapPin, Sparkles, Star, Trophy, X } from 'lucide-react';
import { getGoogleMapsUrl } from '@/lib/google-maps';

const wheelSegments = [
  { label: '5% OFF', color: '#f59e0b' },
  { label: '10% OFF', color: '#a78bfa' },
  { label: 'Free Drink', color: '#34d399' },
  { label: 'Free Dessert', color: '#60a5fa' },
  { label: 'Jackpot', color: '#fb7185' },
  { label: 'Try Again', color: '#cbd5e1' },
];

export default function CampaignCustomerPage() {
  const { campaignId = '' } = useParams<{ campaignId: string }>();
  const [showReview, setShowReview] = useState(false);
  const [step, setStep] = useState<'intro' | 'details' | 'game' | 'result'>('intro');
  const [submitted, setSubmitted] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [reward, setReward] = useState('10% OFF');
  const [customer, setCustomer] = useState({ firstName: '', lastName: '', email: '', phone: '' });

  const canSubmit = useMemo(
    () => customer.firstName && customer.lastName && customer.email,
    [customer],
  );

  const handleSpin = () => {
    setSpinning(true);
    setTimeout(() => {
      setSpinning(false);
      setReward('-20% sur votre prochaine visite');
      setStep('result');
    }, 2200);
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.22),transparent_28%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] p-4 text-slate-900 sm:p-6">
      <div className="mx-auto max-w-md">
        <div className="overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-[0_20px_50px_rgba(15,23,42,0.08)]">
          <div className="bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 p-5 text-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-lg font-bold text-white">M</div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.2em] text-indigo-100">Merchant</p>
                  <p className="font-medium">Meridian North</p>
                </div>
              </div>
              <span className="rounded-full bg-emerald-400/20 px-2 py-1 text-[10px] font-medium text-emerald-100">Live</span>
            </div>

            <div className="mt-5">
              <p className="text-[10px] uppercase tracking-[0.2em] text-indigo-100">Campaign #{campaignId}</p>
              <h1 className="mt-2 text-3xl font-semibold">Tentez votre chance 🎉</h1>
              <p className="mt-2 text-sm text-indigo-100">Tournez la roue et découvrez votre cadeau immédiatement.</p>
            </div>
          </div>

          {step === 'intro' && (
            <div className="space-y-5 p-5">
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
                <div className="flex items-center gap-3">
                  <MapPin className="h-5 w-5 text-indigo-600" />
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-indigo-600">Lieu</p>
                    <p className="text-sm font-medium text-slate-900">Café du Centre</p>
                  </div>
                </div>
              </div>

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

              <button type="button" onClick={() => setStep('details')} className="w-full rounded-2xl bg-indigo-600 px-4 py-3 text-base font-medium text-white hover:bg-indigo-500">
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
                    <p className="text-xs uppercase tracking-[0.2em] text-amber-700">Google Review</p>
                    <p className="mt-2 text-sm text-amber-800">Laissez un avis Google puis revenez pour tourner la roue.</p>
                  </div>
                  <button type="button" onClick={() => setShowReview(true)} className="rounded-full bg-amber-500 px-3 py-1.5 text-xs font-medium text-white">How it works</button>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="mb-3 text-sm font-medium text-slate-700">Informations client</p>
                <div className="grid gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <input value={customer.firstName} onChange={(e) => setCustomer({ ...customer, firstName: e.target.value })} placeholder="Prénom" className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-400" />
                    <input value={customer.lastName} onChange={(e) => setCustomer({ ...customer, lastName: e.target.value })} placeholder="Nom" className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-400" />
                  </div>
                  <input value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} type="email" placeholder="Email" className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-400" />
                  <input value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} type="tel" placeholder="Téléphone" className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-400" />
                </div>
                <p className="mt-3 text-xs text-slate-500">Consentement requis pour traiter les données de participation.</p>
              </div>

              <button type="button" onClick={() => setSubmitted(true)} disabled={!canSubmit} className="w-full rounded-2xl bg-indigo-600 px-4 py-3 text-base font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">
                Confirmer l’action
              </button>

              {submitted && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                  Action complétée. Vous pouvez maintenant lancer la roue.
                </div>
              )}

              <button type="button" onClick={() => setStep('game')} disabled={!submitted} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50">
                Tourner la roue
              </button>
            </div>
          )}

          {step === 'game' && (
            <div className="space-y-5 p-5">
              <div className="text-center">
                <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Prize wheel</p>
                <h2 className="mt-2 text-2xl font-semibold text-slate-900">Spin to win</h2>
              </div>

              <div className="flex justify-center">
                <div
                  className={`relative flex h-72 w-72 items-center justify-center rounded-full border-[10px] border-slate-200 transition-transform duration-[2000ms] ${spinning ? 'scale-105' : ''}`}
                  style={{
                    background: `conic-gradient(${wheelSegments.map((segment, index) => {
                      const start = (index / wheelSegments.length) * 360;
                      const end = ((index + 1) / wheelSegments.length) * 360;
                      return `${segment.color} ${start}deg ${end}deg`;
                    }).join(', ')})`,
                  }}
                >
                  <div className="absolute left-1/2 top-0 h-0 w-0 -translate-x-1/2 border-x-[14px] border-x-transparent border-b-[26px] border-b-slate-900" />
                  <div className="flex h-24 w-24 items-center justify-center rounded-full border-8 border-slate-200 bg-white text-xl font-bold text-slate-900 shadow-lg">
                    <Trophy className="h-8 w-8 text-indigo-600" />
                  </div>
                </div>
              </div>

              <button type="button" disabled={spinning} onClick={handleSpin} className="w-full rounded-2xl bg-amber-400 px-4 py-3 text-base font-semibold text-slate-900 shadow-sm transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60">
                {spinning ? 'Rotation…' : 'Spin the wheel'}
              </button>
            </div>
          )}

          {step === 'result' && (
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
                <p className="mt-2 text-2xl font-semibold text-slate-900">{reward}</p>
                <div className="mt-4 rounded-xl bg-white p-3 text-left shadow-sm ring-1 ring-slate-200">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Code</p>
                  <p className="mt-2 text-xl font-bold tracking-[0.22em] text-slate-900">ABC-9281</p>
                </div>
                <div className="mt-4 space-y-2 text-sm text-slate-600">
                  <div className="flex items-center justify-between"><span>Expiration</span><span className="font-medium text-slate-900">31 déc. 2026</span></div>
                  <div className="flex items-center justify-between"><span>Merchant</span><span className="font-medium text-slate-900">Meridian North</span></div>
                </div>
              </div>

              <div className="flex gap-3">
                <button type="button" className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700">Copier le code</button>
                <button type="button" className="flex-1 rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white">Retour</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {showReview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[28px] bg-white p-5 shadow-2xl dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">How it works</p>
                <h3 className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">Google review</h3>
              </div>
              <button type="button" onClick={() => setShowReview(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              {["Leave a Google review", 'Return here', 'Spin the wheel'].map((text, index) => (
                <div key={text} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200">{index + 1}</div>
                  <span className="text-sm text-slate-700 dark:text-slate-200">{text}</span>
                </div>
              ))}
            </div>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              Vous serez redirigé vers Google. Revenez ici après avoir complété l’action.
            </div>

            <div className="mt-5 flex gap-3">
              <button type="button" onClick={() => setShowReview(false)} className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200">Fermer</button>
              <button type="button" onClick={() => window.open(getGoogleMapsUrl('Café du Centre'), '_blank', 'noopener,noreferrer')} className="flex-1 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500">Write a Google review</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
