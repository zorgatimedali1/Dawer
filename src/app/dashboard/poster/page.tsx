'use client';

import { Download, Printer, Sparkles } from 'lucide-react';

const campaigns = ['Summer Splash', 'Loyalty Loop', 'Holiday Booster'];

export default function PosterEditorPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Éditeur d’affiches</p>
        <h2 className="mt-2 text-3xl font-semibold text-slate-900 dark:text-slate-100">Créez une impression promotionnelle</h2>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-soft dark:border-slate-800 dark:bg-slate-900">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">Campagne</label>
            <select className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950">
              {campaigns.map((campaign) => (
                <option key={campaign}>{campaign}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">Titre</label>
            <input defaultValue="Tentez votre chance !" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">Sous-titre</label>
            <input defaultValue="Gagnez des cadeaux dès aujourd’hui" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">Couleurs</label>
            <div className="flex gap-3">
              {['#4f46e5', '#f59e0b', '#14b8a6', '#ef4444'].map((color) => (
                <button key={color} type="button" className="h-9 w-9 rounded-full border-2 border-white shadow-sm" style={{ backgroundColor: color }} />
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500">
              <Download className="h-4 w-4" />
              Télécharger
            </button>
            <button type="button" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200">
              <Printer className="h-4 w-4" />
              Imprimer
            </button>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-indigo-600 via-violet-600 to-amber-500 p-6 text-white shadow-soft">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.26em] text-indigo-100">Café du Centre</p>
              <h3 className="mt-2 text-3xl font-semibold">Tentez votre chance !</h3>
            </div>
            <div className="rounded-2xl bg-white/15 p-3 backdrop-blur-sm">
              <Sparkles className="h-7 w-7" />
            </div>
          </div>
          <p className="mt-4 max-w-md text-indigo-100">Gagnez des cadeaux dès aujourd’hui en scannant le QR code.</p>
          <div className="mt-8 grid gap-6 md:grid-cols-[1fr_0.8fr] md:items-end">
            <div className="rounded-3xl bg-white/10 p-5 backdrop-blur-sm">
              <div className="mb-3 flex items-center justify-between text-sm text-indigo-100">
                <span>QR code</span>
                <span className="rounded-full bg-white/10 px-2 py-1">scan</span>
              </div>
              <div className="grid h-32 w-32 place-items-center rounded-2xl bg-white text-2xl font-black text-slate-900">QR</div>
            </div>
            <div className="rounded-3xl bg-white/10 p-5 text-center backdrop-blur-sm">
              <p className="text-sm text-indigo-100">Récompense</p>
              <p className="mt-2 text-3xl font-bold">-20%</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
