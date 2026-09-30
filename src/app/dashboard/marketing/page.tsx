const campaigns = [
  {
    name: 'Summer Splash',
    channel: 'Email + QR',
    status: 'Running',
    reach: '12.8k',
    roi: '4.7x',
  },
  {
    name: 'Referral Rush',
    channel: 'Social',
    status: 'Draft',
    reach: '7.4k',
    roi: '3.1x',
  },
  {
    name: 'VIP Rewards',
    channel: 'In-store',
    status: 'Scheduled',
    reach: '9.1k',
    roi: '5.4x',
  },
];

const contentIdeas = [
  'Customer testimonial loop',
  'Flash sale reminder sequence',
  'Gamified loyalty push',
  'Referral trigger campaign',
];

export default function MarketingPage() {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Marketing workspace</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">Campaign planning</h2>
          </div>
          <button type="button" className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500">Create campaign</button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {campaigns.map((campaign) => (
          <div key={campaign.name} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">{campaign.name}</h3>
              <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700">{campaign.status}</span>
            </div>
            <p className="mt-3 text-sm text-slate-500">{campaign.channel}</p>
            <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-slate-100 p-3">
                <div className="text-slate-500">Reach</div>
                <div className="mt-1 font-semibold text-slate-900">{campaign.reach}</div>
              </div>
              <div className="rounded-xl bg-slate-100 p-3">
                <div className="text-slate-500">ROI</div>
                <div className="mt-1 font-semibold text-slate-900">{campaign.roi}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-xl font-semibold text-slate-900">Content ideas</h3>
          <div className="mt-4 space-y-3">
            {contentIdeas.map((idea) => (
              <div key={idea} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <span>{idea}</span>
                <button type="button" className="text-indigo-600">View</button>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-xl font-semibold text-slate-900">Quick stats</h3>
          <div className="mt-5 space-y-4">
            <div className="rounded-2xl bg-indigo-50 p-4">
              <p className="text-sm text-indigo-700">Avg. CTR</p>
              <p className="mt-2 text-3xl font-semibold text-slate-900">8.4%</p>
            </div>
            <div className="rounded-2xl bg-emerald-50 p-4">
              <p className="text-sm text-emerald-700">Conversion lift</p>
              <p className="mt-2 text-3xl font-semibold text-slate-900">+27%</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
