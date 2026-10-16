"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Activity,
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
import { Modal } from '@/components/ui/modal';
import { PageHeader } from '@/components/ui/page-header';
import { SegmentedControl } from '@/components/ui/segmented';
import { Skeleton, SkeletonCard } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import { Progress } from '@/components/ui/toast';
import { Badge } from '@/components/ui/badge';
import { DonutChart, type DonutSlice } from '@/components/charts';
import { FunnelChart, TimeSeriesChart } from '@/components/analytics-charts';
import { cn } from '@/lib/cn';
import { interpolate, msg } from '@/lib/i18n';
import { effectiveRewardOdds } from '@/lib/wheel-odds';
import { useT } from '@/hooks/use-t';
import {
  AnalyticsService,
  type AnalyticsTotals,
  type CampaignEvent,
  type FunnelResult,
  type RangeDays,
  type RankedCampaign,
  type Rankings,
  type TimeseriesPoint,
} from '@/services/analytics.service';
import { RewardService } from '@/services/reward.service';

const RANGES: RangeDays[] = [7, 30, 90];

/** Stable empty array so the totals memo does not re-run every render. */
const EMPTY_SERIES: TimeseriesPoint[] = [];

const STAT_ICONS = [QrCode, Users, Award, Gift, Percent];

/** Donut slice hues cycle through the theme's data-viz series variables. */
const SLICE_VARIABLES = ['--series-1', '--series-2', '--series-3', '--series-4'];

const EVENT_TONES: Record<string, 'brand' | 'success' | 'info' | 'neutral'> = {
  PARTICIPATION: 'brand',
  REWARD_CLAIMED: 'success',
  COUPON_REDEEMED: 'info',
  QR_SCANNED: 'neutral',
};

interface RewardDistribution {
  id: string;
  name: string;
  percent: number;
}

/** Totals summed over one window; `null` marks an unavailable previous window. */
interface WindowTotals {
  participations: number;
  rewardsClaimed: number;
  couponsRedeemed: number;
  scans: number;
}

function sumSeries(points: TimeseriesPoint[]): WindowTotals {
  return points.reduce(
    (accumulator, point) => ({
      participations: accumulator.participations + point.participations,
      rewardsClaimed: accumulator.rewardsClaimed + point.rewardsClaimed,
      couponsRedeemed: accumulator.couponsRedeemed + point.couponsRedeemed,
      scans: accumulator.scans + (point.scans ?? 0),
    }),
    { participations: 0, rewardsClaimed: 0, couponsRedeemed: 0, scans: 0 },
  );
}

function conversionRate(totals: WindowTotals): number {
  return totals.participations > 0
    ? Math.min(Math.round((totals.couponsRedeemed / totals.participations) * 1000) / 10, 100)
    : 0;
}

/** Percent change between two windows; `null` when there is no comparison base. */
function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function formatChange(change: number): string {
  return `${change > 0 ? '+' : ''}${change}%`;
}

/** Per-section load state: one failed request must not blank the page. */
interface Loadable<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

function pending<T>(): Loadable<T> {
  return { data: null, loading: true, error: null };
}

interface SeriesBundle {
  series: TimeseriesPoint[];
  previous: WindowTotals | null;
}

