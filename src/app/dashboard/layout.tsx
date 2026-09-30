"use client";

import { Link, Outlet, useLocation } from 'react-router-dom';
import { Bell, ChevronDown, LayoutDashboard, Menu, ShoppingCart, Sparkles, UserRound, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { LanguageSwitcher } from '@/components/language-switcher';
import { ThemeToggle } from '@/components/theme-toggle';

const navigation = [
  { name: 'Overview', href: '/dashboard/overview', icon: LayoutDashboard },
  { name: 'My customers', href: '/dashboard/customers', icon: UserRound },
  { name: 'Configure my wheel', href: '/dashboard/wheel', icon: Wand2 },
  { name: 'Poster editor', href: '/dashboard/poster', icon: Sparkles },
  { name: 'Pricing', href: '/dashboard/pricing', icon: ShoppingCart },
];

export default function DashboardLayout() {
  const { pathname } = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="flex h-screen overflow-hidden">
        <aside className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} fixed inset-y-0 left-0 z-30 w-72 border-r border-slate-200 bg-white transition-transform duration-200 lg:static lg:translate-x-0 dark:border-slate-800 dark:bg-slate-900`}>
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-5 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-sm font-bold text-white">C</div>
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">CampaignFlow</div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Merchant portal</div>
                </div>
              </div>
              <button type="button" onClick={() => setSidebarOpen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 lg:hidden" aria-label="Close sidebar">
                <Menu className="h-4 w-4" />
              </button>
            </div>

            <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
              {navigation.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.name}
                    to={item.href}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                      active
                        ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100 dark:bg-indigo-950/40 dark:text-indigo-200 dark:ring-indigo-900'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {item.name}
                  </Link>
                );
              })}
            </nav>

            <div className="border-t border-slate-200 p-4 dark:border-slate-800">
              <div className="flex items-center gap-3 rounded-2xl bg-slate-100 p-3 dark:bg-slate-800">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600 text-sm font-semibold text-white">MN</div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-white">Meridian North</p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">Admin workspace</p>
                </div>
              </div>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-900 sm:px-6">
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setSidebarOpen(true)} className="rounded-lg border border-slate-200 p-2 text-slate-600 dark:border-slate-700 dark:text-slate-300 lg:hidden" aria-label="Open sidebar">
                <Menu className="h-4 w-4" />
              </button>
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Workspace</p>
                <h1 className="text-xl font-semibold text-slate-900 dark:text-white">{navigation.find((item) => item.href === pathname)?.name ?? 'Dashboard'}</h1>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <ThemeToggle />
              <LanguageSwitcher />
              <button type="button" className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                <Bell className="h-4 w-4" />
              </button>
              <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-800">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">MN</div>
                <div className="hidden text-left sm:block">
                  <p className="text-sm font-medium text-slate-900 dark:text-white">Meridian North</p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">Pro account</p>
                </div>
                <ChevronDown className="h-4 w-4 text-slate-500 dark:text-slate-300" />
              </div>
            </div>
          </header>

          <main className="flex-1 overflow-y-auto p-4 sm:p-6"><Outlet /></main>
        </div>
      </div>
    </div>
  );
}
