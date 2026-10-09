"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Award,
  BarChart3,
  Download,
  Filter,
  Gift,
  Megaphone,
  Percent,
  QrCode,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { SegmentedControl } from '@/components/ui/segmented';
import { Skeleton, SkeletonCard } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import { Progress } from '@/components/ui/toast';
import { FunnelChart, TimeSeriesChart } from '@/components/analytics-charts';
import { cn } from '@/lib/cn';
import { interpolate, msg } from '@/lib/i18n';
import { useT } from '@/hooks/use-t';
import {
  AnalyticsService,
  type FunnelResult,
  type RangeDays,
  type Rankings,
  type TimeseriesPoint,
} from '@/services/analytics.service';
import { RewardService } from '@/services/reward.service';

const RANGES: RangeDays[] = [7, 30, 90];

const STAT_ICONS = [QrCode, Users, Award, Gift, Percent];

interface RewardDistribution {
  id: string;
  name: string;
  percent: number;
}

export default function AnalyticsPage() {
  const t = useT();
  const [range, setRange] = useState<RangeDays>(30);
  const [series, setSeries] = useState<TimeseriesPoint[]>([]);
  const [funnel, setFunnel] = useState<FunnelResult | null>(null);
  const [rankings, setRankings] = useState<Rankings | null>(null);
  const [rewardDistribution, setRewardDistribution] = useState<RewardDistribution[]>([]);
  const [totals, setTotals] = useState<Array<{ event_type: string; count: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const EVENT_LABELS: Record<string, string> = {
    PARTICIPATION: t.analytics.eventParticipations,
    REWARD_CLAIMED: t.analytics.eventRewardsWon,
    COUPON_REDEEMED: t.analytics.eventCouponsRedeemed,
    QR_SCANNED: t.analytics.eventQrScans,
  };

  const RANGE_OPTIONS = RANGES.map((days) => ({
    value: String(days),
    label: `${days}${t.analytics.daysShort}`,
  }));

  const load = useCallback(async (days: RangeDays) => {
    setLoading(true);
    setError(null);

    try {
      const [points, funnelResult, rankingResult, overview, rewards] = await Promise.all([
        AnalyticsService.timeSeries(days),
        AnalyticsService.funnel(days),
        AnalyticsService.rankings(days),
        AnalyticsService.overview(),
        RewardService.list(),
      ]);

      const totalWeight = rewards.reduce((sum, reward) => sum + (reward.active ? reward.weight : 0), 0);
      const distribution = rewards
        .filter((reward) => reward.active)
        .map((reward) => ({
          id: reward.id,
          name: reward.name,
          percent: totalWeight > 0 ? Math.round((reward.weight / totalWeight) * 100) : 0,
        }));

      setSeries(points);
      setFunnel(funnelResult);
      setRankings(rankingResult);
      setTotals(overview.totals);
      setRewardDistribution(distribution);
    } catch (cause: unknown) {
      setError(msg(t, cause instanceof Error ? cause.message : 'Unable to load analytics.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(range), 0);
    return () => clearTimeout(timer);
  }, [range, load]);

  const windowTotals = useMemo(() => {
    return series.reduce(
      (accumulator, point) => ({
        participations: accumulator.participations + point.participations,
        rewardsClaimed: accumulator.rewardsClaimed + point.rewardsClaimed,
        couponsRedeemed: accumulator.couponsRedeemed + point.couponsRedeemed,
      }),
      { participations: 0, rewardsClaimed: 0, couponsRedeemed: 0 },
    );
  }, [series]);

  const stats = useMemo(() => {
    const count = (type: string) => totals.find((row) => row.event_type === type)?.count ?? 0;
    const scans = count('QR_SCANNED');
    const conversion =
      windowTotals.participations > 0
        ? Math.round((windowTotals.couponsRedeemed / windowTotals.participations) * 1000) / 10
        : 0;

    return [
      { label: interpolate(t.analytics.statScans, { range }), value: scans },
      { label: interpolate(t.analytics.statPlayers, { range }), value: windowTotals.participations },
      { label: interpolate(t.analytics.statRewardsIssued, { range }), value: windowTotals.rewardsClaimed },
      { label: interpolate(t.analytics.statRedeemed, { range }), value: windowTotals.couponsRedeemed },
      { label: interpolate(t.analytics.statConversion, { range }), value: `${conversion}%` },
    ];
  }, [totals, windowTotals, range, t]);

  const handleExport = () => {
    const rows = [
      ['day', 'participations', 'rewards_claimed', 'coupons_redeemed'],
      ...series.map((point) => [point.day, String(point.participations), String(point.rewardsClaimed), String(point.couponsRedeemed)]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `campaign-analytics-${range}d.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (error) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-danger-300/60 bg-danger-50 p-5 text-sm text-danger-800 dark:border-danger-900/60 dark:bg-danger-900/30 dark:text-danger-200"
      >
        {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={t.analytics.eyebrow}
        title={t.analytics.title}
        description={t.analytics.description}
        actions={
          <Button variant="outline" size="sm" onClick={handleExport} disabled={loading || series.length === 0}>
            <Download className="h-3.5 w-3.5" aria-hidden />
            {t.analytics.exportCsv}
          </Button>
        }
        toolbar={
          <>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
              <Filter className="h-3.5 w-3.5" aria-hidden />
              {t.analytics.period}
            </span>
            <SegmentedControl
              value={String(range)}
              onChange={(next) => setRange(Number(next) as RangeDays)}
              options={RANGE_OPTIONS}
              size="sm"
              selectedTone="brand"
              aria-label={t.analytics.dateRange}
            />
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {loading
          ? Array.from({ length: 5 }).map((_, idx) => <SkeletonCard key={idx} />)
          : stats.map((stat, index) => {
              const Icon = STAT_ICONS[index] ?? BarChart3;
              return (
                <StatCard
                  key={stat.label}
                  label={stat.label}
                  value={stat.value}
                  icon={Icon}
                  featured={index === 0}
                />
              );
            })}
      </div>

      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-4 space-y-0">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
              {t.analytics.timelineEyebrow}
            </p>
            <CardTitle className="text-lg">{t.analytics.timelineTitle}</CardTitle>
            <p className="text-[13.5px] text-ink-muted">
              {interpolate(t.analytics.timelineSubtitle, { range })}
            </p>
          </div>
          <span className="numeric rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-ink-muted">
            {interpolate(t.analytics.timelineWindow, { range })}
          </span>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-60 w-full rounded-lg" />
          ) : (
            <TimeSeriesChart data={series} />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
              {t.analytics.funnelEyebrow}
            </p>
            <CardTitle className="text-lg">{t.analytics.funnelTitle}</CardTitle>
            <p className="text-[13.5px] text-ink-muted">
              {interpolate(t.analytics.funnelSubtitle, { range })}
            </p>
          </CardHeader>
          <CardContent>
            {loading || !funnel ? (
              <Skeleton className="h-56 w-full rounded-lg" />
            ) : (
              <FunnelChart result={funnel} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
              {t.analytics.rankingsEyebrow}
            </p>
            <CardTitle className="text-lg">{t.analytics.rankingsTitle}</CardTitle>
            <p className="text-[13.5px] text-ink-muted">
              {interpolate(t.analytics.rankingsSubtitle, { range })}
            </p>
          </CardHeader>
          <CardContent>
            {!rankings || rankings.campaigns.length === 0 ? (
              <EmptyState
                size="sm"
                icon={Megaphone}
                title={t.analytics.rankingsEmptyTitle}
                description={t.analytics.rankingsEmptyDescription}
              />
            ) : (
              <ol className="flex flex-col gap-4">
                {rankings.campaigns.map((campaign, index) => {
                  const top = rankings.campaigns[0]?.participations || 1;
                  return (
                    <li key={campaign.id}>
                      <div className="mb-2 flex items-baseline justify-between gap-3 text-[13.5px]">
                        <span className="flex min-w-0 items-center gap-2.5">
                          <span className="numeric inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-brand-800 dark:bg-brand-900/50 dark:text-accent-bright">
                            {index + 1}
                          </span>
                          <span className="truncate font-medium text-ink">{campaign.name}</span>
                        </span>
                        <span className="numeric shrink-0 font-semibold text-ink">
                          {campaign.participations}
                          <span className="ml-1.5 text-xs font-normal text-ink-subtle">
                            {interpolate(t.analytics.customersSuffix, { count: campaign.customers })}
                          </span>
                        </span>
                      </div>
                      <Progress
                        value={Math.max((campaign.participations / top) * 100, 3)}
                        label={interpolate(t.analytics.campaignProgressLabel, { name: campaign.name })}
                      />
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
              {t.analytics.rewardsEyebrow}
            </p>
            <CardTitle className="text-lg">{t.analytics.rewardsTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            {!rankings || rankings.rewards.length === 0 ? (
              <EmptyState
                size="sm"
                icon={Gift}
                title={t.analytics.rewardsEmptyTitle}
                description={t.analytics.rewardsEmptyDescription}
              />
            ) : (
              <ol className="flex flex-col gap-4">
                {rankings.rewards.map((reward, index) => {
                  const top = rankings.rewards[0]?.claims || 1;
                  return (
                    <li key={reward.id}>
                      <div className="mb-2 flex items-baseline justify-between gap-3 text-[13.5px]">
                        <span className="flex min-w-0 items-center gap-2.5">
                          <span className="numeric inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-brand-800 dark:bg-brand-900/50 dark:text-accent-bright">
                            {index + 1}
                          </span>
                          <span className="truncate font-medium text-ink">{reward.name}</span>
                        </span>
                        <span className="numeric shrink-0 font-semibold text-ink">
                          {interpolate(t.analytics.claimsCount, { count: reward.claims })}
                        </span>
                      </div>
                      <Progress
                        tone="ink"
                        value={Math.max((reward.claims / top) * 100, 3)}
                        label={interpolate(t.analytics.rewardProgressLabel, { name: reward.name })}
                      />
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
              {t.analytics.oddsEyebrow}
            </p>
            <CardTitle className="text-lg">{t.analytics.oddsTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            {rewardDistribution.length === 0 ? (
              <EmptyState
                size="sm"
                icon={Award}
                title={t.analytics.oddsEmptyTitle}
                description={t.analytics.oddsEmptyDescription}
              />
            ) : (
              <ul className="flex flex-col gap-4">
                {rewardDistribution.map((reward) => (
                  <li key={reward.id}>
                    <div className="mb-2 flex items-center justify-between gap-3 text-[13.5px]">
                      <span className="truncate text-ink">{reward.name}</span>
                      <span className="numeric shrink-0 font-semibold text-ink">{reward.percent}%</span>
                    </div>
                    <Progress
                      value={Math.max(reward.percent, 2)}
                      label={interpolate(t.analytics.oddsProgressLabel, { name: reward.name })}
                    />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t.analytics.totalsTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          {totals.length === 0 ? (
            <EmptyState
              size="sm"
              icon={BarChart3}
              title={t.analytics.totalsEmptyTitle}
              description={t.analytics.totalsEmptyDescription}
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {totals.map((row) => (
                <div
                  key={row.event_type}
                  className={cn(
                    'rounded-xl border border-line bg-surface-2/60 p-4',
                    'transition-colors duration-180 hover:border-line-strong',
                  )}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                    {EVENT_LABELS[row.event_type] ?? row.event_type}
                  </p>
                  <p className="numeric mt-2.5 text-[26px] font-semibold leading-none tracking-[-0.03em] text-ink">
                    {row.count}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
