'use client';

import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LockKeyhole, ShieldCheck } from 'lucide-react';
import { AuthService } from '@/services/auth.service';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useT } from '@/hooks/use-t';

export default function ResetPasswordPage() {
  const t = useT();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!token) {
      setError(t.auth.resetFailed);
      return;
    }

    if (password !== confirm) {
      setError(t.auth.passwordMismatch);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await AuthService.resetPassword(token, password);
      setSuccess(true);
    } catch {
      setError(t.auth.resetFailed);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="space-y-1.5 text-center">
        <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">
          {t.auth.resetTitle}
        </h2>
        <p className="text-[13.5px] leading-relaxed text-ink-muted">{t.auth.resetSubtitle}</p>
      </div>

      {success ? (
        <p className="rounded-lg border border-success-300/60 bg-success-50 px-3 py-2.5 text-[13px] leading-relaxed text-success-800 dark:border-success-900/60 dark:bg-success-900/30 dark:text-success-200">
          {t.auth.resetSuccess}
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label={t.auth.newPassword} htmlFor="password">
            <Input
              id="password"
              type="password"
              required
              minLength={8}
              inputSize="lg"
              iconStart={<LockKeyhole />}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>

          <Field
            label={t.auth.confirmPassword}
            htmlFor="confirm"
            error={
              password && confirm && password !== confirm
                ? t.auth.passwordMismatch
                : undefined
            }
          >
            <Input
              id="confirm"
              type="password"
              required
              minLength={8}
              inputSize="lg"
              iconStart={<ShieldCheck />}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>

          {error && (
            <p className="rounded-lg border border-danger-300/60 bg-danger-50 px-3 py-2.5 text-[13px] leading-relaxed text-danger-800 dark:border-danger-900/60 dark:bg-danger-900/30 dark:text-danger-200">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" className="w-full" loading={loading}>
            {loading ? t.common.saving : t.common.save}
          </Button>
        </form>
      )}
    </div>
  );
}