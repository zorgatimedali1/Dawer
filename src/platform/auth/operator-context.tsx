import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { LoadingScreen } from '@/components/ui/skeleton';
import { PlatformAuthService, type Operator } from '@/platform/services/auth.service';

type OperatorStatus = 'loading' | 'authenticated' | 'anonymous';

type OperatorContextValue = {
  operator: Operator | null;
  status: OperatorStatus;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const OperatorContext = createContext<OperatorContextValue | undefined>(undefined);

export function OperatorProvider({ children }: { children: React.ReactNode }) {
  const [operator, setOperator] = useState<Operator | null>(null);
  const [status, setStatus] = useState<OperatorStatus>('loading');

  useEffect(() => {
    let cancelled = false;

    PlatformAuthService.session()
      .then((resolved) => {
        if (cancelled) return;
        setOperator(resolved);
        setStatus('authenticated');
      })
      .catch(() => {
        if (cancelled) return;
        setOperator(null);
        setStatus('anonymous');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const resolved = await PlatformAuthService.login(email, password);
    setOperator(resolved);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    try {
      await PlatformAuthService.logout();
    } finally {
      setOperator(null);
      setStatus('anonymous');
    }
  }, []);

  const value = useMemo<OperatorContextValue>(
    () => ({ operator, status, login, logout }),
    [operator, status, login, logout],
  );

  return <OperatorContext.Provider value={value}>{children}</OperatorContext.Provider>;
}

export function useOperatorContext(): OperatorContextValue {
  const context = useContext(OperatorContext);

  if (!context) {
    throw new Error('useOperatorContext must be used inside OperatorProvider');
  }

  return context;
}

function CheckingSession() {
  return <LoadingScreen label="Checking your session..." />;
}

export function RequireOperator({ children }: { children: React.ReactNode }) {
  const { status } = useOperatorContext();
  const location = useLocation();

  if (status === 'loading') return <CheckingSession />;

  if (status !== 'authenticated') {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }

  return <>{children}</>;
}

export function RedirectIfOperator({ children }: { children: React.ReactNode }) {
  const { status } = useOperatorContext();
  const location = useLocation();
  const state = location.state as { from?: string } | null;

  if (status === 'loading') return <CheckingSession />;

  if (status === 'authenticated') {
    return <Navigate to={state?.from ?? '/'} replace />;
  }

  return <>{children}</>;
}
