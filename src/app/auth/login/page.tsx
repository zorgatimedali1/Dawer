"use client";

import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { GoogleLogo } from '@/components/brand/google-logo';
import { LockKeyhole, Mail } from 'lucide-react';
import { AuthService } from '@/services/auth.service';
import { useAppContext } from '@/contexts/app-context';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { TurnstileWidget } from '@/components/turnstile';
import { useT } from '@/hooks/use-t';

/** Site key is public; enforcement on the Worker is decided by the secret. */
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITEKEY;

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAppContext();
  const t = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileReset, setTurnstileReset] = useState(0);
  // The OAuth callback redirects here with `?error=...` on any handoff
  // failure (Google denial, state mismatch, account guard) — a browser
  // navigation, so the message must ride the URL, not a JSON body.
  const [error, setError] = useState<string | null>(
    () => new URLSearchParams(location.search).get('error'),
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      setError(t.auth.captchaRequired);
      setTurnstileReset((n) => n + 1);
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const response = await AuthService.login({ email, password, turnstileToken: turnstileToken ?? undefined });
      login(response);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from ?? '/dashboard/overview', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t.auth.invalidCredentials);
      // Tokens are single-use — clear the spent one so the widget issues a
      // fresh challenge before the next attempt.
      setTurnstileReset((n) => n + 1);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="space-y-1.5 text-center">
        <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">{t.auth.signInTitle}</h2>
        <p className="text-[13.5px] leading-relaxed text-ink-muted">{t.auth.signInSubtitle}</p>
      </div>

      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => window.location.assign(AuthService.googleSignInUrl())}
      >
        <GoogleLogo className="h-4 w-4" />
        {t.auth.googleSignIn}
      </Button>

      <div className="flex items-center gap-3">
        <span aria-hidden className="h-px flex-1 bg-line" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">{t.auth.or}</span>
        <span aria-hidden className="h-px flex-1 bg-line" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label={t.auth.email} htmlFor="email">
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            inputSize="lg"
            iconStart={<Mail />}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>

        <Field label={t.auth.password} htmlFor="password">
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            inputSize="lg"
            iconStart={<LockKeyhole />}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        {TURNSTILE_SITE_KEY && (
          <TurnstileWidget siteKey={TURNSTILE_SITE_KEY} action="login" onToken={setTurnstileToken} resetSignal={turnstileReset} />
        )}

        {error && (
          <p className="rounded-lg border border-danger-300/60 bg-danger-50 px-3 py-2.5 text-[13px] leading-relaxed text-danger-800 dark:border-danger-900/60 dark:bg-danger-900/30 dark:text-danger-200">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <label className="inline-flex items-center gap-2 text-[13px] text-ink-muted">
            <input
              type="checkbox"
              className="h-4 w-4 shrink-0 rounded border-line-strong accent-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-elevated"
            />
            {t.auth.rememberMe}
          </label>
          <a
            href="/auth/forgot-password"
            className="text-[13px] font-medium text-brand-700 transition-colors duration-180 ease-swift hover:text-brand-800 dark:text-accent-bright dark:hover:text-brand-300"
          >
            {t.auth.forgotPassword}
          </a>
        </div>

        <Button type="submit" size="lg" className="w-full" loading={loading}>
          {loading ? t.auth.signingIn : t.auth.signIn}
        </Button>
      </form>

      <p className="text-center text-[13px] text-ink-muted">
        {t.auth.noAccount}{' '}
        <a
          href="/auth/register"
          className="font-medium text-brand-700 transition-colors duration-180 ease-swift hover:text-brand-800 dark:text-accent-bright dark:hover:text-brand-300"
        >
          {t.auth.createAccount}
        </a>
      </p>
    </div>
  );
}
