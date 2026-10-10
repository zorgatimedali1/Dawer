import * as Sentry from '@sentry/react';
import { registerErrorCapture } from './monitoring';

/**
 * Called from a dynamic import, and only when VITE_SENTRY_DSN is set at build
 * time. Without a DSN this module never loads, so visitors pay zero bytes for
 * error tracking that isn't configured.
 */
export function initSentry(app: 'merchant' | 'platform'): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.2,
  });
  Sentry.setTag('app', app);

  registerErrorCapture((error, context) => {
    Sentry.captureException(error, context ? { extra: context } : undefined);
  });
}
