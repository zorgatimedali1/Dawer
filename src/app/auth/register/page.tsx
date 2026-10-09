"use client";

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Chrome, LockKeyhole, Mail, Store, User } from 'lucide-react';
import { AuthService } from '@/services/auth.service';
import { useAppContext } from '@/contexts/app-context';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useT } from '@/hooks/use-t';

export default function RegisterPage() {
  const navigate = useNavigate();
  const { login } = useAppContext();
  const t = useT();
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    firstName: '',
    lastName: '',
    businessName: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    if (formData.password !== formData.confirmPassword) {
      setError(t.auth.passwordMismatch);
      setLoading(false);
      return;
    }

    try {
      const response = await AuthService.register({
        email: formData.email,
        password: formData.password,
        firstName: formData.firstName,
        lastName: formData.lastName,
        businessName: formData.businessName,
      });

      login(response);
      setSuccess(t.auth.registerSuccess);
      setTimeout(() => navigate('/dashboard/overview'), 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.auth.registerFailed);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="space-y-1.5 text-center">
        <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">{t.auth.registerTitle}</h2>
        <p className="text-[13.5px] leading-relaxed text-ink-muted">{t.auth.registerSubtitle}</p>
      </div>

      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => window.location.assign(AuthService.googleSignInUrl())}
      >
        <Chrome aria-hidden className="h-4 w-4" />
        {t.auth.googleSignUp}
      </Button>

      <div className="flex items-center gap-3">
        <span aria-hidden className="h-px flex-1 bg-line" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">{t.auth.or}</span>
        <span aria-hidden className="h-px flex-1 bg-line" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.auth.firstName} htmlFor="firstName">
            <Input
              id="firstName"
              type="text"
              autoComplete="given-name"
              required
              inputSize="lg"
              iconStart={<User />}
              value={formData.firstName}
              onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
            />
          </Field>

          <Field label={t.auth.lastName} htmlFor="lastName">
            <Input
              id="lastName"
              type="text"
              autoComplete="family-name"
              required
              inputSize="lg"
              iconStart={<User />}
              value={formData.lastName}
              onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
            />
          </Field>
        </div>

        <Field label={t.auth.businessName} htmlFor="businessName">
          <Input
            id="businessName"
            type="text"
            required
            inputSize="lg"
            iconStart={<Store />}
            value={formData.businessName}
            onChange={(e) => setFormData({ ...formData, businessName: e.target.value })}
          />
        </Field>

        <Field label={t.auth.email} htmlFor="email">
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            inputSize="lg"
            iconStart={<Mail />}
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          />
        </Field>

        <Field label={t.auth.password} htmlFor="password">
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            inputSize="lg"
            iconStart={<LockKeyhole />}
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
          />
        </Field>

        <Field label={t.auth.confirmPassword} htmlFor="confirmPassword">
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            inputSize="lg"
            iconStart={<LockKeyhole />}
            value={formData.confirmPassword}
            onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
          />
        </Field>

        {error && (
          <p className="rounded-lg border border-danger-300/60 bg-danger-50 px-3 py-2.5 text-[13px] leading-relaxed text-danger-800 dark:border-danger-900/60 dark:bg-danger-900/30 dark:text-danger-200">
            {error}
          </p>
        )}
        {success && (
          <p className="rounded-lg border border-success-300/60 bg-success-50 px-3 py-2.5 text-[13px] leading-relaxed text-success-800 dark:border-success-900/60 dark:bg-success-900/30 dark:text-success-200">
            {success}
          </p>
        )}

        <Button type="submit" size="lg" className="w-full" loading={loading}>
          {loading ? t.auth.creatingAccount : t.auth.createAccount}
        </Button>
      </form>

      <p className="text-center text-[13px] text-ink-muted">
        {t.auth.haveAccount}{' '}
        <a
          href="/auth/login"
          className="font-medium text-brand-700 transition-colors duration-180 ease-swift hover:text-brand-800 dark:text-accent-bright dark:hover:text-brand-300"
        >
          {t.auth.signIn}
        </a>
      </p>
    </div>
  );
}