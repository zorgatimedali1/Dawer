import { Navigate, useLocation } from 'react-router-dom';
import BrandLoader from '@/components/brand/brand-loader';
import { useAppContext } from '@/contexts/app-context';

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, sessionStatus } = useAppContext();
  const location = useLocation();

  // While the bootstrap revalidation is still deciding whether the cached
  // session is real, hold the loader instead of flashing a dashboard that
  // immediately 401s (or a redirect that the late 200 would undo).
  if (sessionStatus === 'checking') {
    return <BrandLoader />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/auth/login" replace state={{ from: location.pathname + location.search }} />;
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
