'use client';

import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronUp, Copy, Dices, ExternalLink, Plus, Sparkles, Trash2, UploadCloud } from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton, SkeletonCard } from '@/components/ui/skeleton';
import { PrizeWheel } from '@/components/wheel/prize-wheel';
import { cn } from '@/lib/cn';
import { getGoogleMapsUrl } from '@/lib/google-maps';
import { interpolate, msg } from '@/lib/i18n';
import { prepareLogoUpload } from '@/lib/optimize-image';
import {
  DEFAULT_WHEEL_THEME,
  WHEEL_MOTION_PRESETS,
  gateAccentInk,
  NO_WIN_ARABIC_NOTE,
  segmentColorAt,
  wheelMotionDurationMs,
  type WheelMotionPreset,
  type WheelTheme,
} from '@/lib/wheel-theme';
import { useT } from '@/hooks/use-t';
import {
  CampaignConfigService,
  DEFAULT_PLAY_RULES,
  type CampaignConfigurationInput,
  type PlayRules,
  type RewardType,
} from '@/services/campaign-config.service';
import { RewardService } from '@/services/reward.service';
import { SettingsService, type WheelThemeState } from '@/services/settings.service';

interface PlaceSuggestion {
  placeId: string;
  label: string;
  mainText: string;
  secondaryText: string;
}

interface RewardRow {
  id: string;
  name: string;
  probability: number;
  metadata: string;
  type: RewardType;
  active: boolean;
}

const NO_WIN_REWARD_ID = 'no-win';

function createNoWinReward(): RewardRow {
  return {
    id: `${NO_WIN_REWARD_ID}-${crypto.randomUUID()}`,
    name: 'Prochaine fois',
    probability: 0,
    metadata: '',
    type: 'none',
    active: false,
  };
}

const initialRewards: RewardRow[] = [
  { id: 'r1', name: 'Prochaine visite', probability: 20, metadata: '-20% sur votre prochaine visite', type: 'custom_reward', active: true },
  { id: 'r2', name: 'Café offert', probability: 15, metadata: 'A emporter', type: 'custom_reward', active: true },
  { id: 'r3', name: '10% aujourd\u2019hui', probability: 10, metadata: 'Code valable aujourd\u2019hui', type: 'custom_reward', active: true },
  { id: 'r4', name: 'Points x2', probability: 20, metadata: 'Aujourd\u2019hui uniquement', type: 'custom_reward', active: true },
  { id: 'r5', name: 'Cadeau surprise', probability: 10, metadata: '\u00c0 choisir en caisse', type: 'custom_reward', active: true },
  { id: 'r6', name: 'Retentez votre chance', probability: 25, metadata: 'Bonus de relance', type: 'custom_reward', active: true },
  // Built-in no-win slice: listed for the merchant, off the wheel until activated.
  { id: NO_WIN_REWARD_ID, name: 'Prochaine fois', probability: 0, metadata: '', type: 'none', active: false },
];

/** The backend rejects a config with more than 20 rewards. */
const MAX_REWARDS = 20;

function clampNumber(raw: string, min: number, max: number): number {
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return min;
  return Math.min(max, Math.max(min, parsed));
}

