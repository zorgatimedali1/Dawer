import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BillingService, type BillingAccess, type MarketingFeatures } from '@/services/billing.service';
import { AUTH_STORAGE_KEY } from '@/services/http';

export interface DashboardBillingValue {
  /** Resolved plan access; null until the shell has loaded it (or it failed). */
  access: BillingAccess | null;
  /** Operator marketing switches; null until the shell has loaded them. */
  features: MarketingFeatures | null;
  loading: boolean;
  /** Re-read /api/billing after a plan change so the shell stays in sync. */
  refresh: () => Promise<void>;
}

const BillingContext = createContext<DashboardBillingValue | null>(null);

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type CachedBilling = { access: BillingAccess; features: MarketingFeatures; cachedAt: number };

/** Per-account cache key so two merchants sharing a browser never swap plans. */
function billingCacheKey(userId: string): string {
  return `campaign-engage-billing-${userId}`;
}

function readSignedInUserId(): string | null {
  try {
    const stored = JSON.parse(window.localStorage.getItem(AUTH_STORAGE_KEY) ?? 'null') as
      { user?: { id?: unknown } } | null;
    return typeof stored?.user?.id === 'string' ? stored.user.id : null;
  } catch {
    return null;
  }
}

function readCachedBilling(userId: string | null): CachedBilling | null {
  if (!userId) return null;
  try {
    const raw = window.localStorage.getItem(billingCacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedBilling> | null;
    if (!parsed?.access?.plan?.slug || typeof parsed?.cachedAt !== 'number') return null;
    if (!parsed.features) return null;
    if (Date.now() - parsed.cachedAt > CACHE_TTL_MS) return null;
    return { access: parsed.access, features: parsed.features, cachedAt: parsed.cachedAt };
  } catch {
    return null;
  }
}

function writeCachedBilling(value: { access: BillingAccess; features: MarketingFeatures }): void {
  const userId = readSignedInUserId();
  if (!userId) return;
  try {
    window.localStorage.setItem(
      billingCacheKey(userId),
      JSON.stringify({ access: value.access, features: value.features, cachedAt: Date.now() }),
    );
  } catch {
    // Storage quota or privacy mode: the cache is best-effort only.
  }
}

function clearCachedBilling(): void {
  const userId = readSignedInUserId();
  if (userId) window.localStorage.removeItem(billingCacheKey(userId));
}

/**
 * Single source of `/api/billing` for the whole dashboard shell.
 *
 * The layout needs it for plan-gated navigation and the overview page needs
 * the same access payload for its plan card — without a shared provider both
 * mount effects fire the same request, doubling the round-trip and every D1
 * query behind it.
 *
 * The plan rarely changes, so a valid result is cached per account for 24h
 * (stale-while-revalidate): the shell hydrates from the cache and paints
 * instantly, while the network revalidation runs in the background and
 * quietly corrects whatever changed. Server-side permission checks stay the
 * source of truth — a stale cache can only show a wrong nav link for a
 * second, never grant anything the API would refuse.
 */
export function DashboardBillingProvider({ children }: { children: ReactNode }) {
  // Read once per mount: a stable boot snapshot so the effect below knows
  // whether a failed revalidation must clear the shell (no cache) or keep
  // the last known good plan on screen.
  const [bootCache] = useState(() => readCachedBilling(readSignedInUserId()));
  const [access, setAccess] = useState<BillingAccess | null>(bootCache?.access ?? null);
  const [features, setFeatures] = useState<MarketingFeatures | null>(bootCache?.features ?? null);
  const [loading, setLoading] = useState(bootCache === null);

  const refresh = useCallback(async () => {
    const billing = await BillingService.get();
    setAccess(billing.access);
    setFeatures(billing.features);
    writeCachedBilling({ access: billing.access, features: billing.features });
  }, []);

  useEffect(() => {
    let cancelled = false;
    refresh()
      .catch(() => {
        // Offline or transient failure: without a cache the layout falls back
        // to its read-only / billing redirect instead of a broken menu; with
        // one, the merchant keeps working on the last known plan.
        if (!cancelled && !bootCache) {
          setAccess(null);
          setFeatures(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bootCache, refresh]);

  // Mid-session 401: the session is gone, so the cached plan is no longer
  // trustworthy either — drop both and let the guards redirect to sign-in.
  useEffect(() => {
    const onSessionExpired = () => {
      clearCachedBilling();
      setAccess(null);
      setFeatures(null);
      setLoading(true);
    };
    window.addEventListener('session-expired', onSessionExpired);
    return () => window.removeEventListener('session-expired', onSessionExpired);
  }, []);

  const value = useMemo<DashboardBillingValue>(
    () => ({ access, features, loading, refresh }),
    [access, features, loading, refresh],
  );

  return <BillingContext.Provider value={value}>{children}</BillingContext.Provider>;
}

/** Read the shell's billing state; throws outside `DashboardBillingProvider`. */
export function useDashboardBilling(): DashboardBillingValue {
  const value = useContext(BillingContext);
  if (!value) throw new Error('useDashboardBilling must be used inside DashboardBillingProvider.');
  return value;
}
