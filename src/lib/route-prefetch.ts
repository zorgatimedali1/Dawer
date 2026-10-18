/**
 * Route chunk prefetch for the dashboard sidebar.
 *
 * Every page is a lazy `import()` chunk; a first click downloads, parses and
 * evaluates it before the page renders. Hovering a link for a moment is a
 * free head start, so nav links prefetch their page chunk on hover/focus,
 * and the six busiest tabs are warmed up once the shell has booted.
 */

const ROUTE_CHUNKS: Record<string, () => Promise<unknown>> = {
  '/': () => import('@/app/page'),
  '/privacy': () => import('@/app/privacy/page'),
  '/auth/login': () => import('@/app/auth/login/page'),
  '/auth/register': () => import('@/app/auth/register/page'),
  '/auth/forgot-password': () => import('@/app/auth/forgot-password/page'),
  '/auth/reset-password': () => import('@/app/auth/reset-password/page'),
  '/dashboard/overview': () => import('@/app/dashboard/overview/page'),
  '/dashboard/analytics': () => import('@/app/dashboard/analytics/page'),
  '/dashboard/billing': () => import('@/app/dashboard/billing/page'),
  '/dashboard/campaigns': () => import('@/app/dashboard/campaigns/page'),
  '/dashboard/coupons': () => import('@/app/dashboard/coupons/page'),
  '/dashboard/customers': () => import('@/app/dashboard/customers/page'),
  '/dashboard/demo': () => import('@/app/dashboard/demo/page'),
  '/dashboard/email': () => import('@/app/dashboard/email/page'),
  '/dashboard/poster': () => import('@/app/dashboard/poster/page'),
  '/dashboard/qr-codes': () => import('@/app/dashboard/qr-codes/page'),
  '/dashboard/rewards': () => import('@/app/dashboard/rewards/page'),
  '/dashboard/settings': () => import('@/app/dashboard/settings/page'),
  '/dashboard/wheel': () => import('@/app/dashboard/wheel/page'),
  '/dashboard/whatsapp': () => import('@/app/dashboard/whatsapp/page'),
};

/** Most-visited tabs, warmed up right after the dashboard shell boots. */
const COMMON_ROUTES = [
  '/dashboard/overview',
  '/dashboard/campaigns',
  '/dashboard/customers',
  '/dashboard/rewards',
  '/dashboard/wheel',
  '/dashboard/qr-codes',
];

const prefetched = new Set<string>();

/** Starts downloading a route's chunk once per session; unknown paths no-op. */
export function prefetchRoute(pathname: string): void {
  const load = ROUTE_CHUNKS[pathname];
  if (!load || prefetched.has(pathname)) return;
  prefetched.add(pathname);
  void load().catch(() => {
    // A failed warm-up is invisible; navigation will fetch it again.
    prefetched.delete(pathname);
  });
}

/** Warms up the common tabs in the background; safe to call on every boot. */
export function prefetchCommonRoutes(): void {
  const remaining = COMMON_ROUTES.filter((path) => !prefetched.has(path));
  if (remaining.length === 0) return;
  const idle = (window as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
    .requestIdleCallback;
  const run = () => remaining.forEach((path) => prefetchRoute(path));
  if (idle) idle(run, { timeout: 4000 });
  else window.setTimeout(run, 1500);
}
