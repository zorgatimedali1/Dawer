type ErrorContext = Record<string, unknown>;
type CaptureFn = (error: unknown, context?: ErrorContext) => void;

// The real capture function is registered by sentry.client.ts only when a DSN
// is configured (it arrives via a dynamic import, so the SDK stays out of the
// main bundle). Until then — and if the SDK ever fails to load — reporting is
// a silent no-op: monitoring must never break the app.
let capture: CaptureFn | null = null;

export function registerErrorCapture(fn: CaptureFn): void {
  capture = fn;
}

export function reportError(error: unknown, context?: ErrorContext): void {
  try {
    capture?.(error, context);
  } catch {
    // Intentionally empty.
  }
}