export default function AnalyticsPage() {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const [range, setRange] = useState<RangeDays>(30);
  const [seriesState, setSeriesState] = useState<Loadable<SeriesBundle>>(pending);
  const [funnelState, setFunnelState] = useState<Loadable<FunnelResult>>(pending);
  const [rankingsState, setRankingsState] = useState<Loadable<Rankings>>(pending);
  const [rewardState, setRewardState] = useState<Loadable<RewardDistribution[]>>(pending);
  const [totalsState, setTotalsState] = useState<Loadable<AnalyticsTotals[]>>(pending);
  const [drillCampaign, setDrillCampaign] = useState<RankedCampaign | null>(null);
  const [drillEvents, setDrillEvents] = useState<Loadable<CampaignEvent[]>>(pending);
  // Bumped on every load: a slow response from a previous range switch must
  // not overwrite the range the user is looking at now.
  const requestIdRef = useRef(0);

  const eventLabel = useCallback(
    (eventType: string): string => {
      switch (eventType) {
        case 'PARTICIPATION':
          return t.analytics.eventParticipations;
        case 'REWARD_CLAIMED':
          return t.analytics.eventRewardsWon;
        case 'COUPON_REDEEMED':
          return t.analytics.eventCouponsRedeemed;
        case 'QR_SCANNED':
          return t.analytics.eventQrScans;
        default:
          return eventType;
      }
    },
    [t],
  );

  const RANGE_OPTIONS = RANGES.map((days) => ({
    value: String(days),
    label: `${days}${t.analytics.daysShort}`,
  }));

  const chartLabels = useMemo(
    () => ({
      played: t.analytics.seriesPlayed,
      rewards: t.analytics.seriesRewards,
      redeemed: t.analytics.seriesRedeemed,
      scans: t.analytics.seriesScans,
      empty: t.analytics.chartEmpty,
      aria: t.analytics.chartAriaTimeline,
    }),
    [t],
  );

  const funnelLabels = useMemo(
    () => ({
      rewardRate: t.analytics.funnelRateReward,
      redemptionRate: t.analytics.funnelRateRedemption,
      uniqueCustomers: t.analytics.funnelUniqueCustomers,
    }),
    [t],
  );

  const load = useCallback(
    (days: RangeDays) => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      const isStale = () => requestIdRef.current !== requestId;

      const settle = async <T,>(task: Promise<T>, set: (value: Loadable<T>) => void): Promise<void> => {
        try {
          const data = await task;
          if (!isStale()) set({ data, loading: false, error: null });
        } catch (cause: unknown) {
          if (!isStale()) {
            set({ data: null, loading: false, error: msg(t, cause instanceof Error ? cause.message : 'Unable to load analytics.') });
          }
        }
      };

      setSeriesState(pending());
      setFunnelState(pending());
      setRankingsState(pending());
      setRewardState(pending());
      setTotalsState(pending());

      const odds = RewardService.list().then(effectiveRewardOdds);

      // One doubled fetch (2× window) is split client-side into the visible
      // window and the previous one, so KPI deltas need no extra endpoint.
      const previousWindowDays = Math.min(days * 2, 365);
      const timeseriesBundle = Promise.all([
        AnalyticsService.timeSeries(days),
        AnalyticsService.timeSeries(previousWindowDays),
      ]).then(([current, combined]) => {
        const previousPoints = combined.slice(0, Math.max(combined.length - current.length, 0));
        return {
          series: current,
          previous: previousPoints.length > 0 ? sumSeries(previousPoints) : null,
        } satisfies SeriesBundle;
      });

      // Independent requests: the odds card is gated behind the rewards plan
      // feature, so its 403 may only degrade that one section.
      void settle(timeseriesBundle, setSeriesState);
      void settle(AnalyticsService.funnel(days), setFunnelState);
      void settle(AnalyticsService.rankings(days), setRankingsState);
      void settle(odds, setRewardState);
      void settle(AnalyticsService.overview().then((overview) => overview.totals), setTotalsState);
    },
    [t],
  );

  useEffect(() => {
    // Deferred so the effect never flips the section states to "pending"
    // inside the same render pass (react-hooks/set-state-in-effect).
    const timer = setTimeout(() => void load(range), 0);
    return () => clearTimeout(timer);
  }, [range, load]);

  const series = seriesState.data?.series ?? EMPTY_SERIES;
  const previous = seriesState.data?.previous ?? null;

  const windowTotals = useMemo(() => sumSeries(series), [series]);

  const stats = useMemo(() => {
    const deltaHint = interpolate(t.analytics.deltaPrevious, { range });
    const conversion = conversionRate(windowTotals);
    const conversionChange =
      previous && previous.participations > 0
        ? Math.round((conversion - conversionRate(previous)) * 10) / 10
        : null;

    const entries: Array<{
      label: string;
      value: string | number;
      delta?: string | undefined;
      deltaTone: 'positive' | 'negative' | 'neutral';
      hint?: string | undefined;
    }> = [
      {
        label: interpolate(t.analytics.statScans, { range }),
        value: windowTotals.scans,
        delta: formatOptional(percentChange(windowTotals.scans, previous?.scans ?? 0)),
        deltaTone: toneOf(percentChange(windowTotals.scans, previous?.scans ?? 0)),
        hint: deltaHint,
      },
      {
        label: interpolate(t.analytics.statPlayers, { range }),
        value: windowTotals.participations,
        delta: formatOptional(percentChange(windowTotals.participations, previous?.participations ?? 0)),
        deltaTone: toneOf(percentChange(windowTotals.participations, previous?.participations ?? 0)),
        hint: deltaHint,
      },
      {
        label: interpolate(t.analytics.statRewardsIssued, { range }),
        value: windowTotals.rewardsClaimed,
        delta: formatOptional(percentChange(windowTotals.rewardsClaimed, previous?.rewardsClaimed ?? 0)),
        deltaTone: toneOf(percentChange(windowTotals.rewardsClaimed, previous?.rewardsClaimed ?? 0)),
        hint: deltaHint,
      },
      {
        label: interpolate(t.analytics.statRedeemed, { range }),
        value: windowTotals.couponsRedeemed,
        delta: formatOptional(percentChange(windowTotals.couponsRedeemed, previous?.couponsRedeemed ?? 0)),
        deltaTone: toneOf(percentChange(windowTotals.couponsRedeemed, previous?.couponsRedeemed ?? 0)),
        hint: deltaHint,
      },
      {
        label: interpolate(t.analytics.statConversion, { range }),
        value: `${conversion}%`,
        delta:
          conversionChange !== null
            ? interpolate(t.analytics.deltaPoints, {
                value: `${conversionChange > 0 ? '+' : ''}${conversionChange}`,
              })
            : undefined,
        deltaTone: toneOf(conversionChange),
        hint: deltaHint,
      },
    ];

    return entries;
  }, [windowTotals, previous, range, t]);

  const insights = useMemo(() => {
    const first = series[0];
    if (!first) return null;
    let best = first;
    let quiet = first;
    let activeDays = 0;
    for (const point of series) {
      if (point.participations > best.participations) best = point;
      if (point.participations < quiet.participations) quiet = point;
      if (point.participations > 0) activeDays += 1;
    }
    const change = percentChange(windowTotals.participations, previous?.participations ?? 0);
    const trendKey =
      change === null
        ? t.analytics.insightNoComparison
        : change > 2
          ? t.analytics.insightTrendUp
          : change < -2
            ? t.analytics.insightTrendDown
            : t.analytics.insightTrendFlat;
    const trendTone: 'positive' | 'negative' | 'neutral' =
      change === null || Math.abs(change) <= 2 ? 'neutral' : change > 0 ? 'positive' : 'negative';

    return { best, quiet, activeDays, change, trendKey, trendTone };
  }, [series, windowTotals, previous, t]);

  const oddsSlices = useMemo<DonutSlice[]>(
    () =>
      (rewardState.data ?? []).map((reward, index) => ({
        label: reward.name,
        value: reward.percent,
        variable: SLICE_VARIABLES[index % SLICE_VARIABLES.length] ?? '--series-1',
        display: `${reward.percent}%`,
      })),
    [rewardState.data],
  );

  const loadDrillEvents = useCallback(
    (campaignId: string) => {
      setDrillEvents({ data: null, loading: true, error: null });
      void (async () => {
        try {
          const events = await AnalyticsService.campaignEvents(campaignId);
          setDrillEvents({ data: events, loading: false, error: null });
        } catch (cause: unknown) {
          setDrillEvents({
            data: null,
            loading: false,
            error: msg(t, cause instanceof Error ? cause.message : 'Unable to load campaign analytics.'),
          });
        }
      })();
    },
    [t],
  );

  const openDrill = useCallback(
    (campaign: RankedCampaign) => {
      setDrillCampaign(campaign);
      loadDrillEvents(campaign.id);
    },
    [loadDrillEvents],
  );

  const closeDrill = useCallback(() => {
    setDrillCampaign(null);
    setDrillEvents(pending());
  }, []);

  // Deep link: /dashboard/analytics?campaign=<id> opens the drill-down once
  // the rankings that resolve the campaign name have arrived. Deferred so the
  // effect never flips state in the same render pass.
  useEffect(() => {
    const campaignId = searchParams.get('campaign');
    if (!campaignId || drillCampaign) return undefined;
    const ranked = rankingsState.data?.campaigns.find((campaign) => campaign.id === campaignId);
    if (!ranked) return undefined;
    const timer = setTimeout(() => {
      setSearchParams({}, { replace: true });
      openDrill(ranked);
    }, 0);
    return () => clearTimeout(timer);
  }, [searchParams, rankingsState.data, drillCampaign, openDrill, setSearchParams]);

  const handleExport = () => {
    const rows = [
      ['day', 'participations', 'rewards_claimed', 'coupons_redeemed', 'scans'],
      ...series.map((point) => [
        point.day,
        String(point.participations),
        String(point.rewardsClaimed),
        String(point.couponsRedeemed),
        String(point.scans ?? 0),
      ]),
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

  const retry = () => load(range);
  const analyticsSections = [totalsState, seriesState, funnelState, rankingsState];
  const allFailed = analyticsSections.every((section) => section.error !== null);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={t.analytics.eyebrow}
        title={t.analytics.title}
        description={t.analytics.description}
        actions={
          <Button variant="outline" size="sm" onClick={handleExport} disabled={seriesState.loading || series.length === 0}>
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

      {allFailed ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger-300/60 bg-danger-50 p-5 text-sm text-danger-800 dark:border-danger-900/60 dark:bg-danger-900/30 dark:text-danger-200"
        >
          <span>{analyticsSections[0]?.error ?? msg(t, 'Unable to load analytics.')}</span>
          <Button variant="outline" size="sm" onClick={retry}>
            {t.common.retry}
          </Button>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {seriesState.loading
          ? Array.from({ length: 5 }).map((_, idx) => <SkeletonCard key={idx} />)
          : stats.map((stat, index) => {
              const Icon = STAT_ICONS[index] ?? BarChart3;
              return (
                <StatCard
                  key={stat.label}
                  label={stat.label}
                  value={stat.value}
                  delta={stat.delta}
                  deltaTone={stat.deltaTone}
                  hint={stat.delta ? stat.hint : undefined}
                  icon={Icon}
                  featured={index === 0}
                />
              );
            })}
      </div>

      {insights && !seriesState.loading && !seriesState.error ? (
        <Card>
          <CardContent className="pt-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <InsightTile
                label={t.analytics.insightBestDay}
                value={insights.best.day.slice(5)}
                hint={interpolate(t.analytics.insightPlayersCount, { count: insights.best.participations })}
              />
              <InsightTile
                label={t.analytics.insightQuietDay}
                value={insights.quiet.day.slice(5)}
                hint={interpolate(t.analytics.insightPlayersCount, { count: insights.quiet.participations })}
              />
              <InsightTile
                label={t.analytics.insightTrend}
                value={
                  insights.change !== null ? formatChange(insights.change) : t.analytics.insightNoComparison
                }
                tone={insights.trendTone}
                hint={insights.trendKey}
              />
              <InsightTile
                label={t.analytics.insightActiveDays}
                value={`${insights.activeDays}${t.analytics.daysShort}`}
                hint={interpolate(t.analytics.timelineWindow, { range })}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

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
          <SectionBody
            state={seriesState}
            skeleton={<Skeleton className="h-60 w-full rounded-lg" />}
            onRetry={retry}
            retryLabel={t.common.retry}
          >
            {(data) => <TimeSeriesChart data={data.series} labels={chartLabels} />}
          </SectionBody>
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
            <SectionBody
              state={funnelState}
              skeleton={<Skeleton className="h-56 w-full rounded-lg" />}
              onRetry={retry}
              retryLabel={t.common.retry}
            >
              {(data) => <FunnelChart result={data} labels={funnelLabels} />}
            </SectionBody>
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
            <SectionBody
              state={rankingsState}
              skeleton={<Skeleton className="h-56 w-full rounded-lg" />}
              empty={
                <EmptyState
                  size="sm"
                  icon={Megaphone}
                  title={t.analytics.rankingsEmptyTitle}
                  description={t.analytics.rankingsEmptyDescription}
                />
              }
              isEmpty={(data) => data.campaigns.length === 0}
              onRetry={retry}
              retryLabel={t.common.retry}
            >
              {(rankings) => (
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
                            <button
                              type="button"
                              onClick={() => openDrill(campaign)}
                              title={t.analytics.drillOpen}
                              className="truncate rounded text-left font-medium text-ink underline-offset-2 hover:text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 dark:hover:text-accent-bright"
                            >
                              {campaign.name}
                            </button>
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
            </SectionBody>
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
            <SectionBody
              state={rankingsState}
              skeleton={<Skeleton className="h-56 w-full rounded-lg" />}
              empty={
                <EmptyState
                  size="sm"
                  icon={Gift}
                  title={t.analytics.rewardsEmptyTitle}
                  description={t.analytics.rewardsEmptyDescription}
                />
              }
              isEmpty={(data) => data.rewards.length === 0}
              onRetry={retry}
              retryLabel={t.common.retry}
            >
              {(rankings) => (
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
            </SectionBody>
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
            <SectionBody
              state={rewardState}
              skeleton={<Skeleton className="h-56 w-full rounded-lg" />}
              empty={
                <EmptyState
                  size="sm"
                  icon={Award}
                  title={t.analytics.oddsEmptyTitle}
                  description={t.analytics.oddsEmptyDescription}
                />
              }
              isEmpty={(data) => data.length === 0}
              onRetry={retry}
              retryLabel={t.common.retry}
            >
              {() => (
                <DonutChart
                  slices={oddsSlices}
                  ariaLabel={t.analytics.oddsTitle}
                  centerLabel="%"
                  emptyLabel={t.analytics.oddsEmptyDescription}
                />
              )}
            </SectionBody>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
            {t.analytics.totalsEyebrow}
          </p>
          <CardTitle className="text-lg">{t.analytics.totalsTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <SectionBody
            state={totalsState}
            skeleton={<Skeleton className="h-32 w-full rounded-lg" />}
            empty={
              <EmptyState
                size="sm"
                icon={BarChart3}
                title={t.analytics.totalsEmptyTitle}
                description={t.analytics.totalsEmptyDescription}
              />
            }
            isEmpty={(data) => data.length === 0}
            onRetry={retry}
            retryLabel={t.common.retry}
          >
            {(totals) => (
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
                      {eventLabel(row.event_type)}
                    </p>
                    <p className="numeric mt-2.5 text-[26px] font-semibold leading-none tracking-[-0.03em] text-ink">
                      {row.count}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </SectionBody>
        </CardContent>
      </Card>

      <Modal
        open={drillCampaign !== null}
        onClose={closeDrill}
        size="lg"
        title={t.analytics.drillTitle}
        description={drillCampaign?.name}
      >
        {drillCampaign ? (
          <div className="flex flex-col gap-5">
            <dl className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-line bg-surface-2/60 px-3 py-3 text-center">
                <dd className="numeric text-lg font-semibold tracking-[-0.02em] text-ink">
                  {drillCampaign.participations.toLocaleString()}
                </dd>
                <dt className="mt-0.5 text-[11.5px] leading-snug text-ink-subtle">
                  {interpolate(t.analytics.statPlayers, { range })}
                </dt>
              </div>
              <div className="rounded-lg border border-line bg-surface-2/60 px-3 py-3 text-center">
                <dd className="numeric text-lg font-semibold tracking-[-0.02em] text-ink">
                  {drillCampaign.customers.toLocaleString()}
                </dd>
                <dt className="mt-0.5 text-[11.5px] leading-snug text-ink-subtle">
                  {t.analytics.funnelUniqueCustomers}
                </dt>
              </div>
            </dl>

            <div>
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                {t.analytics.drillEventsEyebrow}
              </p>
              {drillEvents.loading ? (
                <Skeleton className="h-40 w-full rounded-lg" />
              ) : drillEvents.error ? (
                <SectionError
                  message={drillEvents.error}
                  onRetry={() => loadDrillEvents(drillCampaign.id)}
                  retryLabel={t.common.retry}
                />
              ) : (drillEvents.data ?? []).length === 0 ? (
                <EmptyState size="sm" icon={Activity} title={t.analytics.drillEmpty} />
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {(drillEvents.data ?? []).slice(0, 20).map((event) => (
                    <li key={event.id} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
                      <Badge tone={EVENT_TONES[event.event_type] ?? 'neutral'} size="sm">
                        {eventLabel(event.event_type)}
                      </Badge>
                      <span className="numeric shrink-0 text-ink-subtle">
                        {new Date(event.created_at).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function formatOptional(change: number | null): string | undefined {
  return change === null ? undefined : formatChange(change);
}

function toneOf(change: number | null): 'positive' | 'negative' | 'neutral' {
  if (change === null || change === 0) return 'neutral';
  return change > 0 ? 'positive' : 'negative';
}

function InsightTile({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'positive' | 'negative' | 'neutral';
}) {
  const toneClass =
    tone === 'positive'
      ? 'text-success-600 dark:text-success-300'
      : tone === 'negative'
        ? 'text-danger-600 dark:text-danger-300'
        : 'text-ink';
  return (
    <div className="rounded-xl border border-line bg-surface-2/60 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">{label}</p>
      <p className={cn('numeric mt-1.5 text-[19px] font-semibold leading-none tracking-[-0.02em]', toneClass)}>
        {value}
      </p>
      {hint ? <p className="mt-1 text-[12px] text-ink-subtle">{hint}</p> : null}
    </div>
  );
}

function SectionError({ message, onRetry, retryLabel }: { message: string; onRetry: () => void; retryLabel: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger-300/60 bg-danger-50 px-4 py-3 text-sm text-danger-800 dark:border-danger-900/60 dark:bg-danger-900/30 dark:text-danger-200">
      <span>{message}</span>
      <Button variant="outline" size="xs" onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  );
}

/**
 * Renders one card's loading / error / empty / loaded states so a failed
 * section never takes the rest of the page down with it.
 */
function SectionBody<T>({
  state,
  skeleton,
  empty = null,
  isEmpty = () => false,
  onRetry,
  retryLabel,
  children,
}: {
  state: Loadable<T>;
  skeleton: ReactNode;
  empty?: ReactNode;
  isEmpty?: (data: T) => boolean;
  onRetry: () => void;
  retryLabel: string;
  children: (data: T) => ReactNode;
}) {
  if (state.loading) return <>{skeleton}</>;
  if (state.error) return <SectionError message={state.error} onRetry={onRetry} retryLabel={retryLabel} />;
  if (state.data === null) return <>{skeleton}</>;
  if (isEmpty(state.data)) return <>{empty}</>;
  return <>{children(state.data)}</>;
}
