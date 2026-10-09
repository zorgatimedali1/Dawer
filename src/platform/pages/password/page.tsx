import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { useOperatorContext } from '@/platform/auth/operator-context';
import { PlatformAuthService } from '@/platform/services/auth.service';

export default function PasswordPage() {
  const { logout } = useOperatorContext();
  const navigate = useNavigate();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (newPassword !== confirmation) {
      setError('The new passwords do not match.');
      return;
    }

    setBusy(true);

    try {
      await PlatformAuthService.changePassword(currentPassword, newPassword);
      setNotice('Password updated. Other sessions were signed out.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Unable to update the password.');
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Platform"
        title="Change password"
        description="Rotate the operator credential. Every other session is signed out."
      />

      <form
        onSubmit={(event) => void submit(event)}
        className="max-w-lg rounded-xl border border-line bg-card p-6 shadow-soft"
      >
        {notice && (
          <div
            role="status"
            className="mb-4 rounded-lg border-l-4 border-success-400 bg-success-50 px-4 py-3 text-sm text-success-800 dark:border-success-900/60 dark:bg-success-900/30 dark:text-success-200"
          >
            {notice}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mb-4 rounded-lg border-l-4 border-danger-400 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-900/60 dark:bg-danger-900/30 dark:text-danger-200"
          >
            {error}
          </div>
        )}

        <Field label="Current password" htmlFor="current-password">
          <Input
            id="current-password"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </Field>

        <Field label="New password" htmlFor="new-password" className="mt-4">
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </Field>

        <Field label="Confirm new password" htmlFor="confirm-password" className="mt-4">
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            required
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </Field>

        <div className="mt-6 flex items-center justify-between">
          <Button type="button" variant="outline" onClick={() => void signOut()}>
            Sign out
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Updating...' : 'Update password'}
          </Button>
        </div>
      </form>
    </div>
  );
}
