/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Sentry DSN for the SPA. Absent = error tracking disabled (no SDK bytes shipped). */
  readonly VITE_SENTRY_DSN?: string;
}

declare module '*.css';
