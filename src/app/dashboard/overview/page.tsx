"use client";

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Award,
  Megaphone,
  Sparkles,
  Ticket,
  TrendingUp,
  UserRound,
  Users,
} from 'lucide-react';
import { AnalyticsService, type AnalyticsSummary, type TimeseriesPoint } from '@/services/analytics.service';
import { CampaignService, type Campaign, type CampaignStatusKey } from '@/services/campaign.service';
import { RewardService, type RewardSummary } from '@/services/reward.service';
import type { BillingAccess } from '@/services/billing.service';
import { useDashboardBilling } from '@/contexts/billing-context';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader, Section } from '@/components/ui/page-header';
import { Progress } from '@/components/ui/toast';
import { Skeleton, SkeletonCard } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import { Sparkline } from '@/components/charts';
import { EntityTile } from '@/components/ui/avatar';
import { interpolate, msg, type Dictionary } from '@/lib/i18n';
import { useLocale, useT } from '@/hooks/use-t';

interface OverviewData {
  summary: AnalyticsSummary | null;
  campaigns: Campaign[];
  rewards: RewardSummary[];
  access: BillingAccess;
  hasAnalytics: boolean;
  daysLeft: number | null;
  /** Last-30-day daily series for the KPI sparklines; null without analytics. */
  timeseries: TimeseriesPoint[] | null;
}

function formatDate(value: string, fallback: string): string {
  return value ? new Date(value).toLocaleDateString() : fallback;
}

const STATUS_TONES: Record<string, BadgeTone> = {
  active: 'success',
  draft: 'warning',
  paused: 'neutral',
  archived: 'neutral',
  scheduled: 'info',
};

function statusLabel(t: Dictionary, status: CampaignStatusKey): string {
  const labels: Record<CampaignStatusKey, string> = {
    draft: t.campaigns.statusDraft,
    scheduled: t.campaigns.statusScheduled,
    active: t.campaigns.statusActive,
    paused: t.campaigns.statusPaused,
    completed: t.campaigns.statusCompleted,
    archived: t.campaigns.statusArchived,
  };
  return labels[status] ?? status;
}

