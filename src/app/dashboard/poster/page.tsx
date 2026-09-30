'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, Printer, Sparkles } from 'lucide-react';
import { PosterService, type Poster } from '@/services/poster.service';
import { CampaignService, type Campaign } from '@/services/campaign.service';

const THEMES = ['#4f46e5', '#f59e0b', '#14b8a6', '#ef4444'];
const TEMPLATES = ['gradient', 'minimal', 'festive'];

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-950';

function buildSvg(poster: Poster, campaignUrl: string, businessName: string): string {
  const escape = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1120" viewBox="0 0 800 1120">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${escape(poster.theme)}"/>
      <stop offset="100%" stop-color="#f59e0b"/>
    </linearGradient>
  </defs>
  <rect width="800" height="1120" fill="url(#bg)"/>
  <text x="64" y="120" fill="rgba(255,255,255,0.8)" font-family="Arial, sans-serif" font-size="22" letter-spacing="6">${escape(businessName)}</text>
  <text x="64" y="240" fill="#ffffff" font-family="Arial, sans-serif" font-size="72" font-weight="700">${escape(poster.title)}</text>
  <text x="64" y="320" fill="rgba(255,255,255,0.85)" font-family="Arial, sans-serif" font-size="34">${escape(poster.subtitle)}</text>
  <rect x="64" y="700" width="360" height="360" rx="32" fill="rgba(255,255,255,0.15)"/>
  <text x="112" y="860" fill="#ffffff" font-family="Arial, sans-serif" font-size="44" font-weight="700">QR</text>
  <text x="112" y="920" fill="rgba(255,255,255,0.85)" font-family="Arial, sans-serif" font-size="24">Scannez pour jouer</text>
  <rect x="480" y="700" width="256" height="360" rx="32" fill="rgba(255,255,255,0.15)"/>
  <text x="512" y="780" fill="rgba(255,255,255,0.8)" font-family="Arial, sans-serif" font-size="24">Campagne</text>
  <text x="512" y="830" fill="#ffffff" font-family="Arial, sans-serif" font-size="30" font-weight="700">${escape(poster.campaignName)}</text>
  <text x="512" y="1010" fill="rgba(255,255,255,0.7)" font-family="Arial, sans-serif" font-size="18">${escape(campaignUrl)}</text>
</svg>`;
}

export default function PosterEditorPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState('');
  const [posters, setPosters] = useState<Poster[]>([]);
  const [poster, setPoster] = useState<Poster | null>(null);
  const [title, setTitle] = useState('Tentez votre chance !');
  const [subtitle, setSubtitle] = useState('Gagnez des cadeaux dès aujourd’hui');
  const [theme, setTheme] = useState('#4f46e5');
  const [template, setTemplate] = useState('gradient');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const loadPosters = useCallback(async (selectedCampaignId: string) => {
    const list = await PosterService.list({ campaignId: selectedCampaignId });
    setPosters(list);
    return list;
  }, []);

  useEffect(() => {
    CampaignService.getCampaigns({ limit: 100 })
      .then(async (list) => {
        setCampaigns(list);
        const first = list[0]?.id ?? '';
        setCampaignId(first);
        if (first) {
          const loaded = await loadPosters(first);
          if (loaded[0]) {
            setPoster(loaded[0]);
            setTitle(loaded[0].title || 'Tentez votre chance !');
            setSubtitle(loaded[0].subtitle || 'Gagnez des cadeaux dès aujourd’hui');
            setTheme(loaded[0].theme);
            setTemplate(loaded[0].template);
          }
        }
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unable to load the poster editor.'))
      .finally(() => setLoading(false));
  }, [loadPosters]);

  const handleCampaignChange = async (nextCampaignId: string) => {
    setCampaignId(nextCampaignId);
    setError('');
    setStatus('');
    try {
      const loaded = await loadPosters(nextCampaignId);
      if (loaded[0]) {
        setPoster(loaded[0]);
        setTitle(loaded[0].title || 'Tentez votre chance !');
        setSubtitle(loaded[0].subtitle || 'Gagnez des cadeaux dès aujourd’hui');
        setTheme(loaded[0].theme);
        setTemplate(loaded[0].template);
      } else {
        setPoster(null);
        setTitle('Tentez votre chance !');
        setSubtitle('Gagnez des cadeaux dès aujourd’hui');
        setTheme('#4f46e5');
        setTemplate('gradient');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load posters.');
    }
  };

  const handleSave = async () => {
    if (!campaignId) return;
    setSaving(true);
    setStatus('');
    setError('');
    try {
      const saved = poster
        ? await PosterService.update(poster.id, { title, subtitle, theme, template })
        : await PosterService.create({ campaignId, title, subtitle, theme, template });
      setPoster(saved);
      setPosters(await loadPosters(campaignId));
      setStatus('Poster saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save the poster.');
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = () => {
    const campaign = campaigns.find((item) => item.id === campaignId);
    const campaignUrl = `${window.location.origin}/customer/${campaign?.publicCode ?? campaignId}`;
    const businessName = campaign?.name ?? 'Campaign';
    const svg = buildSvg(
      {
        id: poster?.id ?? 'draft',
        campaignId,
        campaignName: campaign?.name ?? 'Campaign',
        template,
        title,
        subtitle,
        theme,
        configuration: null,
        updatedAt: new Date().toISOString(),
      },
      campaignUrl,
      businessName,
    );

    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${(title || 'poster').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.svg`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <p className="text-sm text-slate-500">Chargement de l’éditeur…</p>
      </div>
    );
  }

  if (campaigns.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Éditeur d’affiches</p>
          <h2 className="mt-2 text-3xl font-semibold text-slate-900 dark:text-slate-100">
            Créez une impression promotionnelle
          </h2>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Créez une campagne avant de concevoir une affiche.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Éditeur d’affiches</p>
          <h2 className="mt-2 text-3xl font-semibold text-slate-900 dark:text-slate-100">
            Créez une impression promotionnelle
          </h2>
        </div>
        <div className="text-right text-sm">
          {status && <p className="text-green-600">{status}</p>}
          {error && <p className="text-red-600">{error}</p>}
          {saving && <p className="text-slate-500">Enregistrement…</p>}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-soft dark:border-slate-800 dark:bg-slate-900">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">Campagne</label>
            <select
              className={inputClass}
              value={campaignId}
              onChange={(event) => void handleCampaignChange(event.target.value)}
            >
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </select>
            {posters.length > 0 && (
              <p className="mt-2 text-xs text-slate-500">
                {posters.length} affiche{posters.length > 1 ? 's' : ''} enregistrée
                {posters.length > 1 ? 's' : ''}
              </p>
            )}
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">Titre</label>
            <input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">Sous-titre</label>
            <input className={inputClass} value={subtitle} onChange={(event) => setSubtitle(event.target.value)} />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">Gabarit</label>
            <select className={inputClass} value={template} onChange={(event) => setTemplate(event.target.value)}>
              {TEMPLATES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">Couleurs</label>
            <div className="flex gap-3">
              {THEMES.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setTheme(color)}
                  className={`h-9 w-9 rounded-full border-2 shadow-sm ${
                    theme === color ? 'border-slate-900 dark:border-white' : 'border-white'
                  }`}
                  style={{ backgroundColor: color }}
                  aria-label={`Couleur ${color}`}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500"
            >
              <Download className="h-4 w-4" />
              Télécharger
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200"
            >
              <Printer className="h-4 w-4" />
              Imprimer
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60 dark:bg-white dark:text-slate-900"
            >
              {poster ? 'Mettre à jour' : 'Enregistrer'}
            </button>
          </div>
        </div>

        <div
          className="rounded-3xl border border-slate-200 bg-gradient-to-br p-6 text-white shadow-soft dark:border-slate-800"
          style={{ backgroundImage: `linear-gradient(135deg, ${theme}, #f59e0b)` }}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.26em] text-white/70">
                {campaigns.find((campaign) => campaign.id === campaignId)?.name ?? 'Campagne'}
              </p>
              <h3 className="mt-1 text-3xl font-semibold">{title}</h3>
            </div>
            <div className="rounded-2xl bg-white/15 p-3 backdrop-blur-sm">
              <Sparkles className="h-7 w-7" />
            </div>
          </div>
          <p className="mt-4 max-w-md text-white/85">{subtitle}</p>
          <div className="mt-8 grid gap-6 md:grid-cols-[1fr_0.8fr] md:items-end">
            <div className="rounded-3xl bg-white/10 p-5 backdrop-blur-sm">
              <div className="mb-3 flex items-center justify-between text-sm text-white/75">
                <span>QR code</span>
                <span className="rounded-full bg-white/10 px-2 py-1">scan</span>
              </div>
              <div className="grid h-32 w-32 place-items-center rounded-2xl bg-white text-2xl font-black text-slate-900">
                QR
              </div>
            </div>
            <div className="rounded-3xl bg-white/10 p-5 text-center backdrop-blur-sm">
              <p className="text-sm text-white/75">Récompense</p>
              <p className="mt-2 text-3xl font-bold">Bon à gagner</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
