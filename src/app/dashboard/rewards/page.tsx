"use client";

import { useEffect, useMemo, useState } from 'react';
import {
  Ban,
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
import { interpolate, msg } from '@/lib/i18n';
import { useT } from '@/hooks/use-t';

const TYPE_ICONS: Record<string, LucideIcon> = {
  percentage_discount: BadgePercent,
  fixed_discount: BadgeDollarSign,
  free_product: Gift,
  free_service: Sparkles,
  custom_reward: Star,
  none: Ban,
};

const FALLBACK_ICON: LucideIcon = Star;

function valueSuffix(type: string, fixedSuffix: string): string {
  return type === 'percentage_discount' ? '%' : type === 'fixed_discount' ? fixedSuffix : '';
}

export default function RewardsPage() {
  const t = useT();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [rewards, setRewards] = useState<RewardSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const TYPE_LABELS: Record<string, string> = {
    percentage_discount: t.rewards.typePercentageDiscount,
    fixed_discount: t.rewards.typeFixedDiscount,
    free_product: t.rewards.typeFreeProduct,
    free_service: t.rewards.typeFreeService,
    custom_reward: t.rewards.typeCustomReward,
    none: t.rewards.typeNone,
  };

  useEffect(() => {
    RewardService.list()
      .then(setRewards)
      .catch((cause: unknown) =>
        setError(msg(t, cause instanceof Error ? cause.message : t.rewards.loadError)),
      )
      .finally(() => setLoading(false));
  }, [t]);

  const totalWeight = useMemo(
    () => rewards.filter((reward) => reward.active).reduce((sum, reward) => sum + reward.weight, 0),
    [rewards],
  );

  const filteredRewards = rewards.filter((reward) => {
    const matchesSearch =
      reward.name.toLowerCase().includes(search.toLowerCase()) ||
      reward.description.toLowerCase().includes(search.toLowerCase());
    const matchesType = typeFilter === 'all' || reward.type === typeFilter;
    return matchesSearch && matchesType;
  });

  const patch = async (reward: RewardSummary, changes: { active?: boolean; quantity?: number }) => {
    setBusyId(reward.id);
    setError(null);

    try {
      const updated = await RewardService.update(reward.id, changes);
      setRewards((current) => current.map((item) => (item.id === updated.id ? updated : item)));
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
      setRewards((current) => current.filter((item) => item.id !== reward.id));
    } catch (cause) {
      setError(msg(t, cause instanceof Error ? cause.message : t.rewards.deleteError));
    } finally {
      setBusyId(null);
    }
  };

  const list =
    loading ? (
      <div className="grid gap-4">
        <SkeletonCard />
        <SkeletonCard />
        <p role="status" className="sr-only">{t.rewards.loading}</p>
      </div>
    ) : filteredRewards.length === 0 ? (
      <Card>
        <EmptyState
          icon={Gift}
          title={t.rewards.emptyTitle}
          description={t.rewards.emptyDescription}
        />
      </Card>
    ) : (
      <div className="grid gap-4">
        {filteredRewards.map((reward) => {
          const Icon = TYPE_ICONS[reward.type] ?? FALLBACK_ICON;
          const probability =
            reward.active && totalWeight > 0 ? Math.round((reward.weight / totalWeight) * 100) : 0;

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
        })}
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