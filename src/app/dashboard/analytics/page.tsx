"use client";

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { AnalyticsService, type AnalyticsTotals } from '@/services/analytics.service';
import { CampaignService, type Campaign } from '@/services/campaign.service';
import { RewardService, type RewardSummary } from '@/services/reward.service';

const EVENT_LABELS: Record<string, string> = {
  PARTICIPATION: 'Campaign participations',
  REWARD_CLAIMED: 'Rewards won',
  COUPON_REDEEMED: 'Coupons redeemed',
  QR_SCANNED: 'QR scans',
};

interface AnalyticsData {
  totals: AnalyticsTotals[];
  campaigns: Campaign[];
  rewards: RewardSummary[];
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      AnalyticsService.overview(),
      CampaignService.getCampaigns({ limit: 100 }),
      RewardService.list(),
    ])
      .then(([overview, campaigns, rewards]) =>
        setData({ totals: overview.totals, campaigns, rewards }),
      )
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unable to load analytics.'));
  }, []);

  const stats = useMemo(() => {
    if (!data) return [];
    const count = (type: string) =>
      data.totals.find((row) => row.event_type === type)?.count ?? 0;

    const participants = count('PARTICIPATION');
    const rewardsWon = count('REWARD_CLAIMED');
    const redeemed = count('COUPON_REDEEMED');
    const scans = count('QR_SCANNED');
    const conversion = participants > 0 ? Math.round((redeemed / participants) * 1000) / 10 : 0;

    return [
      { label: 'Total scans', value: scans },
      { label: 'Total participants', value: participants },
      { label: 'Rewards issued', value: rewardsWon },
      { label: 'Coupons redeemed', value: redeemed },
      { label: 'Conversion rate', value: `${conversion}%` },
    ];
  }, [data]);

  const rewardDistribution = useMemo(() => {
    if (!data) return [];
    const totalWeight = data.rewards.reduce((sum, reward) => sum + (reward.active ? reward.weight : 0), 0);
    return data.rewards
      .filter((reward) => reward.active)
      .map((reward) => ({
        id: reward.id,
        name: reward.name,
        percent: totalWeight > 0 ? Math.round((reward.weight / totalWeight) * 100) : 0,
      }));
  }, [data]);

  const handleExport = () => {
    if (!data) return;
    const rows = [
      ['campaign', 'status', 'participants', 'rewards', 'redemptions', 'conversion_rate'],
      ...data.campaigns.map((campaign) => [
        campaign.name,
        campaign.status,
        String(campaign.participantCount),
        String(campaign.rewardCount),
        String(campaign.redemptionCount),
        String(campaign.conversionRate),
      ]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'campaign-analytics.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-lg border-l-4 border-red-400 bg-red-50 p-6 text-sm text-red-700">{error}</div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Analytics</h2>
          <p className="text-sm text-gray-600">
            Monitor and analyze campaign performance and customer engagement
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={handleExport} disabled={!data}>
            Export Report
          </Button>
        </div>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {!data
          ? Array.from({ length: 5 }).map((_, idx) => (
              <div key={idx} className="animate-pulse rounded-lg border border-gray-200 bg-white p-6">
                <div className="mb-2 h-4 w-24 rounded bg-gray-200" />
                <div className="h-8 w-16 rounded bg-gray-200" />
              </div>
            ))
          : stats.map((stat) => (
              <div key={stat.label} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h3 className="text-sm font-medium text-gray-500 mb-2">{stat.label}</h3>
                <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
              </div>
            ))}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Campaign performance</h3>
          {!data || data.campaigns.length === 0 ? (
            <div className="flex h-48 items-center justify-center rounded-lg bg-gray-100 text-sm text-gray-400">
              No campaigns yet
            </div>
          ) : (
            <div className="space-y-4">
              {data.campaigns.map((campaign) => (
                <div key={campaign.id}>
                  <div className="mb-2 flex items-center justify-between text-sm text-gray-600">
                    <span className="truncate pr-3">{campaign.name}</span>
                    <span className="font-medium text-gray-900">{campaign.conversionRate}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-indigo-500"
                      style={{ width: `${Math.max(campaign.conversionRate, 2)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Reward distribution</h3>
          {!data || rewardDistribution.length === 0 ? (
            <div className="flex h-48 items-center justify-center rounded-lg bg-gray-100 text-sm text-gray-400">
              No rewards configured
            </div>
          ) : (
            <div className="space-y-4">
              {rewardDistribution.map((reward) => (
                <div key={reward.id}>
                  <div className="mb-2 flex items-center justify-between text-sm text-gray-600">
                    <span className="truncate pr-3">{reward.name}</span>
                    <span className="font-medium text-gray-900">{reward.percent}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${Math.max(reward.percent, 2)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Event totals</h3>
        {!data || data.totals.length === 0 ? (
          <p className="text-sm text-gray-500">No activity recorded yet. Share a campaign link to get started.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {data.totals.map((row) => (
              <div key={row.event_type} className="rounded-lg bg-slate-50 p-4">
                <p className="text-sm text-gray-500">{EVENT_LABELS[row.event_type] ?? row.event_type}</p>
                <p className="mt-2 text-2xl font-semibold text-gray-900">{row.count}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
