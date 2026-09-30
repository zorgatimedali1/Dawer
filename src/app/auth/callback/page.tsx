import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useAppContext } from '@/contexts/app-context';
import { AuthService } from '@/services/auth.service';

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const { login } = useAppContext();
  const [error, setError] = useState<string | null>(null);
  // Captured once: `login` only forwards to the stable `setUser` dispatcher, so
  // the first instance stays valid for the whole exchange.
  const loginRef = useRef(login);

  useEffect(() => {
    let cancelled = false;

    AuthService.sessionFromCookie()
      .then((response) => {
        if (cancelled) return;
        loginRef.current(response);
        navigate('/dashboard/overview', { replace: true });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : 'Unable to complete sign in.');
      });

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (error) {
    return (
      <div className="space-y-4 text-center">
        <AlertTriangle className="mx-auto h-10 w-10 text-rose-500" />
        <h1 className="text-2xl font-semibold text-slate-900">Sign in failed</h1>
        <p className="text-sm text-slate-600">{error}</p>
        <Link
          to="/auth/login"
          className="inline-block rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-medium text-white hover:bg-indigo-500"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 py-10 text-slate-600">
      <Loader2 className="h-6 w-6 animate-spin" />
      <p className="text-sm">Completing sign in…</p>
    </div>
  );
}
