import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import BrandLoader from '@/components/brand/brand-loader';
import { useAppContext } from '@/contexts/app-context';
import { BillingService } from '@/services/billing.service';

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, sessionStatus } = useAppContext();

  // While the bootstrap revalidation is still deciding whether the cached
  // session is real, hold the loader instead of flashing a dashboard that
  // immediately 401s (or a redirect that the late 200 would undo).
  if (sessionStatus === 'checking') {
    return <BrandLoader />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

export function RedirectIfAuthenticated({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, sessionStatus } = useAppContext();
  const location = useLocation();
  const state = location.state as { from?: string } | null;

  if (sessionStatus === 'checking') {
    return <BrandLoader />;
  }

  if (isAuthenticated) {
    return <Navigate to={state?.from ?? '/dashboard/overview'} replace />;
  }

  return <>{children}</>;
}

/**
 * Paid-plan merchants skip the marketing home: opening the website lands them
 * straight in the dashboard. Anonymous visitors and trial / no-plan accounts
 * still get the landing page.
 */
export function LandingGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, sessionStatus } = useAppContext();
  const [canManage, setCanManage] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return undefined;
    let cancelled = false;
    BillingService.get()
      .then((billing) => {
        if (!cancelled) setCanManage(billing.access.canManage);
      })
      .catch(() => {
        if (!cancelled) setCanManage(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  if (sessionStatus === 'checking') {
    return <BrandLoader />;
  }

  if (!isAuthenticated) {
    return <>{children}</>;
  }

  if (canManage === null) {
    return <BrandLoader />;
  }

  if (canManage) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
