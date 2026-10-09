import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import {
  Award,
  BarChart3,
  ChevronRight,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Mail,
  Megaphone,
  Menu,
  PlayCircle,
  QrCode,
  Send,
  Settings,
  Sparkles,
  UserRound,
  Wand2,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { LanguageSwitcher } from '@/components/language-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { DawerLogo } from '@/components/brand/dawer-logo';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { useAppContext } from '@/contexts/app-context';
import { useT } from '@/hooks/use-t';
import { BillingService, type BillingAccess, type MarketingFeatures } from '@/services/billing.service';
import { goToPublicDemo } from '@/lib/public-demo';

type NavItem = { name: string; href: string; icon: typeof LayoutDashboard };
type NavGroup = { label: string; items: NavItem[] };

export default function DashboardLayout() {
  const { pathname } = useLocation();
  const { user, logout } = useAppContext();
  const t = useT();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [access, setAccess] = useState<BillingAccess | null>(null);
  // Platform switches from the operator console; null until billing loads.
  const [features, setFeatures] = useState<MarketingFeatures | null>(null);
  const [accessLoading, setAccessLoading] = useState(true);

  const navigation: NavGroup[] = [
    {
      label: t.nav.workspace,
      items: [
        { name: t.nav.overview, href: '/dashboard/overview', icon: LayoutDashboard },
        { name: t.nav.analytics, href: '/dashboard/analytics', icon: BarChart3 },
      ],
    },
    {
      label: t.nav.campaigns,
      items: [
        { name: t.nav.myCampaigns, href: '/dashboard/campaigns', icon: Megaphone },
        { name: t.nav.configureWheel, href: '/dashboard/wheel', icon: Wand2 },
        { name: t.nav.rewards, href: '/dashboard/rewards', icon: Award },
        { name: t.nav.qrCodes, href: '/dashboard/qr-codes', icon: QrCode },
        { name: t.nav.posterEditor, href: '/dashboard/poster', icon: Sparkles },
      ],
    },
    {
      label: t.nav.audience,
      items: [{ name: t.nav.myCustomers, href: '/dashboard/customers', icon: UserRound }],
    },
    {
      label: t.nav.marketing,
      items: [
        { name: t.nav.emailMarketing, href: '/dashboard/email', icon: Mail },
        { name: t.nav.whatsappMarketing, href: '/dashboard/whatsapp', icon: Send },
      ],
    },
    {
      label: t.nav.account,
      items: [
        { name: t.nav.billing, href: '/dashboard/billing', icon: CreditCard },
        { name: t.nav.settings, href: '/dashboard/settings', icon: Settings },
      ],
    },
  ];

  useEffect(() => {
    let cancelled = false;
    BillingService.get()
      .then((billing) => {
        if (!cancelled) {
          setAccess(billing.access);
          setFeatures(billing.features);
        }
      })
      .catch(() => {
        if (!cancelled) setAccess(null);
      })
      .finally(() => {
        if (!cancelled) setAccessLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!sidebarOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sidebarOpen]);

  const displayName = user
    ? [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.email
    : t.layout.merchant;
  const accountLabel = t.layout.merchantAccount;
  const isBillingPage = pathname === '/dashboard/billing';
  const isDemoPage = pathname === '/dashboard/demo';
  const hasAnalytics = access?.plan.features.features.some((feature) => /analytics/i.test(feature)) ?? false;
  const readOnlyNav: NavGroup[] = [
    {
      label: t.nav.account,
      items: [
        { name: t.nav.demo, href: '/dashboard/demo', icon: PlayCircle },
        ...(navigation.find((group) => group.label === t.nav.account)?.items.filter((item) => item.href === '/dashboard/billing') ?? []),
      ],
    },
  ];
  const visibleGroups = !access?.canManage
    ? readOnlyNav
    : navigation
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => {
            if (item.href === '/dashboard/analytics') return hasAnalytics;
            // Operator platform switches: the menu entry disappears while off
            // and comes back when the operator re-enables the channel.
            if (item.href === '/dashboard/email') return features?.emailEnabled ?? true;
            if (item.href === '/dashboard/whatsapp') return features?.whatsappEnabled ?? true;
            return true;
          }),
        }))
        .filter((group) => group.items.length > 0);

  let activeTitle = t.layout.dashboard;
  let activeGroup = t.nav.workspace;
  for (const group of visibleGroups) {
    const found = group.items.find((item) => item.href === pathname);
    if (found) {
      activeTitle = found.name;
      activeGroup = group.label;
      break;
    }
  }

  const handleLogout = () => {
    // Wait for the server-side session revocation, then hard-navigate to the
    // public landing page's demo video section (/#demo).
    void logout().finally(() => goToPublicDemo());
  };

  if (!isBillingPage && !isDemoPage && accessLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface" role="status">
        <div className="flex flex-col items-center gap-3">
          <span className="relative flex h-8 w-8 items-center justify-center">
            <span className="absolute inset-0 rounded-full border-2 border-line" />
            <span className="absolute inset-0 animate-spin-slow rounded-full border-2 border-transparent border-t-brand-500 motion-reduce:animate-none" />
          </span>
          <p className="text-[13px] font-medium text-ink-subtle">{t.layout.checkingSubscription}</p>
        </div>
      </div>
    );
  }

  if (!isBillingPage && !isDemoPage && !access?.canManage) {
    // First-time (trial) users start on the demo video instead of Billing;
    // expired/inactive/none still land on Billing to pick a plan.
    return <Navigate to={access?.state === 'trial' ? '/dashboard/demo' : '/dashboard/billing'} replace />;
  }

  if (pathname === '/dashboard/analytics' && !hasAnalytics) {
    return <Navigate to="/dashboard/billing" replace />;
  }

  if (pathname === '/dashboard/email' && features && !features.emailEnabled) {
    return <Navigate to="/dashboard/overview" replace />;
  }

  if (pathname === '/dashboard/whatsapp' && features && !features.whatsappEnabled) {
    return <Navigate to="/dashboard/overview" replace />;
  }

  const sidebar = (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-line px-5">
        <Link
          to="/dashboard/overview"
          className="flex min-w-0 items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          <DawerLogo className="h-8 w-auto shrink-0" />
        </Link>
        <button
          type="button"
          onClick={() => setSidebarOpen(false)}
          className="-mr-1.5 inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-subtle transition-colors duration-150 hover:bg-ink/[0.06] hover:text-ink lg:hidden"
          aria-label={t.layout.closeSidebar}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <nav className="dw-scroll flex-1 overflow-y-auto px-3 py-5" aria-label={t.layout.mainNav}>
        <div className="flex flex-col gap-6">
          {visibleGroups.map((group) => (
            <div key={group.label}>
              <p className="px-3 pb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
                {group.label}
              </p>
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = pathname === item.href;
                  return (
                    <li key={item.href}>
                      <Link
                        to={item.href}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'group relative flex items-center gap-3 rounded-lg py-2 pl-3 pr-2.5 text-[13.5px] font-medium',
                          'transition-[background-color,color] duration-180 ease-swift',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
                          active
                            ? 'bg-accent-soft text-brand-800 dark:bg-accent-soft dark:text-accent-bright'
                            : 'text-ink-muted hover:bg-ink/[0.045] hover:text-ink',
                        )}
                      >
                        {/* Active-state indicator: a short brand bar on the leading edge. */}
                        <span
                          aria-hidden
                          className={cn(
                            'absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-500 transition-all duration-240 ease-swift dark:bg-brand-400',
                            active ? 'opacity-100' : 'scale-y-0 opacity-0',
                          )}
                        />
                        <Icon
                          aria-hidden
                          className={cn(
                            'h-4 w-4 shrink-0 transition-colors duration-180',
                            active
                              ? 'text-brand-600 dark:text-accent-bright'
                              : 'text-ink-subtle group-hover:text-ink-muted',
                          )}
                        />
                        <span className="truncate">{item.name}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      <div className="shrink-0 border-t border-line p-3">
        <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/60 p-2.5 transition-colors duration-180 hover:border-line-strong">
          <Avatar name={displayName} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-ink">{displayName}</p>
            <p className="truncate text-[11.5px] text-ink-subtle">{accountLabel}</p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-subtle transition-colors duration-150 hover:bg-elevated hover:text-danger-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 dark:hover:text-danger-300"
            aria-label={t.layout.logout} title={t.layout.logout}
          >
            <LogOut className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="h-screen overflow-hidden bg-surface-2 text-ink">
      <div className="flex h-full">
        {/* Mobile drawer */}
        <div
          className={cn(
            'fixed inset-0 z-40 lg:hidden',
            sidebarOpen ? 'pointer-events-auto visible' : 'pointer-events-none invisible',
          )}
          aria-hidden={!sidebarOpen}
        >
          <div
            onClick={() => setSidebarOpen(false)}
            className={cn(
              'absolute inset-0 bg-[#0D120B]/45 backdrop-blur-[2px] transition-opacity duration-240',
              sidebarOpen ? 'opacity-100' : 'opacity-0',
            )}
          />
          <aside
            className={cn(
              'absolute inset-y-0 left-0 w-[17rem] border-r border-line shadow-pop',
              'transition-transform duration-280 ease-swift motion-reduce:transition-none',
              sidebarOpen ? 'translate-x-0' : '-translate-x-full',
            )}
          >
            {sidebar}
          </aside>
        </div>

        {/* Desktop sidebar */}
        <aside className="hidden w-[17rem] shrink-0 border-r border-line lg:block">{sidebar}</aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="sticky top-0 z-30 shrink-0 border-b border-line bg-surface/85 backdrop-blur-md">
            <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => setSidebarOpen(true)}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line text-ink-muted transition-colors duration-150 hover:bg-surface-2 hover:text-ink lg:hidden"
                  aria-label={t.layout.openSidebar}
                >
                  <Menu className="h-4 w-4" aria-hidden />
                </button>
                <Link to="/" className="lg:hidden" aria-label={t.layout.dawerHome}>
                  <DawerLogo className="h-7 w-auto" alt="" />
                </Link>
                <div className="hidden min-w-0 sm:block">
                  <nav aria-label={t.layout.breadcrumb} className="flex items-center gap-1.5 text-[13px]">
                    <span className="truncate text-ink-subtle">{activeGroup}</span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-subtle/70" aria-hidden />
                    <span className="truncate font-semibold text-ink">{activeTitle}</span>
                  </nav>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                <LanguageSwitcher className="hidden sm:inline-flex" />
                <ThemeToggle />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={handleLogout}
                  aria-label={t.layout.logout} title={t.layout.logout}
                  className="text-ink-subtle hover:text-danger-600 sm:hidden dark:hover:text-danger-300"
                >
                  <LogOut className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            </div>
          </header>

          <main className="flex-1 overflow-x-hidden overflow-y-auto">
            <div key={pathname} className="mx-auto max-w-[84rem] animate-fade-in px-4 py-6 sm:px-6 sm:py-8">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}