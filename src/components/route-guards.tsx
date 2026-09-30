import { Navigate, useLocation } from 'react-router-dom';
import { useAppContext } from '@/contexts/app-context';

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAppContext();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/auth/login" replace state={{ from: location.pathname + location.search }} />;
  }

  return <>{children}</>;
}

export function RedirectIfAuthenticated({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAppContext();
  const location = useLocation();
  const state = location.state as { from?: string } | null;

  if (isAuthenticated) {
    return <Navigate to={state?.from ?? '/dashboard/overview'} replace />;
  }

  return <>{children}</>;
}
