import { Outlet } from 'react-router-dom';

export default function AuthLayout() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.16),transparent_30%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] px-4 py-10 dark:bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.2),transparent_25%),linear-gradient(180deg,#020817_0%,#0f172a_100%)]">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-xl font-bold text-white shadow-lg shadow-indigo-500/30">C</div>
          <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">CampaignFlow</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Créez des campagnes et récompensez vos clients facilement.</p>
        </div>
        <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_20px_60px_rgba(15,23,42,0.08)] dark:border-slate-800 dark:bg-slate-900">
          <Outlet />
        </div>
      </div>
    </main>
  );
}
