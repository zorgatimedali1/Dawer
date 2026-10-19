"use client";

import { useEffect, useMemo, useState } from 'react';
import {
  BadgeDollarSign,
  BadgePercent,
  Gift,
  Minus,
  Power,
  Search,
  Sparkles,
  Star,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { EntityTile } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { SkeletonCard } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/toast';
import { RewardService, type RewardSummary } from '@/services/reward.service';
import { CampaignService, type Campaign } from '@/services/campaign.service';
import { effectiveRewardOdds } from '@/lib/wheel-odds';
import { interpolate, msg } from '@/lib/i18n';
import { useT } from '@/hooks/use-t';
import { readCachedResource, setCachedResource } from '@/hooks/useCachedResource';

const TYPE_ICONS: Record<string, LucideIcon> = {
  percentage_discount: BadgePercent,
  fixed_discount: BadgeDollarSign,
  free_product: Gift,
  free_service: Sparkles,
  custom_reward: Star,
};

const FALLBACK_ICON: LucideIcon = Star;

function valueSuffix(type: string, fixedSuffix: string): string {
  return type === 'percentage_discount' ? '%' : type === 'fixed_discount' ? fixedSuffix : '';
}

const rewardsKeyOf = (campaignFilter: string): string => `rewards:${campaignFilter}`;

// Chip filter: only non-archived campaigns get a button, newest first.
function firstVisibleCampaign(list: Campaign[]): string {
  return list.find((campaign) => campaign.status !== 'archived')?.id ?? 'all';
}

export default function RewardsPage() {
  const t = useT();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const initialCampaigns = readCachedResource<Campaign[]>('rewards:campaigns') ?? [];
  const initialCampaignFilter = firstVisibleCampaign(initialCampaigns);
  const [pickedCampaign, setPickedCampaign] = useState(initialCampaignFilter);
  const [campaigns, setCampaigns] = useState<Campaign[]>(initialCampaigns);
  // Seeded from the SWR cache so revisits paint instantly.
  const [rewards, setRewards] = useState<RewardSummary[]>(() => readCachedResource<RewardSummary[]>(rewardsKeyOf(initialCampaignFilter)) ?? []);
  const [loading, setLoading] = useState(() => readCachedResource(rewardsKeyOf(initialCampaignFilter)) === null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const TYPE_LABELS: Record<string, string> = {
    percentage_discount: t.rewards.typePercentageDiscount,
    fixed_discount: t.rewards.typeFixedDiscount,
    free_product: t.rewards.typeFreeProduct,
    free_service: t.rewards.typeFreeService,
    custom_reward: t.rewards.typeCustomReward,
  };

  useEffect(() => {
    const cached = readCachedResource<Campaign[]>('rewards:campaigns');
    if (cached) {
      setCampaigns(cached);
      return;
    }
    CampaignService.getCampaigns({ limit: 100 })
      .then((result) => {
        setCachedResource('rewards:campaigns', result);
        setCampaigns(result);
      })
      .catch((cause: unknown) =>
        setError(msg(t, cause instanceof Error ? cause.message : t.rewards.loadError)),
      );
  }, [t]);

  const availableCampaigns = useMemo(
    () => campaigns.filter((campaign) => campaign.status !== 'archived'),
    [campaigns],
  );

  // Derived chip selection: the pick stays the user's; when it is 'all'
  // (nothing picked yet) or the picked campaign got archived since, it falls
  // back to the newest available campaign chip.
  const selectedCampaign =
    availableCampaigns.find((campaign) => campaign.id === pickedCampaign)?.id ?? availableCampaigns[0]?.id ?? 'all';
  const rewardsKey = rewardsKeyOf(selectedCampaign);

  useEffect(() => {
    const key = rewardsKey;
    const cached = readCachedResource<RewardSummary[]>(key);
    if (cached) {
      setRewards(cached);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    RewardService.list(selectedCampaign === 'all' ? {} : { campaignId: selectedCampaign })
      .then((result) => {
        setCachedResource(key, result);
        setRewards(result);
      })
      .catch((cause: unknown) =>
        setError(msg(t, cause instanceof Error ? cause.message : t.rewards.loadError)),
      )
      .finally(() => setLoading(false));
  }, [t, rewardsKey, selectedCampaign]);

  // Effective chances per the same redistribution the customer wheel uses,
  // computed campaign by campaign: sold-out rewards show 0% and their weight
  // lands on that campaign's "Prochaine fois" slice.
  const oddsById = useMemo(() => {
    const byCampaign = new Map<string, RewardSummary[]>();
    for (const reward of rewards) {
      const group = byCampaign.get(reward.campaignId) ?? [];
      group.push(reward);
      byCampaign.set(reward.campaignId, group);
    }
    const odds = new Map<string, number>();
    for (const group of byCampaign.values()) {
      for (const entry of effectiveRewardOdds(group)) {
        odds.set(entry.id, entry.percent);
      }
    }
    return odds;
  }, [rewards]);

  // The "Prochaine fois" (type none) slice is wheel machinery, not a merchant
  // reward: it stays out of this list and the type filter, but still absorbs
  // sold-out weight in the odds above.
  const filteredRewards = useMemo(
    () =>
      rewards.filter((reward) => {
        if (reward.type === 'none') return false;
        const matchesSearch =
          reward.name.toLowerCase().includes(search.toLowerCase()) ||
          reward.description.toLowerCase().includes(search.toLowerCase());
        const matchesType = typeFilter === 'all' || reward.type === typeFilter;
        return matchesSearch && matchesType;
      }),
    [rewards, search, typeFilter],
  );

  const rewardGroups = useMemo(() => {
    const map = new Map<string, { campaignId: string; campaignName: string; rewards: RewardSummary[] }>();
    for (const reward of filteredRewards) {
      const existing = map.get(reward.campaignId);
      if (existing) {
        existing.rewards.push(reward);
      } else {
        map.set(reward.campaignId, {
          campaignId: reward.campaignId,
          campaignName: reward.campaignName,
          rewards: [reward],
        });
      }
    }
    return [...map.values()];
  }, [filteredRewards]);

  const patch = async (reward: RewardSummary, changes: { active?: boolean; quantity?: number }) => {
    setBusyId(reward.id);
    setError(null);

    try {
      const updated = await RewardService.update(reward.id, changes);
      setRewards((current) => {
        const next = current.map((item) => (item.id === updated.id ? updated : item));
        setCachedResource(rewardsKey, next);
        return next;
      });
    } catch (cause) {
      setError(msg(t, cause instanceof Error ? cause.message : t.rewards.updateError));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (reward: RewardSummary) => {
    if (!window.confirm(interpolate(t.rewards.confirmDelete, { name: reward.name }))) return;

    setBusyId(reward.id);
    setError(null);
    try {
      await RewardService.delete(reward.id);
      setRewards((current) => {
        const next = current.filter((item) => item.id !== reward.id);
        setCachedResource(rewardsKey, next);
        return next;
      });
    } catch (cause) {
      setError(msg(t, cause instanceof Error ? cause.message : t.rewards.deleteError));
    } finally {
      setBusyId(null);
    }
  };

  const renderCard = (reward: RewardSummary) => {
    const Icon = TYPE_ICONS[reward.type] ?? FALLBACK_ICON;
    const probability = oddsById.get(reward.id) ?? 0;

    return (
      <Card key={reward.id} className="flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <EntityTile tone={reward.active ? 'brand' : 'neutral'}>
              <Icon className="h-4 w-4" aria-hidden />
            </EntityTile>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-[15px] font-semibold text-ink">{reward.name}</h3>
                <Badge size="sm" tone={reward.active ? 'success' : 'danger'} dot>
                  {reward.active ? t.common.active : t.common.inactive}
                </Badge>
                {reward.quantityInitial !== null && reward.quantityInitial > 0 && reward.quantity <= 0 ? (
                  <Badge size="sm" tone="danger">
                    {t.rewards.finished}
                  </Badge>
                ) : null}
              </div>
              <p className="mt-0.5 truncate text-[13px] text-ink-muted">
                {reward.description || reward.campaignName}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <Button
              variant="outline"
              size="sm"
              disabled={busyId === reward.id || reward.quantity <= 0}
              onClick={() => patch(reward, { quantity: reward.quantity - 1 })}
            >
              <Minus className="h-4 w-4" aria-hidden />
              {t.rewards.decreaseStock}
            </Button>
            <Button
              variant={reward.active ? 'outline' : 'secondary'}
              size="sm"
              disabled={busyId === reward.id}
              onClick={() => patch(reward, { active: !reward.active })}
            >
              <Power className="h-4 w-4" aria-hidden />
              {reward.active ? t.rewards.deactivate : t.rewards.activate}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-ink-subtle hover:text-danger-600 dark:hover:text-danger-300"
              disabled={busyId === reward.id}
              aria-label={interpolate(t.rewards.deleteAria, { name: reward.name })}
              title={interpolate(t.rewards.deleteAria, { name: reward.name })}
              onClick={() => void remove(reward)}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              {t.rewards.delete}
            </Button>
          </div>
        </div>

        <dl className="grid gap-x-6 gap-y-4 border-y border-line py-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
              {t.rewards.valueLabel}
            </dt>
            <dd className="numeric mt-1 text-[15px] font-semibold text-ink">
              {reward.value}
              {valueSuffix(reward.type, t.rewards.fixedSuffix)}
            </dd>
          </div>

          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
              {t.rewards.remainingLabel}
            </dt>
            <dd className="mt-1 flex items-center gap-2 text-[13px] text-ink-muted">
              <Input
                key={`${reward.id}-${reward.quantity}`}
                type="number"
                min={0}
                defaultValue={Math.max(reward.quantity, 0)}
                aria-label={interpolate(t.rewards.remainingStockAria, { name: reward.name })}
                disabled={busyId === reward.id}
                inputSize="sm"
                className="w-24"
                onBlur={(event) => {
                  const next = Number.parseInt(event.target.value, 10);
                  if (Number.isFinite(next) && next >= 0 && next !== reward.quantity) {
                    void patch(reward, { quantity: next });
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
                }}
              />
              <span>
                {t.rewards.remainingOf} {reward.quantityInitial ?? reward.quantity} {t.rewards.remainingSuffix}
              </span>
            </dd>
          </div>

          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
              {t.rewards.chanceLabel}
            </dt>
            <dd className="mt-1 flex items-center gap-2">
              <span className="numeric text-[13px] font-medium text-brand-700 dark:text-accent-bright">
                {probability}%
              </span>
              <Progress value={probability} label={`${reward.name} ${t.rewards.progressChance}`} />
            </dd>
          </div>

          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
              {t.rewards.campaignLabel}
            </dt>
            <dd className="mt-1 truncate text-[13px] text-ink-muted">{reward.campaignName}</dd>
          </div>
        </dl>
      </Card>
    );
  };

  const list =
    loading ? (
      <div className="grid gap-4">
        <SkeletonCard />
        <SkeletonCard />
        <p role="status" className="sr-only">{t.rewards.loading}</p>
      </div>
    ) : rewardGroups.length === 0 ? (
      <Card>
        <EmptyState
          icon={Gift}
          title={t.rewards.emptyTitle}
          description={t.rewards.emptyDescription}
        />
      </Card>
    ) : (
      <div className="grid gap-8">
        {rewardGroups.map((group) => (
          <div key={group.campaignId} className="grid gap-4">
            {selectedCampaign === 'all' ? (
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                {group.campaignName}
              </h2>
            ) : null}
            {group.rewards.map(renderCard)}
          </div>
        ))}
      </div>
    );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={t.rewards.eyebrow}
        title={t.rewards.title}
        description={t.rewards.description}
        toolbar={
          <>
            <Field
              label={
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                  {t.rewards.searchLabel}
                </span>
              }
              htmlFor="reward-search"
              className="w-full max-w-md"
            >
              <Input
                id="reward-search"
                inputSize="sm"
                iconStart={<Search />}
                type="text"
                placeholder={t.rewards.searchPlaceholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </Field>

            <Field
              label={
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                  {t.rewards.typeLabel}
                </span>
              }
              htmlFor="reward-type-filter"
              className="w-full max-w-[15rem]"
            >
              <Select
                id="reward-type-filter"
                inputSize="sm"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
              >
                <option value="all">{t.rewards.allTypes}</option>
                {Object.entries(TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        }
      />

      {availableCampaigns.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t.rewards.campaignLabel}>
          {availableCampaigns.map((campaign) => (
            <Button
              key={campaign.id}
              size="sm"
              variant={selectedCampaign === campaign.id ? 'secondary' : 'outline'}
              aria-pressed={selectedCampaign === campaign.id}
              onClick={() => setPickedCampaign(campaign.id)}
            >
              {campaign.name}
            </Button>
          ))}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-danger-300/60 bg-danger-50 p-4 text-sm text-danger-800 dark:border-danger-900/60 dark:bg-danger-900/30 dark:text-danger-200"
        >
          {error}
        </div>
      )}

      {list}
    </div>
  );
}
