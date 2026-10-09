import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useAppContext } from '@/contexts/app-context';
import { msg } from '@/lib/i18n';
import { useT } from '@/hooks/use-t';
import { AuthService } from '@/services/auth.service';
import { Button } from '@/components/ui/button';

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const { login } = useAppContext();
  const t = useT();
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
        <span className="mx-auto inline-flex h-11 w-11 items-center justify-center rounded-xl bg-danger-50 text-danger-600 dark:bg-danger-900/40 dark:text-danger-300">
          <AlertTriangle aria-hidden className="h-5 w-5" />
        </span>
        <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-ink">{t.auth.signInFailed}</h1>
        <p className="text-[13.5px] leading-relaxed text-ink-muted">{msg(t, error)}</p>
        <Button asChild className="w-full">
          <Link to="/auth/login">{t.auth.backToSignIn}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 py-10 text-ink-muted">
      <Loader2 aria-hidden className="h-6 w-6 animate-spin text-brand-600 motion-reduce:animate-none dark:text-accent-bright" />
      <p className="text-[13.5px]">{t.auth.completingSignIn}</p>
    </div>
  );
}