import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BillingService, type BillingAccess, type MarketingFeatures } from '@/services/billing.service';

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

/**
 * Single source of `/api/billing` for the whole dashboard shell.
 *
 * The layout needs it for plan-gated navigation and the overview page needs
 * the same access payload for its plan card — without a shared provider both
 * mount effects fire the same request, doubling the round-trip and every D1
 * query behind it.
 */
export function DashboardBillingProvider({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<BillingAccess | null>(null);
  const [features, setFeatures] = useState<MarketingFeatures | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const billing = await BillingService.get();
    setAccess(billing.access);
    setFeatures(billing.features);
  }, []);

  useEffect(() => {
    let cancelled = false;
    refresh()
      .catch(() => {
        // Offline or transient failure: the layout falls back to its
        // read-only / billing redirect instead of a broken menu.
        if (!cancelled) {
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
  }, [refresh]);

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
