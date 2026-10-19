/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Sentry DSN for the SPA. Absent = error tracking disabled (no SDK bytes shipped). */
  readonly VITE_SENTRY_DSN?: string;
  /** Turnstile site key (public) — the login form renders the widget + sends a
   *  token only when this is set; enforcement on the Worker requires the secret. */
  readonly VITE_TURNSTILE_SITEKEY?: string;
}

declare module '*.css';