export default function WheelConfigPage() {
  const t = useT();
  const [searchParams] = useSearchParams();
  const selectedCampaignId = searchParams.get('campaign') ?? undefined;
  const [loadedCampaignId, setLoadedCampaignId] = useState<string | undefined>(undefined);
  const [title, setTitle] = useState('Tentez votre chance \ud83c\udf89');
  const [description, setDescription] = useState('Tournez la roue et d\u00e9couvrez votre cadeau imm\u00e9diatement\u00a0!');
  const [logo, setLogo] = useState<string | null>(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  // Instant chosen-file previews (object URLs) shown while the upload
  // round-trip runs, so the merchant sees the new logo without a save + reload.
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [hubLogoPreview, setHubLogoPreview] = useState<string | null>(null);
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
  const [playRules, setPlayRules] = useState<PlayRules>(DEFAULT_PLAY_RULES);
  const [rewards, setRewards] = useState(initialRewards);
  // True until the loaded campaign is saved back: drives the Saved/Unsaved badge.
  const [dirty, setDirty] = useState(true);
  // Ids the server already knows about, so deleting a row issues a real DELETE.
  const [serverRewardIds, setServerRewardIds] = useState<ReadonlySet<string>>(new Set());
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner] = useState<string | null>(null);
  // Wheel design: server state + an editable draft, mirroring the shape the
  // settings API returns (plan gating, operator override, effective theme).
  const [themeState, setThemeState] = useState<WheelThemeState | null>(null);
  const [themeDraft, setThemeDraft] = useState<WheelTheme | null>(null);
  const [isLoadingTheme, setIsLoadingTheme] = useState(true);
  const [isSavingTheme, setIsSavingTheme] = useState(false);
  const [themeMessage, setThemeMessage] = useState('');
  const [themeError, setThemeError] = useState('');
  const [isUploadingWheelLogo, setIsUploadingWheelLogo] = useState(false);

  // Only activated rows sit on the wheel, so they alone carry the total.
  const activeRewards = useMemo(() => rewards.filter((reward) => reward.active), [rewards]);

  const totalProbability = useMemo(
    () => activeRewards.reduce((sum, reward) => sum + Number(reward.probability || 0), 0),
    [activeRewards],
  );

  const invalid = totalProbability > 100;
  const remaining = Math.max(100 - totalProbability, 0);

  // Load the persisted business logo on mount alongside campaign config.
  useEffect(() => {
    let cancelled = false;

    Promise.all([
      CampaignConfigService.load(selectedCampaignId),
      SettingsService.getSettings(),
    ])
      .then(([saved, settings]) => {
        if (cancelled) return;

        // Always apply the persisted business logo (empty string → null).
        setLogo(settings?.logo || null);

        if (!saved) {
          // New wheel: prefill the social fields from Settings → Integrations
          // so the merchant's saved Google Maps / Facebook / Instagram URLs
          // carry over to every next campaign without retyping them.
          setGoogleMapsSearch(settings?.googleMapsName || settings?.googleMapsUrl || '');
          setGooglePlaceId(settings?.googlePlaceId || undefined);
          setFacebookUrl(settings?.facebookUrl || '');
          setInstagramUrl(settings?.instagramUrl || '');
          return;
        }
        setTitle(saved.title);
        setDescription(saved.description);
        // Fall back to the saved integrations for any social field the
        // campaign never filled in (e.g. campaigns born from the modal).
        setGoogleMapsSearch(
          saved.googleMapsName || settings?.googleMapsName || settings?.googleMapsUrl || '',
        );
        setGooglePlaceId(saved.googlePlaceId || settings?.googlePlaceId || undefined);
        setFacebookUrl(saved.facebookUrl || settings?.facebookUrl || '');
        setInstagramUrl(saved.instagramUrl || settings?.instagramUrl || '');
        setAction(saved.action);
        setPlayRules(saved.playRules ?? DEFAULT_PLAY_RULES);
        setLoadedCampaignId(saved.id);
        setPublicUrl(`${window.location.origin}/wheels/${saved.publicCode}`);

        if (saved.rewards?.length) {
          const loaded: RewardRow[] = saved.rewards.map((reward) => ({
            id: reward.id ?? crypto.randomUUID(),
            name: reward.name,
            probability: Number.isFinite(Number(reward.weight)) ? Number(reward.weight) : 0,
            metadata: reward.description ?? '',
            type: reward.type ?? 'custom_reward',
            active: reward.active ?? true,
          }));

          // Older campaigns were saved before the no-win slot existed.
          let pushedNoWin = false;
          if (loaded.length < MAX_REWARDS && !loaded.some((reward) => reward.type === 'none')) {
            loaded.push(createNoWinReward());
            pushedNoWin = true;
          }

          setRewards(loaded);
          setDirty(pushedNoWin);
        } else {
          // The campaign exists but has no rewards: show a true empty state
          // instead of resurrecting the starter demo list.
          setRewards([]);
          setDirty(false);
        }
        setServerRewardIds(
          new Set((saved.rewards ?? []).map((reward) => reward.id).filter((id): id is string => Boolean(id))),
        );
        setConfigMessage('');
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

  // The design loads on its own: a missing business (404) only means the
  // Design section stays unavailable, not that campaign config failed.
  useEffect(() => {
    let cancelled = false;

    SettingsService.getWheelTheme()
      .then((state) => {
        if (cancelled) return;
        setThemeState(state);
        setThemeDraft(state.theme ?? state.effective);
      })
      .catch(() => {
        if (!cancelled) setThemeState(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingTheme(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

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
        playRules,
        rewards: rewards.map((reward) => ({
          id: reward.id,
          name: reward.name,
          description: reward.metadata,
          type: reward.type,
          value: 0,
          weight: Number(reward.probability || 0),
          active: reward.active,
        })),
      });
      setLoadedCampaignId(saved.id);
      setPublicUrl(`${window.location.origin}/wheels/${saved.publicCode}`);
      setConfigMessage(t.wheel.configSaved);
      setDirty(false);
      setServerRewardIds(new Set(rewards.map((reward) => reward.id)));
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : 'Unable to save campaign settings.');
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setIsUploadingLogo(true);
    setConfigError('');
    // Instant local preview while the upload round-trip runs.
    if (logoPreview) URL.revokeObjectURL(logoPreview);
    const previewUrl = URL.createObjectURL(file);
    setLogoPreview(previewUrl);
    try {
      const optimized = await prepareLogoUpload(file, msg(t, 'The logo must be 512 KB or smaller.'));
      const logoUrl = await SettingsService.uploadLogo(optimized);
      setLogo(logoUrl);
      setConfigMessage(t.wheel.logoUploaded);
    } catch (error) {
      setConfigError(msg(t, error instanceof Error ? error.message : 'Unable to upload the logo.'));
    } finally {
      URL.revokeObjectURL(previewUrl);
      setLogoPreview(null);
      setIsUploadingLogo(false);
    }
  };

  const handleRemoveLogo = async () => {
    if (!window.confirm(t.wheel.confirmRemoveLogo)) return;
    setIsUploadingLogo(true);
    setConfigError('');
    try {
      const logoUrl = await SettingsService.deleteLogo();
      setLogo(logoUrl || null);
      setConfigMessage(t.wheel.logoRemoved);
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : 'Unable to remove the logo.');
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const copyPublicUrl = async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopyMessage(t.wheel.linkCopied);
    } catch {
      setCopyMessage(t.wheel.linkCopyError);
    }
    window.setTimeout(() => setCopyMessage(''), 2500);
  };

  // Any local edit needs a Save: flip the badge to "Unsaved changes".
  const markDirty = () => {
    setDirty(true);
    setConfigMessage('');
  };

  const updateReward = (id: string, field: 'name' | 'probability' | 'metadata', value: string | number) => {
    markDirty();
    setRewards((current) =>
      current.map((reward) => {
        if (reward.id !== id) return reward;
        if (field !== 'probability') return { ...reward, [field]: value };

        const next = Number(value);
        const otherActiveProbability = current.reduce(
          (sum, item) => item.active && item.id !== id ? sum + Math.max(0, Number(item.probability) || 0) : sum,
          0,
        );
        const maximum = Math.max(0, 100 - otherActiveProbability);
        return { ...reward, probability: Number.isFinite(next) ? Math.min(Math.max(next, 0), maximum) : 0 };
      }),
    );
  };

  const rebalanceProbabilities = () => {
    if (totalProbability <= 100) return;

    markDirty();
    const activeWeights = activeRewards.map((reward, index) => ({
      id: reward.id,
      index,
      exact: Math.max(0, Number(reward.probability) || 0) * 100 / totalProbability,
    }));
    const rounded = activeWeights.map((item) => ({ ...item, probability: Math.floor(item.exact) }));
    const pointsToDistribute = 100 - rounded.reduce((sum, item) => sum + item.probability, 0);

    [...rounded]
      .sort((a, b) => (b.exact - b.probability) - (a.exact - a.probability) || a.index - b.index)
      .slice(0, pointsToDistribute)
      .forEach((item) => { item.probability += 1; });

    const probabilities = new Map(rounded.map((item) => [item.id, item.probability]));
    setRewards((current) => current.map((reward) => (
      reward.active && probabilities.has(reward.id)
        ? { ...reward, probability: probabilities.get(reward.id) ?? 0 }
        : reward
    )));
  };

  const toggleReward = (id: string) => {
    markDirty();
    setRewards((current) =>
      current.map((reward) => {
        if (reward.id !== id) return reward;
        return {
          ...reward,
          active: !reward.active,
          probability: Number.isFinite(reward.probability) ? reward.probability : 0,
        };
      }),
    );
  };

  const addReward = () => {
    if (rewards.length >= MAX_REWARDS) return;
    markDirty();
    setRewards((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        name: `Nouveau bonus ${current.length + 1}`,
        probability: Math.min(5, Math.max(0, 100 - totalProbability)),
        metadata: 'Nouvelle r\u00e9compense',
        type: 'custom_reward' as const,
        active: true,
      },
    ]);
  };

  // Deleting a row the server already knows removes it from the database
  // immediately (revisiting the page keeps it gone); purely local rows are
  // only dropped from the pending state.
  const removeReward = async (id: string) => {
    const snapshot = rewards;
    const isPersisted = serverRewardIds.has(id);

    setRewards((current) => current.filter((reward) => reward.id !== id));
    if (!isPersisted) return;

    setConfigError('');
    try {
      await RewardService.delete(id);
      setServerRewardIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      setConfigMessage(t.wheel.rewardDeleted);
    } catch (cause) {
      setRewards(snapshot);
      setConfigError(msg(t, cause instanceof Error ? cause.message : t.wheel.deleteRewardError));
    }
  };

  const loadExampleRewards = () => {
    markDirty();
    setRewards(initialRewards.map((reward) => ({ ...reward })));
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
    markDirty();
    setRewards(next);
  };

  // What the public wheel renders: the merchant's theme unless the operator
  // pinned one (or the plan is Starter, which the server resolves to default).
  const effectiveTheme = themeState?.effective ?? DEFAULT_WHEEL_THEME;

  const previewSegments = useMemo(
    () =>
      activeRewards.map((reward, index) => ({
        id: reward.id,
        label: reward.name,
        // Show the true odds: the backend spreads the spin over the prizes
        // that were entered, not over the remaining points up to 100.
        percent: totalProbability > 0 ? Math.round((reward.probability * 100) / totalProbability) : 0,
        color: segmentColorAt(index, effectiveTheme.colors.segments),
        angle: ((index + 0.5) * 360) / Math.max(activeRewards.length, 1),
        // The public wheel carries this note on the no-win slice; the preview
        // mirrors it so the merchant sees exactly what visitors will see.
        note: reward.type === 'none' ? NO_WIN_ARABIC_NOTE : undefined,
      })),
    [activeRewards, totalProbability, effectiveTheme],
  );

  const handleSpin = () => {
    if (!activeRewards.length || spinning) return;

    const weightedPool = activeRewards.map((reward) => ({ reward, weight: Number(reward.probability || 0) }));
    const total = weightedPool.reduce((sum, item) => sum + item.weight, 0);
    let random = Math.random() * total;

    const firstReward = activeRewards[0];
    if (!firstReward) return;
    let selectedReward = firstReward;
    for (const item of weightedPool) {
      random -= item.weight;
      if (random <= 0) {
        selectedReward = item.reward;
        break;
      }
    }

    const winningIndex = Math.max(0, activeRewards.findIndex((reward) => reward.id === selectedReward.id));
    const segmentAngle = 360 / Math.max(activeRewards.length, 1);
    const target = winningIndex * segmentAngle + segmentAngle / 2;
    const desired = (((-target % 360) + 360) % 360);
    const current = ((rotation % 360) + 360) % 360;
    const delta = ((((desired - current) % 360) + 360) % 360);

    setSpinning(true);
    setWinner(selectedReward.name);
    setRotation(rotation + 2160 + delta);
    window.setTimeout(() => setSpinning(false), wheelMotionDurationMs(effectiveTheme) + 100);
  };

  // Editable per plan flag: colors/motion need the design flag (Pro+)
  // and are pinned read-only while an operator override is in place; the hub
  // logo is the merchant's own brand asset, so it stays editable under an
  // override whenever the plan includes it (Pro+).
  const designAllowed = Boolean(themeState?.designAllowed);
  const centerLogoAllowed = Boolean(themeState?.centerLogoAllowed);
  const stepsColorAllowed = Boolean(themeState?.stepsColorAllowed);
  const designEditable = designAllowed && !themeState?.override;
  const logoEditable = centerLogoAllowed;
  // The gate step colour is the merchant's own brand asset: editable whenever
  // the plan includes it, even under an operator override.
  const stepsEditable = stepsColorAllowed;
  const editableTheme = designEditable || logoEditable || stepsEditable;

  const setDraftColors = (patch: Partial<WheelTheme['colors']>) => {
    if (!themeDraft) return;
    setThemeDraft({ ...themeDraft, colors: { ...themeDraft.colors, ...patch } });
  };

  const setStepsColor = (color: string) => {
    if (!themeDraft) return;
    setThemeDraft({ ...themeDraft, stepsColor: color });
  };

  const setSegmentColor = (index: number, color: string) => {
    if (!themeDraft) return;
    const segments = themeDraft.colors.segments.slice();
    segments[index] = color;
    setDraftColors({ segments });
  };

  const addSegmentColor = () => {
    if (!themeDraft || themeDraft.colors.segments.length >= 8) return;
    const next = themeDraft.colors.segments;
    setDraftColors({
      segments: [...next, DEFAULT_WHEEL_THEME.colors.segments[next.length % DEFAULT_WHEEL_THEME.colors.segments.length] ?? '#2dd4bf'],
    });
  };

  const removeSegmentColor = (index: number) => {
    if (!themeDraft || themeDraft.colors.segments.length <= 1) return;
    setDraftColors({ segments: themeDraft.colors.segments.filter((_, position) => position !== index) });
  };

  const refreshThemeState = async (): Promise<WheelThemeState> => {
    const refreshed = await SettingsService.getWheelTheme();
    setThemeState(refreshed);
    return refreshed;
  };

  const saveWheelTheme = async () => {
    if (!themeDraft || !editableTheme || isSavingTheme) return;
    setIsSavingTheme(true);
    setThemeMessage('');
    setThemeError('');
    try {
      await SettingsService.saveWheelTheme(themeDraft);
      const refreshed = await refreshThemeState();
      setThemeDraft(refreshed.theme ?? refreshed.effective);
      setThemeMessage(t.wheel.designSaved);
    } catch (error) {
      setThemeError(error instanceof Error ? error.message : t.wheel.designError);
    } finally {
      setIsSavingTheme(false);
    }
  };

  const handleWheelLogoUpload = async (file: File) => {
    if (!themeDraft || !logoEditable || isUploadingWheelLogo) return;
    setIsUploadingWheelLogo(true);
    setThemeMessage('');
    setThemeError('');
    // Instant local preview shown in the card and the wheel while the upload
    // + theme save run.
    if (hubLogoPreview) URL.revokeObjectURL(hubLogoPreview);
    const previewUrl = URL.createObjectURL(file);
    setHubLogoPreview(previewUrl);
    try {
      const optimized = await prepareLogoUpload(file, msg(t, 'The logo must be 512 KB or smaller.'));
      await SettingsService.uploadWheelLogo(optimized);
      // Persist the flag in the same flow: the public wheel only shows the hub
      // logo when the saved theme has centerLogo on, so a stale draft would
      // leave the freshly uploaded logo invisible until a manual save. Base the
      // save on the last *persisted* theme, never the dirty draft — an upload
      // must not silently commit unrelated unsaved color/motion edits.
      const base = themeState?.theme ?? themeState?.effective ?? DEFAULT_WHEEL_THEME;
      await SettingsService.saveWheelTheme({ ...base, centerLogo: true });
      const refreshed = await refreshThemeState();
      setThemeDraft(refreshed.theme ?? refreshed.effective);
      setThemeMessage(t.wheel.centerLogoUploaded);
    } catch (error) {
      setThemeError(msg(t, error instanceof Error ? error.message : t.wheel.designError));
    } finally {
      URL.revokeObjectURL(previewUrl);
      setHubLogoPreview(null);
      setIsUploadingWheelLogo(false);
    }
  };

  const handleWheelLogoRemove = async () => {
    if (!themeDraft || !logoEditable || isUploadingWheelLogo) return;
    setIsUploadingWheelLogo(true);
    setThemeMessage('');
    setThemeError('');
    try {
      await SettingsService.deleteWheelLogo();
      // Same as upload: clear the flag server-side so the public wheel stops
      // pointing at a deleted image without waiting for a manual save, and
      // without committing any unsaved draft edits.
      const base = themeState?.theme ?? themeState?.effective ?? DEFAULT_WHEEL_THEME;
      await SettingsService.saveWheelTheme({ ...base, centerLogo: false });
      const refreshed = await refreshThemeState();
      setThemeDraft(refreshed.theme ?? refreshed.effective);
      setThemeMessage(t.wheel.logoRemoved);
    } catch (error) {
      setThemeError(msg(t, error instanceof Error ? error.message : t.wheel.designError));
    } finally {
      setIsUploadingWheelLogo(false);
    }
  };

  const statusLabel = isLoadingConfig
    ? t.wheel.statusLoading
    : configError
      ? t.wheel.statusError
      : dirty
        ? t.wheel.statusUnsaved
        : t.wheel.statusSaved;

  const statusTone: BadgeTone = isLoadingConfig
    ? 'info'
    : configError
      ? 'danger'
      : dirty
        ? 'warning'
        : 'success';

  return (
    <div className="flex w-full max-w-full flex-col gap-6 overflow-x-clip">
      <PageHeader
        eyebrow={t.wheel.eyebrow}
        title={t.wheel.title}
        description={t.wheel.description}
        meta={
          <Badge tone={statusTone} size="sm" dot>
            {statusLabel}
          </Badge>
        }
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link to="/dashboard/overview">
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                {t.wheel.back}
              </Link>
            </Button>
            <Button
              size="sm"
              onClick={() => void handleSaveConfig()}
              disabled={invalid || isLoadingConfig || isSavingConfig}
              loading={isSavingConfig}
            >
              {isSavingConfig ? t.wheel.saving : t.wheel.save}
            </Button>
          </>
        }
      />

      {/* Both loads must settle before anything renders: the form and preview
          would otherwise flash the hardcoded demo defaults (title, sample
          rewards, default white wheel) for a few hundred ms on every
          refresh or navigation, then snap to the real configuration. */}
      {isLoadingConfig || isLoadingTheme ? (
        <div className="grid w-full min-w-0 grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div className="flex w-full min-w-0 flex-col gap-6 xl:order-1">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
          <aside className="order-first w-full min-w-0 xl:order-last xl:sticky xl:top-0 xl:self-start">
            <div className="rounded-xl border border-line bg-card p-5" role="status" aria-live="polite">
              <Skeleton className="mx-auto aspect-square w-full max-w-[460px] rounded-full" />
              <Skeleton className="mt-6 h-10 w-full" />
              <Skeleton className="mt-5 h-16 w-full" />
              <span className="sr-only">{t.wheel.statusLoading}</span>
            </div>
          </aside>
        </div>
      ) : (
      <div className="grid w-full min-w-0 grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="flex w-full min-w-0 flex-col gap-6 xl:order-1">
          {/* ── General info ───────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <p className="text-[13px] text-ink-subtle">{t.wheel.generalSection}</p>
              <CardTitle className="text-lg">{t.wheel.generalTitle}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <Field label={t.wheel.wheelTitle} htmlFor="wheel-title">
                <Input
                  id="wheel-title"
                  inputSize="lg"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </Field>

              <Field label={t.wheel.descriptionLabel} htmlFor="wheel-description">
                <Textarea
                  id="wheel-description"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>

              <Field label={t.wheel.logoLabel} hint={t.wheel.logoHint}>
                <div className="rounded-xl border border-dashed border-line-strong bg-surface-2/50 p-4">
                  <div className="flex items-center gap-4">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-elevated ring-1 ring-line">
                      {(logoPreview || logo) ? (
                        <img
                          src={logoPreview ?? logo ?? undefined}
                          alt={t.wheel.logoAlt}
                          className="h-full w-full object-contain"
                          onError={() => {
                            if (logoPreview) {
                              URL.revokeObjectURL(logoPreview);
                              setLogoPreview(null);
                            } else {
                              setLogo(null);
                            }
                          }}
                        />
                      ) : (
                        <UploadCloud className="h-5 w-5 text-ink-subtle" aria-hidden />
                      )}
                    </div>
                    <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-ink-subtle">
                      {t.wheel.logoDisplayHint}
                    </p>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <label className={cn(
                      'inline-flex h-9 cursor-pointer select-none items-center gap-2 rounded-md bg-ink px-3 text-[13px] font-medium text-surface transition-colors duration-180 ease-swift hover:bg-ink/90 dark:bg-ink-inverse dark:text-surface-2 dark:hover:bg-ink-inverse/90',
                      isUploadingLogo && 'pointer-events-none opacity-60',
                    )}>
                      <UploadCloud className="h-4 w-4" aria-hidden />
                      {isUploadingLogo ? t.wheel.uploadingLogo : t.wheel.logoUploadButton}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/svg+xml,image/webp"
                        className="sr-only"
                        disabled={isUploadingLogo}
                        onChange={(e) => void handleFileUpload(e)}
                      />
                    </label>
                    {logo && !isUploadingLogo ? (
                      <Button variant="outline" size="sm" onClick={() => void handleRemoveLogo()}>
                        {t.wheel.logoRemoveButton}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </Field>

              {centerLogoAllowed && themeDraft ? (
                <Field label={t.wheel.centerLogoLabel} hint={t.wheel.centerLogoHint}>
                  <div className="rounded-xl border border-dashed border-line-strong bg-surface-2/50 p-4">
                    <label className={cn(
                      'flex cursor-pointer items-center gap-3',
                      !logoEditable && 'pointer-events-none opacity-60',
                    )}>
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0 cursor-pointer rounded border-line-strong accent-brand-600"
                        checked={themeDraft.centerLogo}
                        disabled={!logoEditable}
                        onChange={(event) => setThemeDraft({ ...themeDraft, centerLogo: event.target.checked })}
                      />
                      <span className="text-[13px] font-medium text-ink">{t.wheel.centerLogoToggle}</span>
                    </label>
                    {(hubLogoPreview || themeState?.centerLogo) ? (
                      <div className="mt-4 flex items-center gap-4">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-elevated ring-1 ring-line">
                          <img
                            src={hubLogoPreview || themeState?.centerLogo || undefined}
                            alt={t.wheel.logoAlt}
                            className="h-full w-full object-contain"
                            onError={() => {
                              if (hubLogoPreview) {
                                URL.revokeObjectURL(hubLogoPreview);
                                setHubLogoPreview(null);
                              }
                            }}
                          />
                        </div>
                      </div>
                    ) : null}
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <label className={cn(
                        'inline-flex h-9 cursor-pointer select-none items-center gap-2 rounded-md bg-ink px-3 text-[13px] font-medium text-surface transition-colors duration-180 ease-swift hover:bg-ink/90 disabled:pointer-events-none disabled:opacity-60 dark:bg-ink-inverse dark:text-surface-2 dark:hover:bg-ink-inverse/90',
                        !logoEditable && 'pointer-events-none opacity-60',
                      )}>
                        <UploadCloud className="h-4 w-4" aria-hidden />
                        {isUploadingWheelLogo ? t.wheel.centerLogoUploading : t.wheel.centerLogoUpload}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/svg+xml,image/webp"
                          className="sr-only"
                          disabled={!logoEditable || isUploadingWheelLogo}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) void handleWheelLogoUpload(file);
                            event.target.value = '';
                          }}
                        />
                      </label>
                      {themeDraft.centerLogo ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!logoEditable || isUploadingWheelLogo}
                          onClick={() => void handleWheelLogoRemove()}
                        >
                          {t.wheel.centerLogoRemove}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </Field>
              ) : null}

              {stepsColorAllowed && themeDraft ? (
                <Field label={t.wheel.stepsColorLabel} hint={t.wheel.stepsColorHint} htmlFor="wheel-steps-color">
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      id="wheel-steps-color"
                      type="color"
                      aria-label={t.wheel.stepsColorLabel}
                      className="h-10 w-14 shrink-0 cursor-pointer rounded-md border border-line bg-elevated p-1 disabled:cursor-not-allowed"
                      value={themeDraft.stepsColor}
                      disabled={!stepsEditable}
                      onChange={(event) => setStepsColor(event.target.value)}
                    />
                    <Input
                      aria-label={t.wheel.stepsColorLabel}
                      className="numeric w-32"
                      value={themeDraft.stepsColor}
                      disabled={!stepsEditable}
                      onChange={(event) => setStepsColor(event.target.value)}
                    />
                    <span className="flex items-center gap-2" aria-hidden>
                      <span
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-semibold"
                        style={{ backgroundColor: themeDraft.stepsColor, color: gateAccentInk(themeDraft.stepsColor) }}
                      >
                        1
                      </span>
                      <span
                        className="inline-flex h-7 items-center rounded-full px-3 text-[12px] font-semibold"
                        style={{ backgroundColor: themeDraft.stepsColor, color: gateAccentInk(themeDraft.stepsColor) }}
                      >
                        {t.wheel.stepsColorPreviewButton}
                      </span>
                    </span>
                  </div>
                </Field>
              ) : null}

              {(centerLogoAllowed || stepsColorAllowed) && !designAllowed ? (
                <>
                  {themeMessage ? (
                    <p className="text-[12.5px] font-medium text-success-600 dark:text-success-300">{themeMessage}</p>
                  ) : null}
                  {themeError ? (
                    <p className="text-[12.5px] font-medium text-danger-600 dark:text-danger-300">{themeError}</p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      disabled={!editableTheme || isSavingTheme}
                      loading={isSavingTheme}
                      onClick={() => void saveWheelTheme()}
                    >
                      {isSavingTheme ? t.wheel.designSaving : t.wheel.designSave}
                    </Button>
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>

          {/* ── Design ─────────────────────────────────────────────────── */}
          {/* Colors/motion need Pro+. The hub logo is edited in Informations
              générales above; Starter sees neither. */}
          {designAllowed || (!isLoadingTheme && !themeState) ? (
            <Card data-testid="wheel-design-section">
              <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
                <div className="space-y-1">
                  <p className="text-[13px] text-ink-subtle">{t.wheel.designSection}</p>
                  <CardTitle className="text-lg">{t.wheel.designTitle}</CardTitle>
                </div>
                {themeState && designAllowed ? (
                  <Badge tone={themeState.override ? 'info' : 'success'} size="sm" dot>
                    {themeState.override ? t.wheel.designOverrideBadge : t.wheel.designActiveBadge}
                  </Badge>
                ) : null}
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                {isLoadingTheme ? (
                  <p className="text-[13px] text-ink-subtle">{t.wheel.designLoading}</p>
                ) : !themeState || !themeDraft ? (
                  <p className="text-[13px] font-medium text-danger-600 dark:text-danger-300">
                    {t.wheel.designLoadError}
                  </p>
                ) : (
                  <>
                    {themeState.override ? (
                      <div
                        className="rounded-xl border border-info-300/50 bg-info-50 p-3 text-[12.5px] leading-relaxed text-info-800 dark:border-info-900/60 dark:bg-info-900/30 dark:text-info-200"
                        data-testid="wheel-design-override"
                      >
                        {t.wheel.designOverrideBanner}
                      </div>
                    ) : null}

                    <Field label={t.wheel.segmentsLabel}>
                      <div className="flex flex-col gap-2">
                        {themeDraft.colors.segments.map((color, index) => (
                          <div key={index} className="flex items-center gap-3">
                            <input
                              type="color"
                              aria-label={interpolate(t.wheel.segmentColorAria, { index: index + 1 })}
                              className="h-10 w-14 shrink-0 cursor-pointer rounded-md border border-line bg-elevated p-1 disabled:cursor-not-allowed"
                              value={color}
                              disabled={!designEditable}
                              onChange={(event) => setSegmentColor(index, event.target.value)}
                            />
                            <Input
                              aria-label={interpolate(t.wheel.segmentColorValue, { index: index + 1 })}
                              className="numeric flex-1"
                              value={color}
                              disabled={!designEditable}
                              onChange={(event) => setSegmentColor(index, event.target.value)}
                            />
                            {themeDraft.colors.segments.length > 1 ? (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={interpolate(t.wheel.segmentRemove, { index: index + 1 })}
                                title={interpolate(t.wheel.segmentRemove, { index: index + 1 })}
                                className="text-ink-subtle hover:text-danger-600 dark:hover:text-danger-300"
                                disabled={!designEditable}
                                onClick={() => removeSegmentColor(index)}
                              >
                                <Trash2 className="h-4 w-4" aria-hidden />
                              </Button>
                            ) : null}
                          </div>
                        ))}
                        {themeDraft.colors.segments.length < 8 ? (
                          <div>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={!designEditable}
                              onClick={addSegmentColor}
                            >
                              <Plus className="h-4 w-4" aria-hidden />
                              {t.wheel.segmentsAdd}
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    </Field>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label={t.wheel.rimColorLabel} htmlFor="wheel-rim-color">
                        <div className="flex items-center gap-3">
                          <input
                            id="wheel-rim-color"
                            type="color"
                            aria-label={t.wheel.rimColorLabel}
                            className="h-10 w-14 shrink-0 cursor-pointer rounded-md border border-line bg-elevated p-1"
                            value={themeDraft.colors.rim}
                            disabled={!designEditable}
                            onChange={(event) => setDraftColors({ rim: event.target.value })}
                          />
                          <Input
                            aria-label={t.wheel.rimColorLabel}
                            className="numeric flex-1"
                            value={themeDraft.colors.rim}
                            disabled={!designEditable}
                            onChange={(event) => setDraftColors({ rim: event.target.value })}
                          />
                        </div>
                      </Field>
                      <Field label={t.wheel.pointerColorLabel} htmlFor="wheel-pointer-color">
                        <div className="flex items-center gap-3">
                          <input
                            id="wheel-pointer-color"
                            type="color"
                            aria-label={t.wheel.pointerColorLabel}
                            className="h-10 w-14 shrink-0 cursor-pointer rounded-md border border-line bg-elevated p-1"
                            value={themeDraft.colors.pointer}
                            disabled={!designEditable}
                            onChange={(event) => setDraftColors({ pointer: event.target.value })}
                          />
                          <Input
                            aria-label={t.wheel.pointerColorLabel}
                            className="numeric flex-1"
                            value={themeDraft.colors.pointer}
                            disabled={!designEditable}
                            onChange={(event) => setDraftColors({ pointer: event.target.value })}
                          />
                        </div>
                      </Field>
                    </div>

                    <Field label={t.wheel.motionLabel} htmlFor="wheel-motion">
                      <Select
                        id="wheel-motion"
                        value={themeDraft.motion.preset}
                        disabled={!designEditable}
                        onChange={(event) =>
                          setThemeDraft({
                            ...themeDraft,
                            motion: { preset: event.target.value as WheelMotionPreset },
                          })
                        }
                      >
                        {WHEEL_MOTION_PRESETS.map((preset) => (
                          <option key={preset} value={preset}>
                            {preset === 'fast'
                              ? t.wheel.motionFast
                              : preset === 'slow'
                                ? t.wheel.motionSlow
                                : t.wheel.motionStandard}
                          </option>
                        ))}
                      </Select>
                    </Field>

                    {themeMessage ? (
                      <p className="text-[12.5px] font-medium text-success-600 dark:text-success-300">{themeMessage}</p>
                    ) : null}
                    {themeError ? (
                      <p className="text-[12.5px] font-medium text-danger-600 dark:text-danger-300">{themeError}</p>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        disabled={!editableTheme || isSavingTheme}
                        loading={isSavingTheme}
                        onClick={() => void saveWheelTheme()}
                      >
                        {isSavingTheme ? t.wheel.designSaving : t.wheel.designSave}
                      </Button>
                      {themeState.override ? (
                        <span className="text-[12px] text-ink-subtle">{t.wheel.designOverrideHint}</span>
                      ) : null}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ) : null}

          {/* ── Rewards ─────────────────────────────────────────────────── */}
          <Card>
            <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
              <div className="space-y-1">
                <p className="text-[13px] text-ink-subtle">{t.wheel.rewardsSection}</p>
                <CardTitle className="text-lg">{t.wheel.rewardsTitle}</CardTitle>
              </div>
              <Badge tone={invalid ? 'danger' : 'success'} size="sm" dot>
                Total: {totalProbability}%
              </Badge>
            </CardHeader>

            <CardContent className="flex flex-col gap-4">
              {rewards.length === 0 && !isLoadingConfig ? (
                <div
                  data-testid="rewards-empty"
                  className="rounded-xl border border-dashed border-line bg-surface-2/40 p-6 text-center"
                >
                  <p className="text-[13.5px] text-ink-subtle">{t.wheel.rewardsEmpty}</p>
                  <div className="mt-3">
                    <Button size="sm" variant="outline" onClick={loadExampleRewards}>
                      <Sparkles className="h-4 w-4" aria-hidden />
                      {t.wheel.loadExample}
                    </Button>
                  </div>
                </div>
              ) : null}

              <ul className="flex flex-col gap-3">
                {rewards.map((reward, index) => {
                  const isNoWin = reward.type === 'none';
                  const probabilityLocked = isNoWin && !reward.active;
                  const sliceIndex = reward.active
                    ? activeRewards.findIndex((item) => item.id === reward.id)
                    : -1;
                  const sliceColor = sliceIndex >= 0 ? segmentColorAt(sliceIndex, effectiveTheme.colors.segments) : undefined;

                  return (
                    <li
                      key={reward.id}
                      className={cn(
                        'min-w-0 rounded-xl border border-line bg-surface-2/40 p-3 transition-colors duration-180 ease-swift',
                        probabilityLocked && 'opacity-70',
                      )}
                    >
                      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center">
                        {/* Mobile: badge + action buttons in a single row */}
                        <div className="flex min-w-0 flex-wrap items-center gap-2 lg:contents">
                          <span
                            aria-hidden
                            className={cn(
                              'numeric flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[12px] font-semibold',
                              sliceColor ? 'text-white' : 'bg-ink/[0.06] text-ink-subtle',
                            )}
                            style={sliceColor ? { backgroundColor: sliceColor } : undefined}
                          >
                            {index + 1}
                          </span>

                          {/* Action buttons — visible inline on mobile next to badge */}
                          <div className="ml-auto flex items-center gap-1.5 lg:hidden">
                            {isNoWin ? (
                              <button
                                type="button"
                                role="switch"
                                aria-checked={reward.active}
                                aria-label={interpolate(t.wheel.activateReward, { name: reward.name })}
                                onClick={() => toggleReward(reward.id)}
                                className={cn(
                                  'inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold transition-colors duration-180 ease-swift',
                                  reward.active
                                    ? 'border-success-600/25 bg-success-100 text-success-800 dark:bg-success-900/45 dark:text-success-200'
                                    : 'border-line bg-elevated text-ink-subtle',
                                )}
                              >
                                <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', reward.active ? 'bg-success-600 dark:bg-success-300' : 'bg-ink-subtle')} />
                                {reward.active ? t.wheel.rewardActive : t.wheel.rewardInactive}
                              </button>
                            ) : null}
                            <Button
                              variant="outline"
                              size="icon-sm"
                              onClick={() => moveReward(index, -1)}
                              aria-label={t.wheel.moveUp}
                              title={t.wheel.moveUp}
                              className="text-ink-subtle"
                            >
                              <ChevronUp className="h-4 w-4" aria-hidden />
                            </Button>
                            {!isNoWin ? (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => removeReward(reward.id)}
                                aria-label={interpolate(t.wheel.deleteReward, { name: reward.name })}
                                className="text-ink-subtle hover:text-danger-600 dark:hover:text-danger-300"
                              >
                                <Trash2 className="h-4 w-4" aria-hidden />
                              </Button>
                            ) : null}
                          </div>
                        </div>

                        {/* Inputs — full width on mobile, side-by-side on md+ */}
                        <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_5rem_minmax(0,1fr)] lg:grid-cols-[minmax(0,1.15fr)_minmax(5.25rem,0.7fr)_minmax(0,1fr)]">
                          <Input
                            inputSize="lg"
                            dir="auto"
                            value={reward.name}
                            onChange={(e) => updateReward(reward.id, 'name', e.target.value)}
                            aria-label={interpolate(t.wheel.rewardName, { n: index + 1 })}
                            className="font-medium"
                          />
                          <div className="relative">
                            <Input
                              type="number"
                              inputMode="numeric"
                              inputSize="sm"
                              min={0}
                              max={Math.max(0, 100 - (totalProbability - (reward.active ? reward.probability : 0)))}
                              step={1}
                              value={reward.probability}
                              disabled={probabilityLocked}
                              placeholder="0"
                              aria-label={interpolate(t.wheel.rewardProbability, { name: reward.name })}
                              onChange={(e) => updateReward(reward.id, 'probability', e.target.value)}
                              className="numeric pr-7 text-right text-[14px] font-semibold [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            />
                            <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[12px] font-semibold text-ink-subtle">
                              %
                            </span>
                          </div>
                          <Input
                            inputSize="sm"
                            value={reward.metadata}
                            onChange={(e) => updateReward(reward.id, 'metadata', e.target.value)}
                            aria-label={interpolate(t.wheel.rewardDescription, { name: reward.name })}
                            className="sm:col-span-1 col-span-full"
                          />
                        </div>

                        {/* Desktop-only action buttons */}
                        <div className="hidden items-center gap-1.5 lg:flex lg:shrink-0">
                          {isNoWin ? (
                            <button
                              type="button"
                              role="switch"
                              aria-checked={reward.active}
                              aria-label={interpolate(t.wheel.activateReward, { name: reward.name })}
                              onClick={() => toggleReward(reward.id)}
                              className={cn(
                                'inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[11.5px] font-semibold transition-colors duration-180 ease-swift',
                                reward.active
                                  ? 'border-success-600/25 bg-success-100 text-success-800 dark:bg-success-900/45 dark:text-success-200'
                                  : 'border-line bg-elevated text-ink-subtle hover:text-ink',
                              )}
                            >
                              <span
                                aria-hidden
                                className={cn(
                                  'h-1.5 w-1.5 rounded-full transition-colors duration-180',
                                  reward.active ? 'bg-success-600 dark:bg-success-300' : 'bg-ink-subtle',
                                )}
                              />
                              {reward.active ? t.wheel.rewardActive : t.wheel.rewardInactive}
                            </button>
                          ) : null}
                          <Button
                            variant="outline"
                            size="icon-sm"
                            onClick={() => moveReward(index, -1)}
                            aria-label={t.wheel.moveUp}
                            title={t.wheel.moveUp}
                            className="text-ink-subtle"
                          >
                            <ChevronUp className="h-4 w-4" aria-hidden />
                          </Button>
                          {!isNoWin ? (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => removeReward(reward.id)}
                              aria-label={interpolate(t.wheel.deleteReward, { name: reward.name })}
                              title={interpolate(t.wheel.deleteReward, { name: reward.name })}
                              className="text-ink-subtle hover:text-danger-600 dark:hover:text-danger-300"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden />
                            </Button>
                          ) : null}
                        </div>
                      </div>

                      {isNoWin ? (
                        <p className="mt-3 text-[12.5px] leading-relaxed text-ink-subtle sm:pl-11">
                          {t.wheel.noWinHint}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>

              <div className="flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-3">
                  <Button size="sm" onClick={addReward}>
                    <Plus className="h-4 w-4" aria-hidden />
                    {t.wheel.addReward}
                  </Button>
                  <span className="numeric text-[12.5px] text-ink-subtle">
                    {interpolate(t.wheel.activeCount, { active: activeRewards.length, total: rewards.length, max: MAX_REWARDS })}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[13px]">
                  <span className="text-ink-subtle">{t.wheel.remainingProbability}</span>
                  <span
                    className={cn(
                      'numeric font-semibold',
                      invalid ? 'text-danger-600 dark:text-danger-300' : 'text-success-600 dark:text-success-300',
                    )}
                  >
                    {remaining}%
                  </span>
                </div>
              </div>

              {invalid ? (
                <div className="flex flex-col items-start gap-2 rounded-lg border border-danger-300/60 bg-danger-50 p-3.5 text-[13px] leading-relaxed text-danger-800 dark:border-danger-900/60 dark:bg-danger-900/30 dark:text-danger-200">
                  <p>{t.wheel.overflowTitle}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={rebalanceProbabilities}
                    className="border-danger-300 bg-elevated text-danger-700 hover:bg-danger-100 dark:border-danger-800 dark:text-danger-300 dark:hover:bg-danger-950"
                  >
                    {t.wheel.rebalance}
                  </Button>
                </div>
              ) : null}

              {!invalid && rewards.length > 0 && (activeRewards.length === 0 || totalProbability === 0) ? (
                <p
                  role="status"
                  data-testid="zero-warning"
                  className="rounded-lg border border-warning-300/60 bg-warning-50 px-3.5 py-2.5 text-[13px] leading-relaxed text-warning-700 dark:border-warning-900/60 dark:bg-warning-900/30 dark:text-warning-300"
                >
                  {t.wheel.zeroProbabilityWarning}
                </p>
              ) : null}
            </CardContent>
          </Card>

          {/* ── Google Maps & social ─────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <p className="text-[13px] text-ink-subtle">{t.wheel.socialSection}</p>
              <CardTitle className="text-lg">{t.wheel.socialTitle}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Field label={t.wheel.googleMapsLabel} htmlFor="google-maps-search">
                <div className="relative">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      id="google-maps-search"
                      inputSize="sm"
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
                      placeholder={t.wheel.googleMapsPlaceholder}
                      autoComplete="off"
                      className="min-w-0 flex-1"
                    />
                    {googlePlaceId ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setGoogleMapsSearch('');
                          setGooglePlaceId(undefined);
                          setPlaceSuggestions([]);
                        }}
                      >
                        {t.wheel.clearPlace}
                      </Button>
                    ) : (
                      <a
                        href={getGoogleMapsUrl(googleMapsSearch, googlePlaceId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-disabled={!googleMapsSearch.trim()}
                        className={cn(
                          'inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border px-3 text-[13px] font-medium transition-colors duration-180 ease-swift',
                          googleMapsSearch.trim()
                            ? 'border-line-strong text-ink hover:border-accent hover:bg-accent-soft'
                            : 'pointer-events-none border-line text-ink-subtle opacity-60',
                        )}
                      >
                        <ExternalLink className="h-4 w-4" aria-hidden />
                        {t.wheel.openLink}
                      </a>
                    )}
                  </div>

                  {(placeSuggestions.length > 0 || placesLoading || placesError) ? (
                    <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-md border border-line bg-elevated shadow-pop">
                      {placesLoading ? (
                        <p className="px-3.5 py-2.5 text-[13px] text-ink-subtle">{t.common.loading}</p>
                      ) : null}
                      {placesError ? (
                        <p role="status" className="px-3.5 py-2.5 text-[13px] font-medium text-warning-700 dark:text-warning-300">
                          {placesError}
                        </p>
                      ) : null}
                      {placeSuggestions.length > 0 ? (
                        <>
                          <ul id="google-place-suggestions" role="listbox" aria-label={t.wheel.googleMapsLabel}>
                            {placeSuggestions.map((suggestion, index) => (
                              <li key={suggestion.placeId} role="presentation">
                                <button
                                  id={`google-place-option-${index}`}
                                  type="button"
                                  role="option"
                                  aria-selected={index === activeSuggestion}
                                  onMouseEnter={() => setActiveSuggestion(index)}
                                  onClick={() => choosePlace(suggestion)}
                                  className={cn(
                                    'w-full px-3.5 py-2.5 text-left transition-colors duration-150',
                                    index === activeSuggestion
                                      ? 'bg-accent-soft text-brand-800 dark:bg-accent-soft dark:text-accent-bright'
                                      : 'text-ink hover:bg-ink/[0.045]',
                                  )}
                                >
                                  <span className="block text-[13px] font-medium">{suggestion.mainText}</span>
                                  {suggestion.secondaryText ? (
                                    <span className="mt-0.5 block text-[12px] text-ink-subtle">
                                      {suggestion.secondaryText}
                                    </span>
                                  ) : null}
                                </button>
                              </li>
                            ))}
                          </ul>
                          <div className="border-t border-line px-3.5 py-1.5 text-right text-[11px] text-[#5e5e5e]" translate="no">
                            Google Maps
                          </div>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t.wheel.facebookLabel} htmlFor="wheel-facebook">
                  <Input
                    id="wheel-facebook"
                    inputSize="sm"
                    type="url"
                    value={facebookUrl}
                    placeholder={t.wheel.facebookPlaceholder}
                    onChange={(e) => setFacebookUrl(e.target.value)}
                  />
                </Field>
                <Field label={t.wheel.instagramLabel} htmlFor="wheel-instagram">
                  <Input
                    id="wheel-instagram"
                    inputSize="sm"
                    type="url"
                    value={instagramUrl}
                    placeholder={t.wheel.instagramPlaceholder}
                    onChange={(e) => setInstagramUrl(e.target.value)}
                  />
                </Field>
              </div>

              <Field label={t.wheel.actionLabel} htmlFor="wheel-action">
                <Select
                  id="wheel-action"
                  value={action}
                  onChange={(e) => setAction(e.target.value as CampaignConfigurationInput['action'])}
                >
                  <option value="none">{t.wheel.actionNoneLabel}</option>
                  <option value="google-review">{t.wheel.actionGoogleLabel}</option>
                  <option value="facebook">{t.wheel.actionFacebookLabel}</option>
                  <option value="instagram">{t.wheel.actionInstagramLabel}</option>
                </Select>
              </Field>
            </CardContent>
          </Card>

          {/* ── Play rules ───────────────────────────────────────────────── */}
          <Card>
            <CardHeader className="space-y-1">
              <CardTitle>{t.wheel.rulesTitle}</CardTitle>
              <p className="text-[12.5px] text-ink-subtle">{t.wheel.rulesDescription}</p>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <Field
                label={t.wheel.rulesModeLabel}
                htmlFor="wheel-rules-mode"
                hint={playRules.mode === 'windowed' ? t.wheel.rulesWindowedHint : t.wheel.rulesOnceHint}
              >
                <Select
                  id="wheel-rules-mode"
                  value={playRules.mode}
                  onChange={(e) =>
                    setPlayRules((current) => ({ ...current, mode: e.target.value as PlayRules['mode'] }))
                  }
                >
                  <option value="once">{t.wheel.rulesModeOnce}</option>
                  <option value="windowed">{t.wheel.rulesModeWindowed}</option>
                </Select>
              </Field>

              {playRules.mode === 'windowed' ? (
                <>
                  <Field
                    label={t.wheel.rulesPerDayLabel}
                    htmlFor="wheel-rules-per-day"
                    hint={t.wheel.rulesPerDayHint}
                  >
                    <Input
                      id="wheel-rules-per-day"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={20}
                      value={playRules.perDay}
                      onChange={(e) =>
                        setPlayRules((current) => ({
                          ...current,
                          perDay: clampNumber(e.target.value, 1, 20),
                        }))
                      }
                    />
                  </Field>

                  <Field
                    label={t.wheel.rulesCooldownLabel}
                    htmlFor="wheel-rules-cooldown"
                    hint={t.wheel.rulesCooldownHint}
                  >
                    <Input
                      id="wheel-rules-cooldown"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={10080}
                      value={playRules.cooldownMinutes}
                      onChange={(e) =>
                        setPlayRules((current) => ({
                          ...current,
                          cooldownMinutes: clampNumber(e.target.value, 0, 10080),
                        }))
                      }
                    />
                  </Field>

                  <Field
                    label={t.wheel.rulesIpCapLabel}
                    htmlFor="wheel-rules-ip-cap"
                    hint={t.wheel.rulesIpCapHint}
                  >
                    <Input
                      id="wheel-rules-ip-cap"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={1000}
                      value={playRules.maxPlaysPerIpDay}
                      onChange={(e) =>
                        setPlayRules((current) => ({
                          ...current,
                          maxPlaysPerIpDay: clampNumber(e.target.value, 0, 1000),
                        }))
                      }
                    />
                  </Field>

                  <Field
                    label={t.wheel.rulesWinBudgetLabel}
                    htmlFor="wheel-rules-win-budget"
                    hint={t.wheel.rulesWinBudgetHint}
                  >
                    <Input
                      id="wheel-rules-win-budget"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={100}
                      value={playRules.winBudget}
                      onChange={(e) =>
                        setPlayRules((current) => ({
                          ...current,
                          winBudget: clampNumber(e.target.value, 0, 100),
                        }))
                      }
                    />
                  </Field>
                </>
              ) : null}
            </CardContent>
          </Card>

          {/* ── Public link ─────────────────────────────────────────────── */}
          <Card>
            <CardHeader className="space-y-1">
              <CardTitle>{t.wheel.publicLinkTitle}</CardTitle>
              <p className="text-[12.5px] text-ink-subtle">{t.wheel.publicLinkDescription}</p>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {configError ? (
                <p className="rounded-lg border border-danger-300/60 bg-danger-50 p-3 text-[13px] text-danger-800 dark:border-danger-900/60 dark:bg-danger-900/30 dark:text-danger-200">
                  {configError}
                </p>
              ) : null}
              {configMessage && !configError ? (
                <p className="rounded-lg border border-success-300/60 bg-success-50 p-3 text-[13px] text-success-800 dark:border-success-900/60 dark:bg-success-900/25 dark:text-success-200">
                  {configMessage}
                </p>
              ) : null}
              {invalid ? (
                <p className="rounded-lg border border-danger-300/60 bg-danger-50 p-3 text-[13px] text-danger-800 dark:border-danger-900/60 dark:bg-danger-900/30 dark:text-danger-200">
                  {t.wheel.overflowTitle}
                </p>
              ) : null}

              <div className="border-t border-line pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => publicUrl && window.open(publicUrl, '_blank', 'noopener,noreferrer')}
                  disabled={!publicUrl}
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  {t.wheel.openLink}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Preview sidebar ──────────────────────────────────────────── */}
        <aside className="order-first w-full min-w-0 xl:order-last xl:sticky xl:top-0 xl:self-start">
          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
              <div className="min-w-0 space-y-1">
                <p className="text-[13px] text-ink-subtle">{t.wheel.previewSection}</p>
                <CardTitle className="text-lg">{t.wheel.previewTitle}</CardTitle>
              </div>
              <Badge tone="brand" size="sm" className="shrink-0">
                public
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="rounded-xl border border-line bg-surface-2/60 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-elevated ring-1 ring-line">
                    {(logoPreview || logo) ? (
                      <img
                        src={logoPreview ?? logo ?? undefined}
                        alt={t.wheel.logoPreviewAlt}
                        className="h-full w-full object-contain"
                        onError={() => {
                          if (logoPreview) {
                            URL.revokeObjectURL(logoPreview);
                            setLogoPreview(null);
                          } else {
                            setLogo(null);
                          }
                        }}
                      />
                    ) : (
                      <span className="h-full w-full bg-ink/[0.06]" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-semibold text-ink">{title}</p>
                    <p className="mt-0.5 max-w-[28ch] truncate text-[12px] text-ink-muted">{description}</p>
                  </div>
                </div>

                <div className="mt-6 flex flex-col items-center gap-4">
                  <PrizeWheel
                    segments={previewSegments}
                    rotation={rotation}
                    spinning={spinning}
                    testId="preview-wheel"
                    theme={effectiveTheme}
                    centerLogoSrc={(themeDraft?.centerLogo || effectiveTheme.centerLogo || hubLogoPreview)
                      ? (hubLogoPreview ?? themeState?.centerLogo ?? null)
                      : null}
                    centerLogoAlt={t.wheel.logoAlt}
                    wrapperClassName="w-full max-w-[460px]"
                  />

                  <div className="min-h-[2.5rem] text-center text-[13px] text-ink-muted">
                    {spinning
                      ? t.customer.spinning
                      : winner
                        ? `${t.wheel.winnerLabel}\u00a0: ${winner}`
                        : t.wheel.previewDescription}
                  </div>

                  <Button
                    size="lg"
                    className="w-full"
          onClick={handleSpin}
          disabled={spinning || !activeRewards.length || totalProbability <= 0}
                    loading={spinning}
                  >
                    <Dices className="h-4 w-4" aria-hidden />
                    {spinning ? t.customer.spinning : t.wheel.spinPreview}
                  </Button>
                </div>

                <div className="mt-5 rounded-xl border border-line bg-elevated p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
                        {t.wheel.publicLinkTitle}
                      </p>
                      <p className="mt-1 truncate text-[13px] font-medium text-ink">
                        {publicUrl || t.wheel.loadingPlaceholder}
                      </p>
                      {copyMessage ? (
                        <p className="mt-1 text-[12px] font-medium text-success-600 dark:text-success-300">
                          {copyMessage}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="icon-sm"
                        onClick={() => void copyPublicUrl()}
                        disabled={!publicUrl}
                        aria-label={t.wheel.copyLink}
                        title={t.wheel.copyLink}
                        className="text-ink-subtle"
                      >
                        <Copy className="h-4 w-4" aria-hidden />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        onClick={() => publicUrl && window.open(publicUrl, '_blank', 'noopener,noreferrer')}
                        disabled={!publicUrl}
                        aria-label={t.wheel.openLink}
                        title={t.wheel.openLink}
                        className="text-ink-subtle"
                      >
                        <ExternalLink className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
      )}
    </div>
  );
}
