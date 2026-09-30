import { Link } from 'react-router-dom';

const features = [
  {
    title: 'Campaign orchestration',
    description: 'Launch, schedule, and monitor loyalty and engagement campaigns across channels from one workspace.',
  },
  {
    title: 'Customer intelligence',
    description: 'Track every scan, reward, and conversion with a unified customer engagement view.',
  },
  {
    title: 'Reward automation',
    description: 'Deliver coupons, prizes, and incentives using rules managed by your backend for compliance and trust.',
  },
];

const steps = [
  'Create a merchant workspace',
  'Design a branded campaign flow',
  'Launch QR code and reward journey',
  'Measure engagement and ROI',
];

export default function Home() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.27),_transparent_35%),linear-gradient(180deg,#020817_0%,#0f172a_28%,#f8fafc_28%,#f8fafc_100%)] text-slate-50">
      <section className="mx-auto max-w-7xl px-6 pb-20 pt-6 lg:px-8">
        <header className="mb-14 flex items-center justify-between rounded-full border border-white/10 bg-white/5 px-4 py-3 shadow-lg shadow-indigo-950/20 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-cyan-400 text-sm font-bold text-white shadow-lg shadow-indigo-500/30">C</div>
            <div>
              <div className="text-sm font-semibold tracking-[0.14em] text-indigo-200 uppercase">CampaignEngage</div>
            </div>
          </div>

          <nav className="hidden items-center gap-6 text-sm text-slate-300 md:flex">
            <a href="#features" className="transition hover:text-white">Features</a>
            <a href="#workflow" className="transition hover:text-white">Workflow</a>
            <a href="#pricing" className="transition hover:text-white">Pricing</a>
          </nav>

          <div className="flex items-center gap-3">
            <Link to="/auth/login" className="rounded-full border border-white/15 px-4 py-2 text-sm text-slate-100 transition hover:border-white/30 hover:bg-white/5">
              Sign in
            </Link>
            <Link to="/dashboard/overview" className="rounded-full bg-gradient-to-r from-indigo-500 to-cyan-500 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-indigo-500/30 transition hover:brightness-110">
              Open dashboard
            </Link>
          </div>
        </header>

        <div className="grid items-center gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:pb-8">
          <div>
            <div className="mb-6 inline-flex items-center rounded-full border border-indigo-400/30 bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-200">
              Multi-tenant customer engagement platform
            </div>
            <h1 className="max-w-xl text-5xl font-semibold tracking-tight text-white sm:text-6xl">
              Turn every customer touchpoint into a measurable growth engine.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-slate-300">
              Launch branded campaigns, game experiences, loyalty offers, and QR-code journeys that convert visits into repeat customers.
            </p>
            <div className="mt-8 flex flex-col gap-4 sm:flex-row">
              <Link to="/auth/register" className="rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 px-6 py-3 text-center font-medium text-white shadow-lg shadow-indigo-500/30 transition hover:brightness-110">
                Start free trial
              </Link>
              <Link to="/dashboard/overview" className="rounded-full border border-white/15 bg-white/5 px-6 py-3 text-center font-medium text-slate-100 transition hover:bg-white/10">
                View product demo
              </Link>
            </div>

            <div className="mt-10 flex flex-wrap gap-6 text-sm text-slate-300">
              <div><span className="font-semibold text-white">4.9/5</span> merchant rating</div>
              <div><span className="font-semibold text-white">32%</span> average uplift</div>
              <div><span className="font-semibold text-white">24/7</span> campaign visibility</div>
            </div>
          </div>

          <div className="relative">
            <div className="absolute -left-8 top-6 h-28 w-28 rounded-full bg-cyan-400/20 blur-3xl" />
            <div className="absolute -right-10 bottom-8 h-32 w-32 rounded-full bg-indigo-500/20 blur-3xl" />

            <div className="relative rounded-[28px] border border-white/10 bg-white/5 p-4 shadow-[0_30px_80px_rgba(79,70,229,0.35)] backdrop-blur-lg">
              <div className="rounded-[24px] border border-slate-800 bg-slate-900 p-5">
                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Live overview</p>
                    <h2 className="mt-1 text-xl font-semibold text-white">Summer Splash</h2>
                  </div>
                  <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-xs font-medium text-emerald-300">Active</span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                    <p className="text-xs text-slate-400">Customers</p>
                    <p className="mt-2 text-3xl font-semibold text-white">1,247</p>
                    <p className="mt-2 text-sm text-emerald-300">+11.4% this month</p>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                    <p className="text-xs text-slate-400">Rewards issued</p>
                    <p className="mt-2 text-3xl font-semibold text-white">284</p>
                    <p className="mt-2 text-sm text-indigo-300">96% redemption rate</p>
                  </div>
                </div>

                <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950 p-4">
                  <div className="mb-4 flex items-center justify-between text-sm text-slate-300">
                    <span>Campaign conversion</span>
                    <span className="font-semibold text-white">68.5%</span>
                  </div>
                  <div className="flex h-2 overflow-hidden rounded-full bg-slate-800">
                    <span className="block w-[68%] rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400" />
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-xs text-slate-400">
                    <div>QR scans 3.2k</div>
                    <div>Starts 1.1k</div>
                    <div>Redeems 420</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="border-t border-slate-200/10 bg-slate-900/70">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
          <div className="mb-12 max-w-2xl">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-indigo-300">Why teams choose us</p>
            <h2 className="mt-3 text-3xl font-semibold text-white sm:text-4xl">A complete growth stack for modern customer engagement.</h2>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {features.map((feature) => (
              <div key={feature.title} className="rounded-[28px] border border-slate-700 bg-slate-950 p-7 shadow-[0_20px_50px_rgba(15,23,42,0.45)] transition hover:-translate-y-1 hover:border-indigo-500/40 hover:shadow-indigo-900/20">
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/20 to-cyan-500/20 text-lg text-indigo-200">✦</div>
                <h3 className="text-xl font-semibold text-white">{feature.title}</h3>
                <p className="mt-3 text-slate-300">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="workflow" className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
        <div className="mb-12 max-w-2xl">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-indigo-600">How it works</p>
          <h2 className="mt-3 text-3xl font-semibold text-slate-900 sm:text-4xl">From campaign idea to repeat customer in a few steps.</h2>
        </div>

        <div className="grid gap-5 md:grid-cols-4">
          {steps.map((step, index) => (
            <div key={step} className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.04)] transition hover:-translate-y-1">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-r from-indigo-100 to-cyan-100 text-sm font-semibold text-indigo-700">0{index + 1}</div>
              <p className="text-base font-medium text-slate-900">{step}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="pricing" className="bg-slate-100">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
          <div className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-[0_18px_45px_rgba(15,23,42,0.06)] lg:p-10">
            <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
              <div>
                <p className="text-sm font-medium uppercase tracking-[0.2em] text-indigo-500">Simple pricing</p>
                <h2 className="mt-3 text-3xl font-semibold text-slate-900">Scale without complexity.</h2>
              </div>
              <div className="flex items-end gap-3">
                <span className="text-4xl font-semibold text-slate-900">$49</span>
                <span className="pb-2 text-slate-500">/ month</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
