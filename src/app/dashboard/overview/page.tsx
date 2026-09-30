"use client";

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnalyticsService, type AnalyticsSummary } from '@/services/analytics.service';
import { CampaignService, type Campaign } from '@/services/campaign.service';
import { RewardService, type RewardSummary } from '@/services/reward.service';

interface OverviewData {
  summary: AnalyticsSummary;
  campaigns: Campaign[];
  rewards: RewardSummary[];
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString();
}

export default function OverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([AnalyticsService.overview(), CampaignService.getCampaigns({ limit: 20 }), RewardService.list()])
      .then(([overview, campaigns, rewards]) =>
        setData({ summary: overview.summary, campaigns, rewards }),
      )
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unable to load the overview.'));
  }, []);

  if (error) {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">{error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="animate-pulse rounded-2xl border border-slate-200 bg-white p-5">
              <div className="mb-4 h-3 w-20 rounded bg-slate-200" />
              <div className="mb-2 h-8 w-24 rounded bg-slate-200" />
              <div className="h-3 w-14 rounded bg-slate-200" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const { summary, campaigns, rewards } = data;
  const activeCampaigns = campaigns.filter((campaign) => campaign.status !== 'archived').slice(0, 5);
  const topRewards = [...rewards].sort((a, b) => b.issuedCount - a.issuedCount).slice(0, 5);
  const maxParticipants = Math.max(1, ...campaigns.map((campaign) => campaign.participantCount));

  const cards = [
    { label: 'Total customers', value: summary.customers.toLocaleString() },
    { label: 'Campaign participants', value: summary.participations.toLocaleString() },
    { label: 'Rewards issued', value: summary.coupons.toLocaleString() },
    { label: 'Coupons redeemed', value: summary.coupons.toLocaleString() },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Performance snapshot</p>
          <h2 className="mt-1 text-2xl font-semibold text-slate-900">Overview</h2>
        </div>
        <Link
          to="/dashboard/analytics"
          className="rounded-xl bg-indigo-600 px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-indigo-500"
        >
          Open analytics
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">{card.label}</p>
            <p className="mt-3 text-3xl font-semibold text-slate-900">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_0.6fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-500">Conversion performance</p>
              <h3 className="mt-1 text-xl font-semibold text-slate-900">Campaign health</h3>
            </div>
          </div>

          {campaigns.length === 0 ? (
            <p className="text-sm text-slate-500">
              No campaigns yet. Create your first campaign to start collecting participants.
            </p>
          ) : (
            <div className="space-y-5">
              {campaigns.slice(0, 5).map((campaign) => (
                <div key={campaign.id}>
                  <div className="mb-2 flex items-center justify-between text-sm text-slate-600">
                    <span>{campaign.name}</span>
                    <span className="font-medium text-slate-900">{campaign.conversionRate}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-500"
                      style={{ width: `${Math.max(campaign.conversionRate, 2)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-5">
            <p className="text-sm text-slate-500">Participation</p>
            <h3 className="mt-1 text-xl font-semibold text-slate-900">Total entrants</h3>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl bg-indigo-50 p-4">
              <p className="text-3xl font-semibold text-slate-900">{summary.participations}</p>
              <p className="mt-1 text-sm text-indigo-700">Campaign participations</p>
            </div>
            <div className="rounded-2xl bg-emerald-50 p-4">
              <p className="text-3xl font-semibold text-slate-900">{summary.customers}</p>
              <p className="mt-1 text-sm text-emerald-700">Known customers</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-xl font-semibold text-slate-900">Campaigns</h3>
            <Link to="/dashboard/campaigns" className="text-sm font-medium text-indigo-600">
              Manage all
            </Link>
          </div>

          <div className="space-y-4">
            {activeCampaigns.length === 0 ? (
              <p className="text-sm text-slate-500">Nothing here yet.</p>
            ) : (
              activeCampaigns.map((campaign) => (
                <div key={campaign.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h4 className="font-medium text-slate-900">{campaign.name}</h4>
                      <p className="mt-1 text-sm text-slate-500">
                        {campaign.participantCount} participants · ends {formatDate(campaign.endsAt)}
                      </p>
                    </div>
                    <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700">
                      {campaign.status}
                    </span>
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-indigo-500"
                      style={{ width: `${Math.max((campaign.participantCount / maxParticipants) * 100, 2)}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-xl font-semibold text-slate-900">Top rewards</h3>
            <Link to="/dashboard/rewards" className="text-sm font-medium text-indigo-600">
              View all
            </Link>
          </div>

          <div className="space-y-4">
            {topRewards.length === 0 ? (
              <p className="text-sm text-slate-500">Add rewards to a campaign to see them here.</p>
            ) : (
              topRewards.map((reward) => (
                <div key={reward.id} className="flex items-start gap-3 rounded-2xl border border-slate-200 p-3">
                  <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                    {reward.issuedCount}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-900">
                      <span className="font-medium">{reward.name}</span> issued {reward.issuedCount} time
                      {reward.issuedCount === 1 ? '' : 's'}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">{reward.campaignName}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
