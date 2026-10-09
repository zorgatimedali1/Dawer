import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { DawerLogo } from '@/components/brand/dawer-logo';
import { useOperatorContext } from '@/platform/auth/operator-context';

export default function LoginPage() {
  const { login } = useOperatorContext();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { from?: string } | null;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      await login(email.trim(), password);
      navigate(state?.from ?? '/', { replace: true });
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Unable to log in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-2 px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <DawerLogo className="mx-auto mb-3 h-12 w-auto" />
          <h1 className="text-xl font-semibold text-ink">Dawer Platform</h1>
          <p className="mt-1 text-sm text-ink-muted">Sign in with an operator account.</p>
        </div>

        <form
          onSubmit={(event) => void submit(event)}
          className="rounded-xl border border-line bg-card p-6 shadow-soft"
        >
          {error && (
            <div
              role="alert"
              className="mb-4 rounded-lg border-l-4 border-danger-400 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-900/60 dark:bg-danger-900/30 dark:text-danger-200"
            >
              {error}
            </div>
          )}

          <Field label="Email" htmlFor="operator-email">
            <Input
              id="operator-email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>

          <Field label="Password" htmlFor="operator-password" className="mt-4">
            <Input
              id="operator-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>

          <Button type="submit" className="mt-6 w-full" disabled={busy}>
            {busy ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>
      </div>
    </div>
  );
}
