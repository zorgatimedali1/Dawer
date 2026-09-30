"use client";

import { useEffect, useState } from 'react';

const initialStats = {
  totalCustomers: 1247,
  newCustomers: 89,
  campaignParticipants: 342,
  rewardsIssued: 156,
  couponsRedeemed: 98,
  conversionRate: 68.5,
  returnRate: 42.3,
};

const campaignPerformance = [
  { label: 'QR', value: 85 },
  { label: 'Wheel', value: 71 },
  { label: 'Referral', value: 62 },
  { label: 'Email', value: 53 },
  { label: 'In-store', value: 48 },
];

const recentActivity = [
  { name: 'Maria G.', action: 'redeemed 10% OFF', time: '5 mins ago', tone: 'emerald' },
  { name: 'Alina R.', action: 'joined Summer Splash', time: '28 mins ago', tone: 'indigo' },
  { name: 'Marcus T.', action: 'won Free Dessert', time: '1 hr ago', tone: 'amber' },
  { name: 'Jasmine L.', action: 'updated profile consent', time: '2 hrs ago', tone: 'slate' },
];

const activeCampaigns = [
  { name: 'Summer Splash', status: 'Active', participants: 234, conversion: '68.5%', revenue: '$4,280' },
  { name: 'Holiday Booster', status: 'Scheduled', participants: 86, conversion: '46.3%', revenue: '$1,940' },
  { name: 'Loyalty Loop', status: 'Active', participants: 162, conversion: '81.2%', revenue: '$6,180' },
];

export default function OverviewPage() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 700);
    return () => clearTimeout(timer);
  }, []);

  if (loading) {
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Performance snapshot</p>
          <h2 className="mt-1 text-2xl font-semibold text-slate-900">Overview</h2>
        </div>
        <button type="button" className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500">Export report</button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Total customers', value: initialStats.totalCustomers.toLocaleString(), change: '+89 this month', color: 'indigo' },
          { label: 'Campaign participants', value: initialStats.campaignParticipants.toLocaleString(), change: '+12.4% vs last month', color: 'emerald' },
          { label: 'Rewards issued', value: initialStats.rewardsIssued.toLocaleString(), change: '+8.1% vs last month', color: 'amber' },
          { label: 'Coupons redeemed', value: initialStats.couponsRedeemed.toLocaleString(), change: '+15.2% vs last month', color: 'cyan' },
        ].map((card) => (
          <div key={card.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">{card.label}</p>
            <p className="mt-3 text-3xl font-semibold text-slate-900">{card.value}</p>
            <p className="mt-2 text-xs font-medium text-emerald-600">{card.change}</p>
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
            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">+5.2% MoM</span>
          </div>

          <div className="space-y-5">
            {campaignPerformance.map((bar) => (
              <div key={bar.label}>
                <div className="mb-2 flex items-center justify-between text-sm text-slate-600">
                  <span>{bar.label}</span>
                  <span className="font-medium text-slate-900">{bar.value}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-500" style={{ width: `${bar.value}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-500">Customer retention</p>
              <h3 className="mt-1 text-xl font-semibold text-slate-900">Return rate</h3>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl bg-indigo-50 p-4">
              <p className="text-3xl font-semibold text-slate-900">{initialStats.returnRate}%</p>
              <p className="mt-1 text-sm text-indigo-700">Repeat customer rate</p>
            </div>
            <div className="rounded-2xl bg-emerald-50 p-4">
              <p className="text-3xl font-semibold text-slate-900">{initialStats.conversionRate}%</p>
              <p className="mt-1 text-sm text-emerald-700">Campaign conversion</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-xl font-semibold text-slate-900">Active campaigns</h3>
            <button type="button" className="text-sm font-medium text-indigo-600">Manage all</button>
          </div>

          <div className="space-y-4">
            {activeCampaigns.map((campaign) => (
              <div key={campaign.name} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h4 className="font-medium text-slate-900">{campaign.name}</h4>
                    <p className="mt-1 text-sm text-slate-500">{campaign.participants} participants</p>
                  </div>
                  <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700">{campaign.status}</span>
                </div>
                <div className="mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
                  <div>Conversion: <span className="font-medium text-slate-900">{campaign.conversion}</span></div>
                  <div>Revenue: <span className="font-medium text-slate-900">{campaign.revenue}</span></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-xl font-semibold text-slate-900">Recent activity</h3>
            <button type="button" className="text-sm font-medium text-indigo-600">View all</button>
          </div>

          <div className="space-y-4">
            {recentActivity.map((activity) => (
              <div key={`${activity.name}-${activity.time}`} className="flex items-start gap-3 rounded-2xl border border-slate-200 p-3">
                <div className={`mt-0.5 flex h-8 w-8 items-center justify-center rounded-full ${activity.tone === 'emerald' ? 'bg-emerald-100 text-emerald-700' : activity.tone === 'indigo' ? 'bg-indigo-100 text-indigo-700' : activity.tone === 'amber' ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-700'}`}>
                  {activity.name.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-900"><span className="font-medium">{activity.name}</span> {activity.action}</p>
                  <p className="mt-1 text-xs text-slate-500">{activity.time}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
