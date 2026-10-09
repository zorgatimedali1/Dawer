'use client';

import { useState } from 'react';
import { Mail } from 'lucide-react';
import { AuthService } from '@/services/auth.service';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { interpolate } from '@/lib/i18n';
import { useT } from '@/hooks/use-t';

export default function ForgotPasswordPage() {
  const t = useT();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await AuthService.forgotPassword(email);
      setSent(true);
    } catch {
      setError(t.auth.forgotFailed);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="space-y-1.5 text-center">
        <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">
          {t.auth.forgotTitle}
        </h2>
        <p className="text-[13.5px] leading-relaxed text-ink-muted">
          {t.auth.forgotSubtitle}
        </p>
      </div>

      {sent ? (
        <p className="rounded-lg border border-success-300/60 bg-success-50 px-3 py-2.5 text-[13px] leading-relaxed text-success-800 dark:border-success-900/60 dark:bg-success-900/30 dark:text-success-200">
          {interpolate(t.auth.forgotSent, { email })}
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label={t.auth.email} htmlFor="email">
            <Input
              id="email"
              type="email"
              required
              inputSize="lg"
              iconStart={<Mail />}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>

          {error && (
            <p className="rounded-lg border border-danger-300/60 bg-danger-50 px-3 py-2.5 text-[13px] leading-relaxed text-danger-800 dark:border-danger-900/60 dark:bg-danger-900/30 dark:text-danger-200">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" className="w-full" loading={loading}>
            {loading ? t.auth.sendingLink : t.auth.sendLink}
          </Button>
        </form>
      )}

      <a
        href="/auth/login"
        className="block text-center text-[13px] font-medium text-brand-700 transition-colors duration-180 ease-swift hover:text-brand-800 dark:text-accent-bright dark:hover:text-brand-300"
      >
        {t.auth.backToSignIn}
      </a>
    </div>
  );
}