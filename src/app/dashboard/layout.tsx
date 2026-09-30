import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Award,
  BarChart3,
  Bell,
  CreditCard,
  Gamepad2,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  QrCode,
  Settings,
  ShoppingCart,
  Sparkles,
  Ticket,
  UserRound,
  Wand2,
} from 'lucide-react';
import { useState } from 'react';
import { LanguageSwitcher } from '@/components/language-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { useAppContext } from '@/contexts/app-context';

type NavItem = { name: string; href: string; icon: typeof LayoutDashboard };
type NavGroup = { label: string; items: NavItem[] };

const navigation: NavGroup[] = [
  {
    label: 'Workspace',
    items: [
      { name: 'Overview', href: '/dashboard/overview', icon: LayoutDashboard },
      { name: 'Analytics', href: '/dashboard/analytics', icon: BarChart3 },
    ],
  },
  {
    label: 'Campaigns',
    items: [
      { name: 'My campaigns', href: '/dashboard/campaigns', icon: Megaphone },
      { name: 'Configure my wheel', href: '/dashboard/wheel', icon: Wand2 },
      { name: 'Games', href: '/dashboard/games', icon: Gamepad2 },
      { name: 'Rewards', href: '/dashboard/rewards', icon: Award },
      { name: 'Coupons', href: '/dashboard/coupons', icon: Ticket },
      { name: 'QR codes', href: '/dashboard/qr-codes', icon: QrCode },
      { name: 'Poster editor', href: '/dashboard/poster', icon: Sparkles },
      { name: 'Marketing', href: '/dashboard/marketing', icon: Megaphone },
    ],
  },
  {
    label: 'Audience',
    items: [{ name: 'My customers', href: '/dashboard/customers', icon: UserRound }],
  },
  {
    label: 'Account',
    items: [
      { name: 'Settings', href: '/dashboard/settings', icon: Settings },
      { name: 'Billing', href: '/dashboard/billing', icon: CreditCard },
      { name: 'Pricing', href: '/dashboard/pricing', icon: ShoppingCart },
    ],
  },
];

const flatNavigation: NavItem[] = navigation.flatMap((group) => group.items);

function initialsOf(firstName?: string, lastName?: string, email?: string): string {
  const fromName = [firstName, lastName]
    .filter((part): part is string => Boolean(part && part.trim()))
    .map((part) => part.trim().charAt(0).toUpperCase());

  if (fromName.length) return fromName.slice(0, 2).join('');
  if (email) return email.trim().charAt(0).toUpperCase();
  return '?';
}

export default function DashboardLayout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAppContext();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const displayName = user
    ? [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.email
    : 'Merchant';
  const avatar = initialsOf(user?.firstName, user?.lastName, user?.email);
  const accountLabel = user?.role === 'admin' ? 'Admin account' : 'Merchant account';
  const activeTitle = flatNavigation.find((item) => item.href === pathname)?.name ?? 'Dashboard';

  const handleLogout = () => {
    logout();
    navigate('/auth/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="flex h-screen overflow-hidden">
        <aside
          className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} fixed inset-y-0 left-0 z-30 w-72 border-r border-slate-200 bg-white transition-transform duration-200 lg:static lg:translate-x-0 dark:border-slate-800 dark:bg-slate-900`}
        >
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-5 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-sm font-bold text-white">C</div>
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">CampaignFlow</div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Merchant portal</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 lg:hidden"
                aria-label="Close sidebar"
              >
                <Menu className="h-4 w-4" />
              </button>
            </div>

            <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
              {navigation.map((group) => (
                <div key={group.label}>
                  <p className="px-3 pb-2 text-[10px] uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                    {group.label}
                  </p>
                  <div className="space-y-1">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const active = pathname === item.href;
                      return (
                        <Link
                          key={item.href}
                          to={item.href}
                          onClick={() => setSidebarOpen(false)}
                          className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                            active
                              ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100 dark:bg-indigo-950/40 dark:text-indigo-200 dark:ring-indigo-900'
                              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                          }`}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          {item.name}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>

            <div className="border-t border-slate-200 p-4 dark:border-slate-800">
              <div className="flex items-center gap-3 rounded-2xl bg-slate-100 p-3 dark:bg-slate-800">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-semibold text-white">
                  {avatar}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{displayName}</p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">{accountLabel}</p>
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="rounded-lg p-2 text-slate-500 transition hover:bg-white hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white"
                  aria-label="Log out"
                  title="Log out"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-900 sm:px-6">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="rounded-lg border border-slate-200 p-2 text-slate-600 dark:border-slate-700 dark:text-slate-300 lg:hidden"
                aria-label="Open sidebar"
              >
                <Menu className="h-4 w-4" />
              </button>
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Workspace</p>
                <h1 className="text-xl font-semibold text-slate-900 dark:text-white">{activeTitle}</h1>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <ThemeToggle />
              <LanguageSwitcher />
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                aria-label="Notifications"
              >
                <Bell className="h-4 w-4" />
              </button>
              <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-800">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">
                  {avatar}
                </div>
                <div className="hidden text-left sm:block">
                  <p className="text-sm font-medium text-slate-900 dark:text-white">{displayName}</p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">{accountLabel}</p>
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-200 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white"
                  aria-label="Log out"
                  title="Log out"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            </div>
          </header>

          <main className="flex-1 overflow-y-auto p-4 sm:p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
