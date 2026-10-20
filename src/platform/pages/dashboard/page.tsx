import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Banknote,
  Briefcase,
  Gauge,
  Users,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import StatCard from '@/components/ui/stat-card';
import { BarChart, DonutChart, LineChart, type DonutSlice } from '@/components/charts';
import {
  StatsService,
  formatTND,
  formatTNDCompact,
  type PlanStat,
  type PlatformFeatures,
} from '@/platform/services/stats.service';

const SERIES_VARS = ['--series-1', '--series-2', '--series-3'];

interface OverviewData {
  revenue: {
    collectedAllTimeCents: number;
    collectedThisMonthCents: number;
    collectedLastMonthCents: number;
    growthPercent: number;
    monthlyRecurringCents: number;
    pipelineCents: number;
    currency: string;
  };
  accounts: {
    totalUsers: number;
    activeUsers: number;
    suspendedUsers: number;
    newUsers30d: number;
    totalBusinesses: number;
  };
  activity: { totalCampaigns: number; totalCustomers: number; participations: number };
  subscriptions: { active: number; topPlans: Array<{ name: string; slug: string; subs: number }> };
}

export default function DashboardPage() {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [revenueSeries, setRevenueSeries] = useState<Array<{ month: string; collectedCents: number; approvals: number }>>([]);
  const [plans, setPlans] = useState<PlanStat[]>([]);
  const [growth, setGrowth] = useState<{
    signups: Array<{ day: string; total: number }>;
    businesses: Array<{ day: string; total: number }>;
  } | null>(null);
  const [features, setFeatures] = useState<PlatformFeatures | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [overviewResult, revenueResult, plansResult, growthResult, featuresResult] = await Promise.all([
        StatsService.overview(),
        StatsService.revenue(12),
        StatsService.plans(),
        StatsService.growth(90),
        StatsService.platformFeatures(),
      ]);
      setOverview(overviewResult.overview);
      setRevenueSeries(revenueResult.series);
      setPlans(plansResult.plans);
      setGrowth({
        signups: growthResult.series.signups,
        businesses: growthResult.series.businesses,
      });
      setFeatures(featuresResult.features);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Unable to load the dashboard.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleFeature = async (
    key: 'whatsappEnabled' | 'emailEnabled' | 'smsEnabled' | 'wheelDesignEnabled' | 'rewardsEnabled',
    value: boolean,
  ) => {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const result = await StatsService.setPlatformFeatures({ [key]: value });
      setFeatures(result.features);
      const label =
        key === 'whatsappEnabled'
          ? 'WhatsApp'
          : key === 'emailEnabled'
            ? 'Email marketing'
            : key === 'smsEnabled'
              ? 'SMS marketing'
              : key === 'wheelDesignEnabled'
                ? 'Wheel design'
                : 'Rewards';
      setNotice(`${label} is now ${value ? 'enabled' : 'disabled'} platform-wide.`);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Unable to update the switch.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader eyebrow="Platform" title="Dashboard" description="Revenue, growth and platform controls at a glance" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Card key={index} className="h-32 animate-pulse bg-surface-2" />
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="h-72 animate-pulse bg-surface-2" />
          <Card className="h-72 animate-pulse bg-surface-2" />
        </div>
      </div>
    );
  }

  const revenue = overview?.revenue;
  const planSlices: DonutSlice[] = plans
    .filter((plan) => plan.activeSubscriptions > 0)
    .map((plan, index) => ({
      label: plan.name,
      value: plan.activeSubscriptions,
      variable: SERIES_VARS[index % SERIES_VARS.length] ?? '--series-1',
    }));

  const growthPoints = (growth?.signups ?? []).map((point, index) => ({
    label: point.day.slice(5),
    values: [point.total, growth?.businesses[index]?.total ?? 0],
  }));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Platform"
        title="Dashboard"
        description="Revenue, growth and platform controls at a glance"
        actions={
          <Button variant="outline" asChild>
            <Link to="/analytics">Full analytics</Link>
          </Button>
        }
      />

      {notice && (
        <div
          role="status"
          className="rounded-lg border-l-4 border-success-400 bg-success-50 px-4 py-3 text-sm text-success-800 dark:border-success-900/60 dark:bg-success-900/30 dark:text-success-200"
        >
          {notice}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-lg border-l-4 border-danger-400 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-900/60 dark:bg-danger-900/30 dark:text-danger-200"
        >
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          featured
          label="Revenue this month"
          value={`${formatTND(revenue?.collectedThisMonthCents ?? 0)} DT`}
          icon={Banknote}
          delta={
            revenue && revenue.collectedLastMonthCents > 0
              ? `${revenue.growthPercent >= 0 ? '+' : ''}${revenue.growthPercent}% vs last month`
              : undefined
          }
          deltaTone={(revenue?.growthPercent ?? 0) >= 0 ? 'positive' : 'negative'}
          hint="Settled over WhatsApp"
        />
        <StatCard
          label="Monthly recurring"
          value={`${formatTND(revenue?.monthlyRecurringCents ?? 0)} DT`}
          icon={Gauge}
          hint="Active plans, normalized"
        />
        <StatCard
          label="All-time revenue"
          value={formatTNDCompact(revenue?.collectedAllTimeCents ?? 0)}
          icon={Briefcase}
          hint={`${formatTND(revenue?.pipelineCents ?? 0)} DT pending pipeline`}
        />
        <StatCard
          label="Accounts"
          value={(overview?.accounts.totalUsers ?? 0).toLocaleString()}
          icon={Users}
          delta={`+${overview?.accounts.newUsers30d ?? 0} this month`}
          deltaTone="positive"
          hint={`${overview?.accounts.activeUsers ?? 0} active · ${overview?.subscriptions.active ?? 0} subscriptions`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <div className="p-5 sm:p-6">
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <div>
                <h3 className="text-base font-medium text-ink">Chiffre d&apos;affaires</h3>
                <p className="text-sm text-ink-muted">Collected revenue per month, last 12 months</p>
              </div>
              <Badge size="sm">TND</Badge>
            </div>
            <BarChart
              data={revenueSeries.map((point) => ({
                label: point.month.slice(2),
                value: point.collectedCents,
                title: `${point.month} · ${point.approvals} approval${point.approvals === 1 ? '' : 's'}`,
              }))}
              ariaLabel="Monthly collected revenue"
              formatValue={(value) => `${formatTND(value)} DT`}
            />
          </div>
        </Card>

        <Card>
          <div className="p-5 sm:p-6">
            <div className="mb-4">
              <h3 className="text-base font-medium text-ink">Plan distribution</h3>
              <p className="text-sm text-ink-muted">Active subscriptions by plan</p>
            </div>
            <DonutChart slices={planSlices} ariaLabel="Active subscriptions by plan" centerLabel="subscriptions" emptyLabel="No subscriptions yet." />
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="p-5 sm:p-6">
            <div className="mb-4">
              <h3 className="text-base font-medium text-ink">Growth</h3>
              <p className="text-sm text-ink-muted">New signups and new businesses, last 90 days</p>
            </div>
            <LineChart
              points={growthPoints}
              series={[
                { key: 'signups', label: 'Signups', variable: '--series-1' },
                { key: 'businesses', label: 'Businesses', variable: '--series-2' },
              ]}
              ariaLabel="Daily signups and new businesses"
            />
          </div>
        </Card>

        <Card>
          <div className="p-5 sm:p-6">
            <h3 className="mb-4 text-base font-medium text-ink">Platform controls</h3>
            <p className="mb-4 text-sm text-ink-muted">
              Switches every merchant on or off immediately. Each account can still be overridden afterwards.
            </p>

            <div className="flex flex-col gap-3">
              <FeatureSwitch
                id="platform-whatsapp"
                label="WhatsApp marketing"
                checked={features?.whatsappEnabled ?? true}
                disabled={busy}
                onToggle={(value) => void toggleFeature('whatsappEnabled', value)}
              />
              <FeatureSwitch
                id="platform-email"
                label="Email marketing"
                checked={features?.emailEnabled ?? true}
                disabled={busy}
                onToggle={(value) => void toggleFeature('emailEnabled', value)}
              />
              <FeatureSwitch
                id="platform-sms"
                label="SMS marketing"
                checked={features?.smsEnabled ?? true}
                disabled={busy}
                onToggle={(value) => void toggleFeature('smsEnabled', value)}
              />
              <FeatureSwitch
                id="platform-wheel-design"
                label="Wheel design"
                checked={features?.wheelDesignEnabled ?? true}
                disabled={busy}
                onToggle={(value) => void toggleFeature('wheelDesignEnabled', value)}
              />
              <FeatureSwitch
                id="platform-rewards"
                label="Rewards"
                checked={features?.rewardsEnabled ?? true}
                disabled={busy}
                onToggle={(value) => void toggleFeature('rewardsEnabled', value)}
              />
            </div>

            <div className="mt-5 border-t border-line pt-4">
              <p className="text-sm text-ink-muted">
                Override a single channel from the{' '}
                <Link to="/accounts" className="font-medium text-brand-600 underline-offset-2 hover:underline dark:text-brand-400">
                  Accounts
                </Link>{' '}
                page.
              </p>
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <div className="p-5 sm:p-6">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <h3 className="text-base font-medium text-ink">Revenue by plan</h3>
              <p className="text-sm text-ink-muted">All-time collected revenue and active subscriptions per plan</p>
            </div>
            <span className="text-sm text-ink-subtle">
              {overview?.activity.participations.toLocaleString()} participations ·{' '}
              {overview?.activity.totalCustomers.toLocaleString()} customers
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.08em] text-ink-subtle">
                  <th className="py-2 pr-4 font-semibold">Plan</th>
                  <th className="py-2 pr-4 text-right font-semibold">Price</th>
                  <th className="py-2 pr-4 text-right font-semibold">Active</th>
                  <th className="py-2 pr-4 text-right font-semibold">Approvals</th>
                  <th className="py-2 text-right font-semibold">Collected</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((plan) => (
                  <tr key={plan.id} className="border-b border-line/60 last:border-0">
                    <td className="py-2.5 pr-4 font-medium text-ink">{plan.name}</td>
                    <td className="numeric py-2.5 pr-4 text-right text-ink-muted">{formatTND(plan.priceCents)} DT</td>
                    <td className="numeric py-2.5 pr-4 text-right text-ink">{plan.activeSubscriptions}</td>
                    <td className="numeric py-2.5 pr-4 text-right text-ink">{plan.approvals}</td>
                    <td className="numeric py-2.5 text-right font-semibold text-ink">{formatTND(plan.collectedCents)} DT</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Card>
    </div>
  );
}

function FeatureSwitch({
  id,
  label,
  checked,
  disabled,
  onToggle,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  onToggle: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-2/60 px-3.5 py-3">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-sm font-medium text-ink">{label}</span>
        <span className="block text-xs text-ink-muted">{checked ? 'Enabled' : 'Disabled'}</span>
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onToggle(!checked)}
        className={
          checked
            ? 'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-brand-500 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:opacity-60'
            : 'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-line-strong transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:opacity-60'
        }
      >
        <span
          aria-hidden
          className={
            checked
              ? 'inline-block h-5 w-5 translate-x-[22px] rounded-full bg-white shadow transition-transform duration-200'
              : 'inline-block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow transition-transform duration-200'
          }
        />
      </button>
    </div>
  );
}
