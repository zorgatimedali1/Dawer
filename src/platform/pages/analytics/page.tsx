import { useCallback, useEffect, useState } from 'react';
import { Activity, Gift, Mail, MessageCircle, Percent, UserPlus } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import StatCard from '@/components/ui/stat-card';
import {
  BarChart,
  LineChart,
  MetricBar,
} from '@/platform/components/charts';
import {
  StatsService,
  type ActivityStats,
  type MarketingStats,
  type UsersStats,
} from '@/platform/services/stats.service';

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
] as const;

export default function AnalyticsPage() {
  const [days, setDays] = useState<number>(30);
  const [users, setUsers] = useState<UsersStats | null>(null);
  const [activity, setActivity] = useState<ActivityStats | null>(null);
  const [marketing, setMarketing] = useState<MarketingStats | null>(null);
  const [growth, setGrowth] = useState<{
    signups: Array<{ day: string; total: number }>;
    businesses: Array<{ day: string; total: number }>;
    campaigns: Array<{ day: string; total: number }>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (window: number) => {
    setLoading(true);
    setError(null);

    try {
      const [usersResult, activityResult, marketingResult, growthResult] = await Promise.all([
        StatsService.users(10),
        StatsService.activity(window),
        StatsService.marketing(),
        StatsService.growth(window),
      ]);
      setUsers(usersResult);
      setActivity(activityResult);
      setMarketing(marketingResult);
      setGrowth(growthResult.series);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Unable to load analytics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(days);
  }, [load, days]);

  const exportCsv = () => {
    if (!activity) return;

    const rows = [
      ['day', 'participations', 'rewards_claimed', 'coupons_issued', 'new_customers'],
      ...activity.series.participations.map((point, index) => [
        point.day,
        String(point.total),
        String(activity.series.rewardsClaimed[index]?.total ?? 0),
        String(activity.series.couponsIssued[index]?.total ?? 0),
        String(activity.series.newCustomers[index]?.total ?? 0),
      ]),
    ];

    const csv = rows.map((row) => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `platform-activity-${days}d.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const signupPoints = (growth?.signups ?? []).map((point, index) => ({
    label: point.day.slice(5),
    values: [
      point.total,
      growth?.businesses[index]?.total ?? 0,
      growth?.campaigns[index]?.total ?? 0,
    ],
  }));

  const totals = activity?.totals;
  const waCloud = marketing?.whatsapp.cloud;
  const waWeb = marketing?.whatsapp.web;
  const emailStats = marketing?.email;
  const maxVolume = Math.max(waCloud?.sent ?? 0, waWeb?.sent ?? 0, emailStats?.sent ?? 0, 1);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Platform"
        title="Platform analytics"
        description="Accounts, engagement and marketing volume across every merchant"
        actions={
          <div className="flex items-end gap-3">
            <Field label={<span className="sr-only">Date range</span>} htmlFor="analytics-range">
              <Select
                id="analytics-range"
                inputSize="sm"
                value={String(days)}
                onChange={(event) => setDays(Number(event.target.value))}
              >
                {RANGES.map((range) => (
                  <option key={range.days} value={range.days}>
                    {range.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!activity}>
              Export CSV
            </Button>
          </div>
        }
      />

      {error && (
        <div
          role="alert"
          className="rounded-lg border-l-4 border-danger-400 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-900/60 dark:bg-danger-900/30 dark:text-danger-200"
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Card key={index} className="h-32 animate-pulse bg-surface-2" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              featured
              label="Total accounts"
              value={(users?.totals.totalUsers ?? 0).toLocaleString()}
              icon={UserPlus}
              delta={`+${users?.totals.newUsers7d ?? 0} this week`}
              deltaTone="positive"
              hint={`${users?.totals.newUsers30d ?? 0} joined in 30 days`}
            />
            <StatCard
              label="Participations"
              value={(totals?.participations ?? 0).toLocaleString()}
              icon={Activity}
              hint={`${(totals?.rewardsClaimed ?? 0).toLocaleString()} rewards claimed`}
            />
            <StatCard
              label="Coupons redeemed"
              value={(totals?.couponsRedeemed ?? 0).toLocaleString()}
              icon={Percent}
              hint={`${totals?.redemptionRate ?? 0}% of ${(totals?.couponsIssued ?? 0).toLocaleString()} issued`}
            />
            <StatCard
              label="Messages sent"
              value={(marketing?.whatsapp.totalSent ?? 0).toLocaleString()}
              icon={MessageCircle}
              hint={`${(marketing?.email.sent ?? 0).toLocaleString()} emails`}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <div className="p-5 sm:p-6">
                <div className="mb-4">
                  <h3 className="text-base font-medium text-ink">Platform growth</h3>
                  <p className="text-sm text-ink-muted">Signups, new businesses and new campaigns</p>
                </div>
                <LineChart
                  points={signupPoints}
                  series={[
                    { key: 'signups', label: 'Signups', variable: '--series-1' },
                    { key: 'businesses', label: 'Businesses', variable: '--series-2' },
                    { key: 'campaigns', label: 'Campaigns', variable: '--series-3' },
                  ]}
                  ariaLabel="Platform growth over time"
                />
              </div>
            </Card>

            <Card>
              <div className="p-5 sm:p-6">
                <div className="mb-4 flex items-baseline justify-between gap-3">
                  <div>
                    <h3 className="text-base font-medium text-ink">Daily engagement</h3>
                    <p className="text-sm text-ink-muted">Participations over the last {days} days</p>
                  </div>
                  <Badge size="sm">{days}d</Badge>
                </div>
                <BarChart
                  data={(activity?.series.participations ?? []).map((point) => ({
                    label: point.day.slice(5),
                    value: point.total,
                    title: point.day,
                  }))}
                  ariaLabel="Daily participations"
                />
              </div>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <div className="p-5 sm:p-6">
                <div className="mb-5">
                  <h3 className="text-base font-medium text-ink">Marketing volume</h3>
                  <p className="text-sm text-ink-muted">Total messages and emails sent across the platform</p>
                </div>
                <div className="flex flex-col gap-5">
                  <MetricBar
                    label="WhatsApp (Cloud API)"
                    value={waCloud?.sent ?? 0}
                    max={maxVolume}
                    hint={`${waCloud?.campaigns ?? 0} campaigns · ${waCloud?.deliveryRate ?? 0}% delivered`}
                  />
                  <MetricBar
                    label="WhatsApp (gateway)"
                    value={waWeb?.sent ?? 0}
                    max={maxVolume}
                    hint={`${waWeb?.campaigns ?? 0} campaigns`}
                  />
                  <MetricBar
                    label="Email"
                    value={emailStats?.sent ?? 0}
                    max={maxVolume}
                    hint={`${emailStats?.campaigns ?? 0} campaigns · ${emailStats?.suppressed ?? 0} suppressed`}
                  />
                </div>

                <dl className="mt-6 grid grid-cols-2 gap-3 border-t border-line pt-5 sm:grid-cols-4">
                  <MarketingRate label="WA delivery" value={waCloud?.deliveryRate ?? 0} icon={MessageCircle} />
                  <MarketingRate label="WA failures" value={waWeb?.failureRate ?? 0} invert icon={MessageCircle} />
                  <MarketingRate label="Email failures" value={emailStats?.failureRate ?? 0} invert icon={Mail} />
                  <MarketingRate label="Redemption" value={totals?.redemptionRate ?? 0} icon={Gift} />
                </dl>
              </div>
            </Card>

            <Card>
              <div className="p-5 sm:p-6">
                <h3 className="mb-4 text-base font-medium text-ink">Account health</h3>
                <ul className="flex flex-col gap-3 text-sm">
                  <HealthRow label="Active accounts" value={users?.totals.activeUsers ?? 0} total={users?.totals.totalUsers ?? 0} />
                  <HealthRow label="Suspended" value={users?.totals.suspendedUsers ?? 0} total={users?.totals.totalUsers ?? 0} />
                  <HealthRow
                    label="With members"
                    value={users?.totals.tenantsWithMembers ?? 0}
                    total={users?.totals.totalBusinesses ?? 0}
                  />
                </ul>

                <div className="mt-5 border-t border-line pt-4">
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                    Plan distribution
                  </p>
                  <ul className="flex flex-col gap-2.5">
                    {(users?.planDistribution ?? []).map((plan) => (
                      <li key={plan.slug} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-ink-muted">{plan.name}</span>
                        <span className="numeric font-semibold text-ink">{plan.activeSubscriptions}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Card>
          </div>

          <Card>
            <div className="p-5 sm:p-6">
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <h3 className="text-base font-medium text-ink">Top businesses</h3>
                  <p className="text-sm text-ink-muted">Ranked by participations</p>
                </div>
                <span className="text-sm text-ink-subtle">
                  {(users?.totals.totalBusinesses ?? 0).toLocaleString()} businesses total
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.08em] text-ink-subtle">
                      <th className="py-2 pr-4 font-semibold">Business</th>
                      <th className="py-2 pr-4 text-right font-semibold">Campaigns</th>
                      <th className="py-2 pr-4 text-right font-semibold">Customers</th>
                      <th className="py-2 text-right font-semibold">Participations</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(users?.topBusinesses ?? []).map((business, index) => (
                      <tr key={business.id} className="border-b border-line/60 last:border-0">
                        <td className="py-2.5 pr-4">
                          <span className="numeric mr-2 text-xs text-ink-subtle">{index + 1}.</span>
                          <span className="font-medium text-ink">{business.name}</span>
                          <span className="ml-2 text-xs text-ink-subtle">/{business.slug}</span>
                        </td>
                        <td className="numeric py-2.5 pr-4 text-right text-ink-muted">{business.campaigns}</td>
                        <td className="numeric py-2.5 pr-4 text-right text-ink-muted">{business.customers}</td>
                        <td className="numeric py-2.5 text-right font-semibold text-ink">
                          {business.participations.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>

          <Card>
            <div className="p-5 sm:p-6">
              <h3 className="mb-4 text-base font-medium text-ink">Recent signups</h3>
              <ul className="divide-y divide-line">
                {(users?.recentUsers ?? []).map((user) => (
                  <li key={user.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">
                        {user.firstName} {user.lastName}
                      </p>
                      <p className="truncate text-xs text-ink-muted">{user.email}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <Badge tone={user.status === 'ACTIVE' ? 'success' : 'danger'} size="sm">
                        {user.status === 'ACTIVE' ? 'Active' : 'Suspended'}
                      </Badge>
                      <span className="text-xs text-ink-subtle">{new Date(user.createdAt).toLocaleDateString()}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function HealthRow({ label, value, total }: { label: string; value: number; total: number }) {
  const percent = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="text-ink-muted">{label}</span>
      <span className="numeric font-semibold text-ink">
        {value.toLocaleString()}
        <span className="ml-2 text-xs font-normal text-ink-subtle">{percent}%</span>
      </span>
    </li>
  );
}

function MarketingRate({ label, value, invert = false, icon: Icon }: { label: string; value: number; invert?: boolean; icon: typeof Mail }) {
  const good = invert ? value <= 5 : value >= 80;
  const tone = good ? 'text-success-600 dark:text-success-300' : 'text-ink';
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-[11.5px] text-ink-subtle">
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {label}
      </dt>
      <dd className={`numeric mt-1 text-lg font-semibold ${tone}`}>{value}%</dd>
    </div>
  );
}
