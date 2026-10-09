import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  ChevronRight,
  CreditCard,
  Gem,
  Handshake,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  ShieldCheck,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { DawerLogo } from '@/components/brand/dawer-logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { AppProvider } from '@/contexts/app-context';
import { useOperatorContext } from '@/platform/auth/operator-context';
import { cn } from '@/lib/cn';

type NavItem = { to: string; label: string; icon: LucideIcon };
type NavGroup = { label: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/analytics', label: 'Analytics', icon: BarChart3 },
    ],
  },
  {
    label: 'Management',
    items: [
      { to: '/accounts', label: 'Accounts', icon: Users },
      { to: '/subscriptions', label: 'Subscriptions', icon: CreditCard },
      { to: '/plans', label: 'Plans', icon: Gem },
      { to: '/partners', label: 'Partners', icon: Handshake },
    ],
  },
  {
    label: 'Account',
    items: [{ to: '/password', label: 'Password', icon: KeyRound }],
  },
];

const itemClasses = ({ isActive }: { isActive: boolean }) =>
  cn(
    'group relative flex items-center gap-3 rounded-lg py-2 pl-3 pr-2.5 text-[13.5px] font-medium',
    'transition-[background-color,color] duration-180 ease-swift',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
    isActive
      ? 'bg-accent-soft text-brand-800 dark:bg-accent-soft dark:text-accent-bright'
      : 'text-ink-muted hover:bg-ink/[0.045] hover:text-ink',
  );

export default function PlatformLayout() {
  const { operator, logout } = useOperatorContext();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const drawerRef = useRef<HTMLElement | null>(null);
  const hamburgerRef = useRef<HTMLButtonElement | null>(null);
  const drawerWasOpen = useRef(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  // Close the mobile drawer on Escape while it is open.
  useEffect(() => {
    if (!sidebarOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sidebarOpen]);

  // Move keyboard focus into the drawer on open and back to the opener on close.
  useEffect(() => {
    if (sidebarOpen) {
      drawerWasOpen.current = true;
      drawerRef.current?.focus();
    } else if (drawerWasOpen.current) {
      drawerWasOpen.current = false;
      hamburgerRef.current?.focus();
    }
  }, [sidebarOpen]);

  const displayName =
    [operator?.firstName, operator?.lastName].filter(Boolean).join(' ').trim() || operator?.email || 'Operator';

  const activeItem = NAV_GROUPS.flatMap((group) =>
    group.items.map((item) => ({ ...item, group: group.label })),
  ).find((item) => item.to === pathname);

  const sidebar = (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-line px-5">
        <div className="flex min-w-0 items-center gap-3">
          <DawerLogo className="h-8 w-auto shrink-0" />
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-brand-800 dark:bg-brand-900/50 dark:text-accent-bright">
            <ShieldCheck className="h-3 w-3" aria-hidden />
            Platform
          </span>
        </div>
        <button
          type="button"
          onClick={() => setSidebarOpen(false)}
          className="-mr-1.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-subtle transition-colors duration-150 hover:bg-ink/[0.06] hover:text-ink lg:hidden"
          aria-label="Close menu"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <nav className="dw-scroll flex-1 overflow-y-auto px-3 py-5" aria-label="Platform">
        <div className="flex flex-col gap-6">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="px-3 pb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
                {group.label}
              </p>
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        className={itemClasses}
                        onClick={() => setSidebarOpen(false)}
                      >
                        {({ isActive }) => (
                          <>
                            {/* Active-state indicator: a short brand bar on the leading edge. */}
                            <span
                              aria-hidden
                              className={cn(
                                'absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-500 transition-all duration-240 ease-swift dark:bg-brand-400',
                                isActive ? 'opacity-100' : 'scale-y-0 opacity-0',
                              )}
                            />
                            <Icon
                              aria-hidden
                              className={cn(
                                'h-4 w-4 shrink-0 transition-colors duration-180',
                                isActive
                                  ? 'text-brand-600 dark:text-accent-bright'
                                  : 'text-ink-subtle group-hover:text-ink-muted',
                              )}
                            />
                            <span className="truncate">{item.label}</span>
                          </>
                        )}
                      </NavLink>
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
            <p className="truncate text-[11.5px] text-ink-subtle">Platform operator</p>
          </div>
          <button
            type="button"
            onClick={() => void handleLogout()}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-subtle transition-colors duration-150 hover:bg-elevated hover:text-danger-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 dark:hover:text-danger-300"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <AppProvider>
      <div className="h-screen overflow-hidden bg-surface-2 text-ink">
        <div className="flex h-full">
          {/* Mobile drawer */}
          <div
            data-testid="platform-drawer"
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
              ref={drawerRef}
              tabIndex={-1}
              className={cn(
                'absolute inset-y-0 left-0 w-[17rem] border-r border-line shadow-pop focus:outline-none',
                'transition-transform duration-320 ease-swift motion-reduce:transition-none',
                sidebarOpen ? 'translate-x-0' : '-translate-x-full',
              )}
            >
              {sidebar}
            </aside>
          </div>

          {/* Desktop sidebar */}
          <aside className="hidden w-[17rem] shrink-0 border-r border-line lg:block">{sidebar}</aside>

          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <header className="shrink-0 border-b border-line bg-surface/85 backdrop-blur-md">
              <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6">
                <div className="flex min-w-0 items-center gap-3">
                  <button
                    ref={hamburgerRef}
                    type="button"
                    onClick={() => setSidebarOpen(true)}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line text-ink-muted transition-colors duration-150 hover:bg-surface-2 hover:text-ink lg:hidden"
                    aria-label="Open menu"
                  >
                    <Menu className="h-4 w-4" aria-hidden />
                  </button>
                  <DawerLogo className="h-7 w-auto lg:hidden" alt="" />
                  <nav aria-label="Breadcrumb" className="hidden items-center gap-1.5 text-[13px] sm:flex">
                    <span className="truncate text-ink-subtle">{activeItem?.group ?? 'Platform'}</span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-subtle/70" aria-hidden />
                    <span className="truncate font-semibold text-ink">{activeItem?.label ?? 'Dashboard'}</span>
                  </nav>
                </div>
                <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                  <ThemeToggle />
                </div>
              </div>
            </header>

            <main className="flex-1 overflow-x-hidden overflow-y-auto">
              <div className="mx-auto w-full max-w-7xl animate-fade-in px-4 py-6 sm:px-6 sm:py-8">
                <Outlet />
              </div>
            </main>
          </div>
        </div>
      </div>
    </AppProvider>
  );
}
