"use client";

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { LoadingScreen } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/ui/page-header';
import { msg } from '@/lib/i18n';
import { useT } from '@/hooks/use-t';
import {
  CampaignConfigService,
  type RewardConfiguration,
  type SavedCampaignConfiguration,
} from '@/services/campaign-config.service';
import { CampaignService, type Campaign } from '@/services/campaign.service';

const SEGMENT_COLORS = [
  '#ff9e80',
  '#ffcc80',
  '#a5d6a7',
  '#81c784',
  '#ff8a80',
  '#e0e0e0',
  '#80deea',
  '#b39ddb',
];

type GameSegment = {
  id: string;
  label: string;
  color: string;
  weight: number;
  active: boolean;
  type: RewardConfiguration['type'];
  value: number;
  quantity: number;
};

function segmentsFromRewards(rewards: RewardConfiguration[] | undefined): GameSegment[] {
  return (rewards ?? []).map((reward, index) => ({
    id: reward.id ?? `new-${index}`,
    label: reward.name,
    color: SEGMENT_COLORS[index % SEGMENT_COLORS.length] ?? '#80deea',
    weight: Math.max(reward.weight ?? 0, 1),
    active: reward.active !== false,
    type: reward.type ?? 'custom_reward',
    value: reward.value ?? 0,
    quantity: reward.quantity ?? 0,
  }));
}