export default function OverviewPage() {
  const t = useT();
  const locale = useLocale();
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Per-section failures: one flaky endpoint no longer blanks the whole page.
  const [sectionErrors, setSectionErrors] = useState<string[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  // The shell already read /api/billing for its plan-gated navigation; reuse
  // it here instead of issuing the same request (and its D1 queries) twice.
  const { access: planAccess, loading: billingLoading } = useDashboardBilling();

  useEffect(() => {
    if (billingLoading) return undefined;
    if (!planAccess) {
      setError(msg(t, 'Unable to load billing.'));
      return undefined;
    }

    const access = planAccess;
    const hasAnalytics = access.plan.features.features.some((feature) => /analytics/i.test(feature));

    void (async () => {
      const [campaignsResult, rewardsResult, overviewResult, timeseriesResult] = await Promise.allSettled([
        CampaignService.getCampaigns({ limit: 20 }),
        RewardService.list(),
        hasAnalytics ? AnalyticsService.overview() : Promise.resolve(null),
        hasAnalytics ? AnalyticsService.timeSeries(30) : Promise.resolve(null),
      ]);

      // Campaigns + rewards are the backbone of the page; without them there
      // is nothing worth rendering. Analytics degrades to an empty state.
      if (campaignsResult.status === 'rejected') {
        setError(msg(t, campaignsResult.reason instanceof Error ? campaignsResult.reason.message : 'Unable to load the overview.'));
        return;
      }
      if (rewardsResult.status === 'rejected') {
        setError(msg(t, rewardsResult.reason instanceof Error ? rewardsResult.reason.message : 'Unable to load the overview.'));
        return;
      }

      const failed: string[] = [];
      if (overviewResult.status === 'rejected') {
        failed.push(msg(t, overviewResult.reason instanceof Error ? overviewResult.reason.message : 'Unable to load analytics.'));
      }
      if (timeseriesResult.status === 'rejected') {
        failed.push(msg(t, 'Unable to load the activity timeline.'));
      }
      setSectionErrors(failed);

      setData({
        summary: overviewResult.status === 'fulfilled' ? (overviewResult.value?.summary ?? null) : null,
        campaigns: campaignsResult.value,
        rewards: rewardsResult.value,
        access,
        hasAnalytics,
        daysLeft: access.endsAt
          ? Math.max(0, Math.ceil((new Date(access.endsAt).getTime() - Date.now()) / 86_400_000))
          : null,
        timeseries: timeseriesResult.status === 'fulfilled' ? timeseriesResult.value : null,
      });
    })();
  }, [t, billingLoading, planAccess, reloadKey]);

  if (error) {
    return (
      <div className="flex flex-col items-start gap-4">
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-danger-300/60 bg-danger-50 p-5 text-sm text-danger-800 dark:border-danger-900/60 dark:bg-danger-900/30 dark:text-danger-200">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger-500" aria-hidden />
          {error}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setError(null);
            setReloadKey((key) => key + 1);
          }}
        >
          {t.common.retry}
        </Button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-7 w-48" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, idx) => (
            <SkeletonCard key={idx} />
          ))}
        </div>
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  const { summary, campaigns, rewards, access, hasAnalytics, timeseries } = data;
  const activeCampaigns = campaigns.filter((campaign) => campaign.status !== 'archived').slice(0, 5);
  const topRewards = [...rewards].sort((a, b) => b.issuedCount - a.issuedCount).slice(0, 5);
  const maxParticipants = Math.max(1, ...campaigns.map((campaign) => campaign.participantCount));

  // Sparkline inputs: daily values over the last 30 days. Customers has no
  // daily event series, so that card stays sparkline-free.
  const sparkline = (pick: (point: TimeseriesPoint) => number): number[] | undefined =>
    timeseries && timeseries.length > 1 ? timeseries.map(pick) : undefined;

  const cards = summary
    ? [
        { label: t.overview.statCustomers, value: summary.customers.toLocaleString(), icon: UserRound },
        {
          label: t.overview.statParticipants,
          value: summary.participations.toLocaleString(),
          icon: Users,
          featured: true,
          spark: sparkline((point) => point.participations),
        },
        {
          label: t.overview.statRewardsIssued,
          value: summary.coupons.toLocaleString(),
          icon: Award,
          spark: sparkline((point) => point.rewardsClaimed),
        },
        {
          label: t.overview.statCouponsRedeemed,
          value: summary.redeemed.toLocaleString(),
          icon: Ticket,
          spark: sparkline((point) => point.couponsRedeemed),
        },
      ]
    : [];

  const planState =
    access.state === 'active'
      ? t.overview.planActive
      : access.state === 'trial'
        ? t.overview.planTrial
        : t.overview.planReadOnly;

  const formatSubDate = (value: string | null): string =>
    value
      ? new Date(value).toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-GB', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      : '—';
  const daysLeft = data.daysLeft;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={hasAnalytics ? t.overview.eyebrowPerformance : t.nav.workspace}
        title={t.overview.title}
        description={t.overview.description}
        actions={
          hasAnalytics ? (
            <Button asChild variant="outline" size="sm">
              <Link to="/dashboard/analytics">
                {t.overview.openAnalytics}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </Button>
          ) : null
        }
      />

      {sectionErrors.length > 0 ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-warning-300/60 bg-warning-50 p-4 text-sm text-warning-800 dark:border-warning-900/60 dark:bg-warning-900/30 dark:text-warning-200">
          <span className="flex-1">{sectionErrors.join(' ')}</span>
          <Button
            variant="outline"
            size="xs"
            onClick={() => {
              setSectionErrors([]);
              setData(null);
              setReloadKey((key) => key + 1);
            }}
          >
            {t.common.retry}
          </Button>
        </div>
      ) : null}

      {cards.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => (
            <StatCard
              key={card.label}
              label={card.label}
              value={card.value}
              icon={card.icon}
              featured={card.featured}
              footer={
                card.spark ? <Sparkline values={card.spark} className="h-7 w-full" /> : undefined
              }
            />
          ))}
        </div>
      ) : null}

      <Section>
        <Card aria-labelledby="current-plan-title">
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-4 space-y-0">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                {t.overview.yourSubscription}
              </p>
              <CardTitle id="current-plan-title" className="text-lg">
                {access.plan.name} · {planState}
              </CardTitle>
            </div>
            <Badge tone={access.state === 'active' ? 'success' : 'warning'} dot size="sm">
              {planState}
            </Badge>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-x-6 gap-y-2 text-[13.5px] text-ink-muted sm:grid-cols-2 lg:grid-cols-3">
              {access.plan.features.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden />
                  <span>{`• ${feature}`}</span>
                </li>
              ))}
              <li className="flex items-start gap-2">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden />
                <span>
                  •{' '}
                  {access.plan.features.limits.customers < 0
                    ? t.overview.unlimited
                    : access.plan.features.limits.customers.toLocaleString()}{' '}
                  {t.overview.customersLabel}
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden />
                <span>
                  •{' '}
                  {access.plan.features.limits.campaigns < 0
                    ? t.overview.unlimited
                    : access.plan.features.limits.campaigns.toLocaleString()}{' '}
                  {t.overview.campaignsLabel}
                </span>
              </li>
            </ul>
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 rounded-lg border border-line bg-elevated/60 p-4 lg:grid-cols-4">
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">{t.overview.startedLabel}</dt>
                <dd className="mt-1 text-[13.5px] font-medium text-ink">{formatSubDate(access.startsAt)}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">{t.overview.periodEndLabel}</dt>
                <dd className="mt-1 text-[13.5px] font-medium text-ink">{formatSubDate(access.endsAt)}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">{t.overview.daysLeftLabel}</dt>
                <dd className="mt-1 text-[13.5px] font-medium text-ink">{daysLeft === null ? '—' : daysLeft}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">{t.overview.channelLabel}</dt>
                <dd className="mt-1 text-[13.5px] font-medium text-ink">{t.overview.channelValue}</dd>
              </div>
            </dl>
            <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <Button asChild size="sm" variant="subtle">
                <Link to="/dashboard/billing">{t.overview.managePlan}</Link>
              </Button>
              <p className="text-[12.5px] text-ink-subtle">{t.overview.planNote}</p>
            </div>
          </CardContent>
        </Card>
      </Section>

      {hasAnalytics && summary ? (
        <div className="grid gap-6 xl:grid-cols-[1.4fr_0.6fr]">
          <Card>
            <CardHeader>
              <p className="text-[13px] text-ink-subtle">{t.overview.conversionPerformance}</p>
              <CardTitle className="text-lg">{t.overview.campaignHealth}</CardTitle>
            </CardHeader>
            <CardContent>
              {campaigns.length === 0 ? (
                <EmptyState
                  size="sm"
                  icon={Megaphone}
                  title={t.overview.noCampaignsTitle}
                  description={t.overview.noCampaignsDescription}
                />
              ) : (
                <ul className="flex flex-col gap-5">
                  {campaigns.slice(0, 5).map((campaign) => (
                    <li key={campaign.id}>
                      <div className="mb-2 flex items-center justify-between gap-3 text-[13.5px]">
                        <span className="truncate text-ink">{campaign.name}</span>
                        <span className="numeric shrink-0 font-semibold text-ink">
                          {campaign.conversionRate}%
                        </span>
                      </div>
                      <Progress
                        value={campaign.conversionRate}
                        label={interpolate(t.overview.campaignConversion, { name: campaign.name })}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <p className="text-[13px] text-ink-subtle">{t.overview.participation}</p>
              <CardTitle className="text-lg">{t.overview.totalEntrants}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="rounded-xl border border-accent/30 bg-accent-soft/60 p-4 dark:border-accent/25 dark:bg-accent-soft">
                <p className="numeric text-[26px] font-semibold leading-none tracking-[-0.03em] text-ink">
                  {summary.participations}
                </p>
                <p className="mt-1.5 flex items-center gap-1.5 text-[13px] font-medium text-brand-800 dark:text-accent-bright">
                  <TrendingUp className="h-3.5 w-3.5" aria-hidden />
                  {t.overview.campaignParticipations}
                </p>
              </div>
              <div className="rounded-xl border border-line bg-surface-2/60 p-4">
                <p className="numeric text-[26px] font-semibold leading-none tracking-[-0.03em] text-ink">
                  {summary.customers}
                </p>
                <p className="mt-1.5 text-[13px] font-medium text-ink-muted">{t.overview.knownCustomers}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>{t.overview.campaignsTitle}</CardTitle>
            <Button asChild variant="ghost" size="xs">
              <Link to="/dashboard/campaigns">
                {t.overview.manageAll}
                <ArrowRight className="h-3 w-3" aria-hidden />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {activeCampaigns.length === 0 ? (
              <EmptyState
                size="sm"
                icon={Megaphone}
                title={t.overview.emptyCampaignsTitle}
                description={t.overview.emptyCampaignsDescription}
                action={
                  <Button asChild size="sm">
                    <Link to="/dashboard/campaigns">{t.overview.createCampaign}</Link>
                  </Button>
                }
              />
            ) : (
              <ul className="flex flex-col gap-3">
                {activeCampaigns.map((campaign) => (
                  <li
                    key={campaign.id}
                    className="group rounded-xl border border-line bg-surface-2/50 p-4 transition-[border-color,background-color] duration-180 hover:border-accent/40 hover:bg-accent-soft/30"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <h4 className="truncate text-[14px] font-semibold text-ink">{campaign.name}</h4>
                        <p className="mt-1 text-[12.5px] text-ink-subtle">
                          {hasAnalytics
                            ? interpolate(t.overview.participantsSuffix, {
                                count: campaign.participantCount,
                              })
                            : ''}
                          {interpolate(t.overview.endsOn, {
                            date: formatDate(campaign.endsAt, t.overview.noEndDate),
                          })}
                        </p>
                      </div>
                      <Badge tone={STATUS_TONES[campaign.status] ?? 'neutral'} size="sm" dot>
                        {statusLabel(t, campaign.status)}
                      </Badge>
                    </div>
                    {hasAnalytics ? (
                      <Progress
                        className="mt-3.5"
                        value={(campaign.participantCount / maxParticipants) * 100}
                        label={interpolate(t.overview.participantsRelative, { name: campaign.name })}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {hasAnalytics ? (
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>{t.overview.topRewards}</CardTitle>
              <Button asChild variant="ghost" size="xs">
                <Link to="/dashboard/rewards">
                  {t.overview.viewAll}
                  <ArrowRight className="h-3 w-3" aria-hidden />
                </Link>
              </Button>
            </CardHeader>
            <CardContent>
              {topRewards.length === 0 ? (
                <EmptyState
                  size="sm"
                  icon={Award}
                  title={t.overview.noRewardsTitle}
                  description={t.overview.noRewardsDescription}
                />
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {topRewards.map((reward) => (
                    <li
                      key={reward.id}
                      className="flex items-start gap-3 rounded-xl border border-line p-3 transition-colors duration-180 hover:border-accent/40"
                    >
                      <EntityTile>{reward.issuedCount}</EntityTile>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] text-ink">
                          <span className="font-semibold">{reward.name}</span>{' '}
                          {interpolate(t.overview.rewardIssued, {
                            count: reward.issuedCount,
                            s: reward.issuedCount === 1 ? '' : 's',
                          })}
                        </p>
                        <p className="mt-0.5 truncate text-[12px] text-ink-subtle">{reward.campaignName}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>{t.overview.nextSteps}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2.5">
                {[
                  { to: '/dashboard/campaigns', label: t.overview.stepCampaign, icon: Megaphone },
                  { to: '/dashboard/wheel', label: t.overview.stepWheel, icon: Sparkles },
                  { to: '/dashboard/qr-codes', label: t.overview.stepQr, icon: Ticket },
                ].map((item) => (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      className="flex items-center gap-3 rounded-lg border border-line px-3.5 py-3 text-[13.5px] font-medium text-ink transition-colors duration-180 hover:border-accent/40 hover:bg-accent-soft/30"
                    >
                      <item.icon className="h-4 w-4 shrink-0 text-brand-600 dark:text-accent-bright" aria-hidden />
                      {item.label}
                      <ArrowRight className="ml-auto h-3.5 w-3.5 text-ink-subtle" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}