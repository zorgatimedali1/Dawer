'use client';

import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpDown, Copy, ExternalLink, Plus, Trash2, UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getGoogleMapsUrl } from '@/lib/google-maps';
import { CampaignConfigService, type CampaignConfigurationInput } from '@/services/campaign-config.service';

interface PlaceSuggestion {
  placeId: string;
  label: string;
  mainText: string;
  secondaryText: string;
}

const initialRewards = [
  { id: 'r1', name: 'Prochaine visite', probability: 20, metadata: '-20% sur votre prochaine visite' },
  { id: 'r2', name: 'Café offert', probability: 15, metadata: 'A emporter' },
  { id: 'r3', name: '10% aujourd’hui', probability: 10, metadata: 'Code valable aujourd’hui' },
  { id: 'r4', name: 'Points x2', probability: 20, metadata: 'Aujourd’hui uniquement' },
  { id: 'r5', name: 'Cadeau surprise', probability: 10, metadata: 'À choisir en caisse' },
  { id: 'r6', name: 'Retentez votre chance', probability: 25, metadata: 'Bonus de relance' },
];

export default function WheelConfigPage() {
  const [searchParams] = useSearchParams();
  const selectedCampaignId = searchParams.get('campaign') ?? undefined;
  const [loadedCampaignId, setLoadedCampaignId] = useState<string | undefined>(undefined);
  const [title, setTitle] = useState('Tentez votre chance 🎉');
  const [description, setDescription] = useState('Tournez la roue et découvrez votre cadeau immédiatement !');
  const [logo, setLogo] = useState<string | null>('https://images.unsplash.com/photo-1556740749-887f6717d7e4?auto=format&fit=crop&w=200&q=80');
  const [action, setAction] = useState<CampaignConfigurationInput['action']>('google-review');
  const [googleMapsSearch, setGoogleMapsSearch] = useState('');
  const [googlePlaceId, setGooglePlaceId] = useState<string>();
  const [facebookUrl, setFacebookUrl] = useState('');
  const [instagramUrl, setInstagramUrl] = useState('');
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [configMessage, setConfigMessage] = useState('');
  const [configError, setConfigError] = useState('');
  const [copyMessage, setCopyMessage] = useState('');
  const [placeSuggestions, setPlaceSuggestions] = useState<PlaceSuggestion[]>([]);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [placesLoading, setPlacesLoading] = useState(false);
  const [placesError, setPlacesError] = useState('');
  const [publicUrl, setPublicUrl] = useState('');
  const [rewards, setRewards] = useState(initialRewards);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner] = useState<string | null>(null);

  const totalProbability = useMemo(
    () => rewards.reduce((sum, reward) => sum + Number(reward.probability || 0), 0),
    [rewards],
  );

  const invalid = totalProbability > 100;
  const remaining = Math.max(100 - totalProbability, 0);

  useEffect(() => {
    const input = googleMapsSearch.trim();

    if (googlePlaceId || input.length < 3 || /^https?:\/\//i.test(input)) {
      setPlaceSuggestions([]);
      setPlacesError('');
      setPlacesLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setPlacesLoading(true);
      setPlacesError('');

      try {
        const response = await fetch(`/api/places/autocomplete?input=${encodeURIComponent(input)}`, {
          signal: controller.signal,
        });
        const result = await response.json() as {
          success: boolean;
          suggestions?: PlaceSuggestion[];
          error?: string;
        };

        if (!response.ok || !result.success) {
          throw new Error(result.error ?? 'Place suggestions are unavailable.');
        }

        setPlaceSuggestions(result.suggestions ?? []);
        setActiveSuggestion(-1);
      } catch (error) {
        if (!controller.signal.aborted) {
          setPlaceSuggestions([]);
          setPlacesError(error instanceof Error ? error.message : 'Place suggestions are unavailable.');
        }
      } finally {
        if (!controller.signal.aborted) setPlacesLoading(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [googleMapsSearch, googlePlaceId]);

  useEffect(() => {
    let cancelled = false;
    CampaignConfigService.load(selectedCampaignId)
      .then((saved) => {
        if (!saved || cancelled) return;
        setTitle(saved.title);
        setDescription(saved.description);
        setGoogleMapsSearch(saved.googleMapsName);
        setGooglePlaceId(saved.googlePlaceId || undefined);
        setFacebookUrl(saved.facebookUrl);
        setInstagramUrl(saved.instagramUrl);
        setAction(saved.action);
        setLoadedCampaignId(saved.id);
        setPublicUrl(`${window.location.origin}/customer/${saved.publicCode}`);
        if (saved.rewards?.length) {
          setRewards(
            saved.rewards.map((reward) => ({
              id: reward.id ?? crypto.randomUUID(),
              name: reward.name,
              probability: Number(reward.weight ?? 0),
              metadata: reward.description ?? '',
            })),
          );
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setConfigError(error instanceof Error ? error.message : 'Unable to load campaign settings.');
      })
      .finally(() => {
        if (!cancelled) setIsLoadingConfig(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedCampaignId]);

  const choosePlace = (suggestion: PlaceSuggestion) => {
    setGoogleMapsSearch(suggestion.label);
    setGooglePlaceId(suggestion.placeId);
    setPlaceSuggestions([]);
    setPlacesError('');
    setActiveSuggestion(-1);
  };

  const handlePlaceInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setPlaceSuggestions([]);
      setActiveSuggestion(-1);
      return;
    }

    if (!placeSuggestions.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveSuggestion((current) => (current + 1) % placeSuggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveSuggestion((current) => (current <= 0 ? placeSuggestions.length - 1 : current - 1));
    } else if (event.key === 'Enter' && activeSuggestion >= 0) {
      event.preventDefault();
      const suggestion = placeSuggestions[activeSuggestion];
      if (suggestion) choosePlace(suggestion);
    }
  };

  const handleSaveConfig = async () => {
    setIsSavingConfig(true);
    setConfigError('');
    setConfigMessage('');

    try {
      const saved = await CampaignConfigService.save({
        campaignId: loadedCampaignId ?? selectedCampaignId,
        title,
        description,
        googleMapsName: googleMapsSearch.trim(),
        googleMapsUrl: googleMapsSearch.trim() ? getGoogleMapsUrl(googleMapsSearch, googlePlaceId) : '',
        googlePlaceId: googlePlaceId ?? '',
        facebookUrl: facebookUrl.trim(),
        instagramUrl: instagramUrl.trim(),
        action,
        rewards: rewards.map((reward) => ({
          id: reward.id,
          name: reward.name,
          description: reward.metadata,
          type: 'custom_reward' as const,
          value: 0,
          weight: Number(reward.probability || 0),
          active: true,
        })),
      });
      setLoadedCampaignId(saved.id);
      setPublicUrl(`${window.location.origin}/customer/${saved.publicCode}`);
      setConfigMessage('Configuration saved. Your public campaign link is ready.');
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : 'Unable to save campaign settings.');
    } finally {
      setIsSavingConfig(false);
    }
  };

  const copyPublicUrl = async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopyMessage('Public link copied.');
    } catch {
      setCopyMessage('Unable to copy the link.');
    }
    window.setTimeout(() => setCopyMessage(''), 2500);
  };

  const updateReward = (id: string, field: 'name' | 'probability' | 'metadata', value: string | number) => {
    setRewards((current) =>
      current.map((reward) => (reward.id === id ? { ...reward, [field]: field === 'probability' ? Number(value) : value } : reward)),
    );
  };

  const addReward = () => {
    setRewards((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        name: `Nouveau bonus ${current.length + 1}`,
        probability: 5,
        metadata: 'Nouvelle récompense',
      },
    ]);
  };

  const removeReward = (id: string) => {
    setRewards((current) => current.filter((reward) => reward.id !== id));
  };

  const moveReward = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= rewards.length) return;
    const next = [...rewards];
    const currentReward = next[index];
    const targetReward = next[targetIndex];
    if (!currentReward || !targetReward) return;
    next[index] = targetReward;
    next[targetIndex] = currentReward;
    setRewards(next);
  };

  const wheelColors = ['#f59e0b', '#ef4444', '#14b8a6', '#6366f1', '#f43f5e', '#84cc16', '#0ea5e9', '#a855f7'];

  const wheelSegments = useMemo(() => {
    if (!rewards.length || totalProbability <= 0) return [] as { label: string; start: number; end: number; color: string }[];

    let start = 0;
    return rewards.map((reward, index) => {
      const size = (Number(reward.probability || 0) / totalProbability) * 360;
      const segment = {
        label: reward.name,
        start,
        end: start + size,
        color: wheelColors[index % wheelColors.length],
      };
      start += size;
      return segment;
    });
  }, [rewards, totalProbability]);

  const handleSpin = () => {
    if (!rewards.length || invalid || spinning) return;

    const weightedPool = rewards.map((reward) => ({ reward, weight: Number(reward.probability || 0) }));
    const total = weightedPool.reduce((sum, item) => sum + item.weight, 0);
    let random = Math.random() * total;

    const firstReward = rewards[0];
    if (!firstReward) return;
    let selectedReward = firstReward;
    for (const item of weightedPool) {
      random -= item.weight;
      if (random <= 0) {
        selectedReward = item.reward;
        break;
      }
    }

    const winningIndex = rewards.findIndex((reward) => reward.id === selectedReward.id);
    const selectedSegment = wheelSegments[winningIndex] ?? wheelSegments[0];
    const segmentCenter = selectedSegment ? (selectedSegment.start + selectedSegment.end) / 2 : 0;
    const targetDegrees = 360 - ((segmentCenter + 90) % 360);
    const nextRotation = rotation + 360 * (6 + Math.floor(Math.random() * 3)) + targetDegrees;

    setSpinning(true);
    setWinner(selectedReward.name);
    setRotation(nextRotation);
    window.setTimeout(() => setSpinning(false), 2600);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setLogo(String(reader.result));
    reader.readAsDataURL(file);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
        <Link to="/dashboard/overview" className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-200">
          <ArrowLeft className="h-4 w-4" />
          Accueil
        </Link>
        <span>›</span>
        <span className="font-medium text-slate-700 dark:text-slate-200">Configuration de la roue</span>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_0.9fr]">
        <section className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Informations générales</h2>
            <div className="mt-5 space-y-5">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">Titre de la roue</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-indigo-900"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-indigo-900"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">Logo de l’entreprise</label>
                <div className="flex flex-col gap-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950">
                  <div className="flex items-center gap-4">
                    <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200 dark:ring-slate-700">
                      {logo ? <img src={logo} alt="Business logo" className="h-full w-full object-cover" /> : <UploadCloud className="h-6 w-6 text-slate-400" />}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm text-slate-600 dark:text-slate-300">PNG, JPG, SVG, WEBP</p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Jusqu’à 5 MB</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <label className="inline-flex cursor-pointer items-center rounded-xl bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500">
                      Télécharger
                      <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="hidden" onChange={handleFileUpload} />
                    </label>
                    {logo && (
                      <button type="button" onClick={() => setLogo(null)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300">
                        Retirer
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Récompenses et probabilités</h2>
              <div className={`rounded-full px-3 py-1 text-xs font-semibold ${invalid ? 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'}`}>
                Total: {totalProbability}%
              </div>
            </div>

            <div className="mt-4 space-y-4">
              {rewards.map((reward, index) => (
                <div key={reward.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-sm font-semibold text-slate-500 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700">
                      {index + 1}
                    </div>
                    <div className="grid flex-1 gap-3 md:grid-cols-[1.2fr_0.5fr_1fr]">
                      <input
                        value={reward.name}
                        onChange={(e) => updateReward(reward.id, 'name', e.target.value)}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                      <div className="relative">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={reward.probability}
                          onChange={(e) => updateReward(reward.id, 'probability', e.target.value)}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 pr-8 text-sm text-slate-900 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        />
                        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-500">%</span>
                      </div>
                      <input
                        value={reward.metadata}
                        onChange={(e) => updateReward(reward.id, 'metadata', e.target.value)}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                    </div>
                    <div className="flex items-center gap-2 text-slate-400">
                      <button type="button" onClick={() => moveReward(index, -1)} className="rounded-lg border border-slate-200 p-2 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800" aria-label="Move up">
                        <ArrowUpDown className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => removeReward(reward.id)} className="rounded-lg border border-red-200 p-2 text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/50" aria-label="Delete reward">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button type="button" onClick={addReward} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2.5 text-sm font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200">
                <Plus className="h-4 w-4" />
                Ajouter une récompense
              </button>

              <div className="flex items-center gap-3 text-sm">
                <span className="text-slate-500 dark:text-slate-400">Probabilité restante</span>
                <span className={`font-semibold ${invalid ? 'text-red-600 dark:text-red-300' : 'text-emerald-600 dark:text-emerald-300'}`}>
                  {remaining}%
                </span>
              </div>
            </div>

            {invalid && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                La somme des probabilités dépasse 100 %. La campagne ne peut pas être publiée tant que la configuration est invalide.
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Configuration Google / réseaux sociaux</h2>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label htmlFor="google-maps-search" className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">Google Maps / Google Business</label>
                <div className="relative">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      id="google-maps-search"
                      role="combobox"
                      aria-autocomplete="list"
                      aria-expanded={placeSuggestions.length > 0}
                      aria-controls="google-place-suggestions"
                      aria-activedescendant={activeSuggestion >= 0 ? `google-place-option-${activeSuggestion}` : undefined}
                      value={googleMapsSearch}
                      onChange={(event) => {
                        setGoogleMapsSearch(event.target.value);
                        setGooglePlaceId(undefined);
                      }}
                      onKeyDown={handlePlaceInputKeyDown}
                      placeholder="Type a restaurant name in Tunisia"
                      autoComplete="off"
                      className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
                    />
                    <a
                      href={getGoogleMapsUrl(googleMapsSearch, googlePlaceId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-disabled={!googleMapsSearch.trim()}
                      className={`inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium dark:border-slate-700 ${googleMapsSearch.trim() ? 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800' : 'pointer-events-none opacity-50'}`}
                    >
                      <ExternalLink className="h-4 w-4" />
                      Open Maps
                    </a>
                  </div>

                  {(placeSuggestions.length > 0 || placesLoading || placesError) && (
                    <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
                      {placesLoading && <p className="px-4 py-3 text-sm text-slate-500">Searching restaurants in Tunisia...</p>}
                      {placesError && <p role="status" className="px-4 py-3 text-sm text-amber-700 dark:text-amber-300">{placesError}</p>}
                      {placeSuggestions.length > 0 && (
                        <>
                          <ul id="google-place-suggestions" role="listbox" aria-label="Google Maps places in Tunisia">
                            {placeSuggestions.map((suggestion, index) => (
                              <li key={suggestion.placeId} role="presentation">
                                <button
                                  id={`google-place-option-${index}`}
                                  type="button"
                                  role="option"
                                  aria-selected={index === activeSuggestion}
                                  onMouseEnter={() => setActiveSuggestion(index)}
                                  onClick={() => choosePlace(suggestion)}
                                  className={`w-full px-4 py-3 text-left ${index === activeSuggestion ? 'bg-slate-100 dark:bg-slate-800' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}
                                >
                                  <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">{suggestion.mainText}</span>
                                  {suggestion.secondaryText && <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{suggestion.secondaryText}</span>}
                                </button>
                              </li>
                            ))}
                          </ul>
                          <div className="border-t border-slate-200 px-4 py-2 text-right text-xs font-normal text-[#5e5e5e] dark:border-slate-700 dark:bg-white" translate="no">Google Maps</div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">Facebook</label>
                <input className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" defaultValue="https://facebook.com/merchant" />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">Instagram</label>
                <input className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" defaultValue="https://instagram.com/merchant" />
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Action requise</h2>
            <div className="mt-5">
              <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">Type d’action</label>
              <select
                value={action}
                onChange={(e) => setAction(e.target.value as CampaignConfigurationInput['action'])}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value="google-review">Google Review</option>
                <option value="instagram">Instagram</option>
                <option value="facebook">Facebook</option>
                <option value="newsletter">Newsletter</option>
                <option value="purchase">Purchase</option>
                <option value="none">No action</option>
              </select>
            </div>
            <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              Avant de tourner, le client doit compléter cette étape pour débloquer le tirage.
            </p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Enregistrer la configuration</h2>
              <div
                className={
                  configError
                    ? 'rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300'
                    : configMessage
                      ? 'rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                      : 'rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                }
              >
                {isLoadingConfig
                  ? 'Chargement…'
                  : configError
                    ? 'Erreur'
                    : configMessage
                      ? 'Enregistré'
                      : 'Modifications non enregistrées'}
              </div>
            </div>

            {configError && (
              <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                {configError}
              </p>
            )}
            {configMessage && !configError && (
              <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
                {configMessage}
              </p>
            )}
            {invalid && (
              <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                The total probability must not exceed 100% (currently {totalProbability}%).
              </p>
            )}

            <div className="mt-5 flex flex-wrap gap-3">
              <Button
                type="button"
                onClick={() => void handleSaveConfig()}
                disabled={invalid || isLoadingConfig || isSavingConfig}
                className="bg-indigo-600 text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {isSavingConfig ? 'Enregistrement…' : 'Enregistrer la configuration'}
              </Button>
              <button
                type="button"
                onClick={() => publicUrl && window.open(publicUrl, '_blank', 'noopener,noreferrer')}
                disabled={!publicUrl}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Prévisualiser
              </button>
            </div>
          </div>
        </section>

        <aside className="rounded-3xl border border-slate-200 bg-white p-5 shadow-soft dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Aperçu</h2>
            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">public</span>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4 dark:border-slate-700 dark:from-slate-900 dark:to-slate-950">
            <div className="flex items-center gap-3">
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-1 dark:border-slate-700">
                {logo ? <img src={logo} alt="preview logo" className="h-10 w-10 rounded-xl object-cover" /> : <div className="h-10 w-10 rounded-xl bg-slate-200" />}
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.25em] text-slate-500 dark:text-slate-400">Merchant</p>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Café du Centre</p>
              </div>
            </div>

            <div className="mt-5 text-center">
              <h3 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{description}</p>
            </div>

            <div className="mt-6 flex flex-col items-center justify-center gap-4">
              <div className="relative flex h-56 w-56 items-center justify-center">
                <div
                  className="relative flex h-52 w-52 items-center justify-center rounded-full border-[18px] border-slate-200 shadow-2xl shadow-amber-200/30 transition-transform duration-[2500ms] ease-[cubic-bezier(0.15,0.9,0.2,1)] dark:border-slate-700"
                  style={{
                    transform: `rotate(${rotation}deg)`,
                    background: wheelSegments.length
                      ? `conic-gradient(${wheelSegments
                          .map((segment) => `${segment.color} ${segment.start}deg ${segment.end}deg`)
                          .join(', ')})`
                      : '#f8fafc',
                  }}
                >
                  <div className="absolute inset-3 rounded-full border border-white/40 dark:border-slate-600/80" />
                  <div className="flex h-28 w-28 items-center justify-center rounded-full bg-white text-center shadow-inner dark:bg-slate-900">
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.28em] text-slate-500 dark:text-slate-400">Tourner</div>
                      <button
                        type="button"
                        onClick={handleSpin}
                        disabled={spinning || invalid}
                        className="mt-1 text-xl font-bold text-slate-900 transition hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-100 dark:hover:text-indigo-400"
                      >
                        Spin
                      </button>
                    </div>
                  </div>
                </div>
                <div className="absolute left-1/2 top-0 h-7 w-0.5 -translate-x-1/2 rounded-full bg-slate-900 dark:bg-slate-100" />
                <div className="absolute left-1/2 top-[-8px] h-0 w-0 -translate-x-1/2 border-x-[12px] border-b-[18px] border-x-transparent border-b-slate-900 dark:border-b-slate-100" />
              </div>

              <div className="min-h-[2.5rem] text-center text-sm text-slate-600 dark:text-slate-300">
                {spinning ? 'La roue tourne…' : winner ? `Gagnant : ${winner}` : 'Cliquez sur Spin pour tenter votre chance'}
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">URL publique</p>
                  <p className="mt-1 truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                    {publicUrl || 'Save the configuration to get a public link.'}
                  </p>
                  {copyMessage && <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">{copyMessage}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void copyPublicUrl()}
                    disabled={!publicUrl}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    aria-label="Copy public URL"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => publicUrl && window.open(publicUrl, '_blank', 'noopener,noreferrer')}
                    disabled={!publicUrl}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    aria-label="Open public URL"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