export default function GamesPage() {
  const t = useT();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState('');
  const [config, setConfig] = useState<SavedCampaignConfiguration | null>(null);
  const [gameType, setGameType] = useState('prize_wheel');
  const [themeColor, setThemeColor] = useState('#ff6b6b');
  const [segments, setSegments] = useState<GameSegment[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    CampaignService.getCampaigns({ limit: 100 })
      .then((list) => {
        setCampaigns(list);
        setCampaignId(list[0]?.id ?? '');
      })
      .catch((cause: unknown) =>
        setError(msg(t, cause instanceof Error ? cause.message : 'Unable to load campaigns.')),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!campaignId) return;

    let cancelled = false;
    setStatus(null);
    setError(null);

    CampaignConfigService.load(campaignId)
      .then((loaded) => {
        if (cancelled) return;
        setConfig(loaded);
        setTitle(loaded?.title ?? '');
        setDescription(loaded?.description ?? '');
        setSegments(segmentsFromRewards(loaded?.rewards));
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setError(
            msg(t, cause instanceof Error ? cause.message : 'Unable to load the game configuration.'),
          );
      });

    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  const totalWeight = useMemo(() => segments.reduce((sum, segment) => sum + segment.weight, 0), [segments]);

  const handleSaveGameConfiguration = async () => {
    if (!config || !campaignId) return;

    setSaving(true);
    setStatus(null);
    setError(null);

    try {
      await CampaignConfigService.save({
        title,
        description,
        googleMapsName: config.googleMapsName,
        googleMapsUrl: config.googleMapsUrl,
        googlePlaceId: config.googlePlaceId,
        facebookUrl: config.facebookUrl,
        instagramUrl: config.instagramUrl,
        action: config.action,
        campaignId,
        status: config.status,
        startAt: config.startAt,
        endAt: config.endAt,
        rewards: segments.map((segment) => ({
          id: segment.id.startsWith('new-') ? undefined : segment.id,
          name: segment.label,
          description: config.rewards?.find((reward) => reward.id === segment.id)?.description ?? '',
          type: segment.type,
          value: segment.value,
          weight: segment.weight,
          quantity: segment.quantity,
          active: segment.active,
        })),
      });
      setStatus(t.games.saved);
    } catch (cause) {
      setError(msg(t, cause instanceof Error ? cause.message : 'Unable to save the game configuration.'));
    } finally {
      setSaving(false);
    }
  };

  const updateSegment = (id: string, patch: Partial<GameSegment>) => {
    setSegments((current) => current.map((segment) => (segment.id === id ? { ...segment, ...patch } : segment)));
  };

  if (loading) {
    return <LoadingScreen label={t.games.loading} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={t.games.eyebrow}
        title={t.games.title}
        description={t.games.description}
      />

      {error && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-danger-300/60 bg-danger-50 p-4 text-sm text-danger-800 dark:border-danger-900/60 dark:bg-danger-900/30 dark:text-danger-200"
        >
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger-500" aria-hidden />
          {error}
        </div>
      )}
      {status && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-success-300/60 bg-success-50 p-4 text-sm text-success-800 dark:border-success-900/60 dark:bg-success-900/30 dark:text-success-200"
        >
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-success-500" aria-hidden />
          {status}
        </div>
      )}

      <Card className="p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.games.gameType} htmlFor="game-type">
            <Select id="game-type" value={gameType} onChange={(e) => setGameType(e.target.value)}>
              <option value="prize_wheel">{t.games.prizeWheel}</option>
              <option value="scratch_card">{t.games.scratchCard}</option>
              <option value="slot_machine">{t.games.slotMachine}</option>
            </Select>
          </Field>

          <Field label={t.games.campaign} htmlFor="game-campaign">
            <Select id="game-campaign" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
              <option value="">{t.games.selectCampaign}</option>
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      {!campaignId ? (
        <div className="rounded-xl border border-dashed border-line-strong p-12 text-center text-[13px] text-ink-muted">
          {campaigns.length === 0 ? t.games.noCampaignsHint : t.games.pickCampaignHint}
        </div>
      ) : !config ? (
        <div className="rounded-xl border border-dashed border-line-strong p-12 text-center text-[13px] text-ink-muted">
          {t.games.noConfigHint}
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t.games.configTitle}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <Field label={t.games.gameTitle} htmlFor="game-title">
              <Input id="game-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>

            <Field label={t.games.descriptionField} htmlFor="game-description">
              <Textarea
                id="game-description"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>

            <Field label={t.games.themeColor} htmlFor="theme-color">
              <input
                id="theme-color"
                type="color"
                value={themeColor}
                onChange={(e) => setThemeColor(e.target.value)}
                className="h-10 w-16 cursor-pointer rounded-md border border-line bg-elevated p-1"
              />
            </Field>

            <div>
              <p className="text-[13px] font-medium leading-none text-ink">{t.games.livePreview}</p>
              <div className="mt-2 aspect-square overflow-hidden rounded-xl border border-line bg-surface-2">
                <div className="relative flex h-full w-full items-center justify-center">
                  <div
                    className="absolute inset-0"
                    style={{
                      background: `conic-gradient(${segments
                        .map((segment, idx) => {
                          const before = segments.slice(0, idx).reduce((sum, s) => sum + s.weight, 0);
                          const share = totalWeight > 0 ? segment.weight / totalWeight : 0;
                          const beforeShare = totalWeight > 0 ? before / totalWeight : 0;
                          return `${segment.color} ${beforeShare * 360}deg ${(beforeShare + share) * 360}deg`;
                        })
                        .reverse()
                        .join(', ')})`,
                      WebkitMaskImage: 'radial-gradient(circle closest-side, white 70%, transparent 71%)',
                      maskImage: 'radial-gradient(circle closest-side, white 70%, transparent 71%)',
                    }}
                  />
                  <div className="relative z-10 flex h-full w-full items-center justify-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-card">
                      <span className="text-2xl">🎡</span>
                    </div>
                  </div>
                </div>
              </div>
              <p className="mt-2 text-center text-xs text-ink-subtle">{t.games.wheelPreviewNote}</p>
            </div>

            <div>
              <p id="segments" className="text-[13px] font-medium leading-none text-ink">
                {t.games.wheelSegments}
              </p>
              <div className="mt-2 space-y-2.5">
                {segments.map((segment) => (
                  <div
                    key={segment.id}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface-2/60 p-3"
                  >
                    <span
                      className="h-8 w-8 shrink-0 rounded-md ring-1 ring-inset ring-black/10"
                      style={{ backgroundColor: segment.color }}
                      aria-hidden
                    />
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <Input
                        inputSize="sm"
                        type="text"
                        aria-label={t.games.segmentLabel}
                        value={segment.label}
                        onChange={(e) => updateSegment(segment.id, { label: e.target.value })}
                        className="flex-1"
                      />
                      <div className="flex items-center gap-2">
                        <span className="numeric text-xs text-ink-subtle">
                          {totalWeight > 0 ? Math.round((segment.weight / totalWeight) * 100) : 0}%
                        </span>
                        <Input
                          inputSize="sm"
                          type="number"
                          min="0"
                          aria-label={t.games.segmentWeight}
                          value={segment.weight}
                          onChange={(e) =>
                            updateSegment(segment.id, {
                              weight: Math.max(0, parseInt(e.target.value, 10) || 0),
                            })
                          }
                          className="numeric w-20"
                        />
                      </div>
                    </div>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => setSegments((current) => current.filter((item) => item.id !== segment.id))}
                    >
                      {t.games.remove}
                    </Button>
                  </div>
                ))}

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setSegments((current) => [
                      ...current,
                      {
                        id: `new-${Date.now()}`,
                        label: t.games.newSegment,
                        color: SEGMENT_COLORS[current.length % SEGMENT_COLORS.length] ?? '#80deea',
                        weight: 10,
                        active: true,
                        type: 'custom_reward',
                        value: 0,
                        quantity: 0,
                      },
                    ])
                  }
                >
                  {t.games.addSegment}
                </Button>
              </div>

              <div className="mt-6 border-t border-line pt-4">
                <Button onClick={handleSaveGameConfiguration} disabled={saving} loading={saving}>
                  {saving ? t.games.saving : t.games.saveConfig}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
