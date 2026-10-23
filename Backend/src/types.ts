export type Env = Cloudflare.Env & {
  GOOGLE_MAPS_API_KEY?: string;
  WHATSAPP_TOKEN?: string;
  WHATSAPP_PHONE_ID?: string;
  /** Email provider: 'mailjet' (default), 'brevo' or 'resend' (both dormant). */
  EMAIL_PROVIDER?: string;
  /** Mailjet public API key (secret). */
  MAILJET_API_KEY?: string;
  /** Mailjet private API key — paired with MAILJET_API_KEY for Basic auth. */
  MAILJET_API_SECRET?: string;
  /** Token in the Mailjet event-callback URL (bounces/blocks/spam/unsub). */
  MAILJET_WEBHOOK_TOKEN?: string;
  /** One-time secret for POST /api/bootstrap: provisions the first platform
   *  operator on an empty install (replaces the seeded credential). Unset =
   *  the route answers 404 and the bootstrap is impossible (fail closed). */
  PLATFORM_BOOTSTRAP_TOKEN?: string;
  /** Dormant: Brevo API key (EMAIL_PROVIDER='brevo'). */
  BREVO_API_KEY?: string;
  /** Dormant: Resend API key (EMAIL_PROVIDER='resend'). */
  RESEND_API_KEY?: string;
  /** Verified sender address (secret, e.g. no-reply@example.com). */
  EMAIL_FROM?: string;
  /** Shared token pasted into the Brevo webhook form (bounces/blocks/spam). */
  BREVO_WEBHOOK_SECRET?: string;
  /** Marketing recipients per UTC day (default 190 — reserves 10 for resets). */
  EMAIL_MARKETING_DAILY_CAP?: string;
  /** Account-wide monthly send ceiling across all tenants (default 5800). */
  EMAIL_MONTHLY_SOFT_CAP?: string;
  /** Displayed daily quota ceiling (Mailjet free tier default 200). */
  EMAIL_DAILY_LIMIT?: string;
  /** R2 bucket holding email campaign attachments (images/PDFs). */
  CAMPAIGN_ASSETS: R2Bucket;
  WHATSAPP_WEBHOOK_VERIFY_TOKEN?: string;
  META_APP_SECRET?: string;
  /** HMAC key for server-set identities (signed spin visitor cookie). */
  COOKIE_SIGNING_KEY?: string;
  /** When set (secret), /health requires the matching `x-health-token` header
   *  (the GitHub health-monitor workflow sends it). Unset = probes open. */
  HEALTH_CHECK_TOKEN?: string;
  /** Public origin of the SPA, used to build links in outbound emails. */
  APP_ORIGIN?: string;
  /** Sentry DSN (secret). Absent = error tracking stays disabled. */
  SENTRY_DSN?: string;
  /** Sentry environment label (defaults to 'production'). */
  SENTRY_ENVIRONMENT?: string;
  /** `true`/`1` makes the public geofence reject requests with no country signal. */
  GEOFENCE_STRICT?: string;
  /** Platform-wide safety valve: max participations accepted per campaign per
   *  UTC day (default 5000). Bounds how much of the shared D1 write budget a
   *  single viral wheel can consume, so one hot campaign cannot make every
   *  other merchant's spins start failing. 0/empty disables the cap. */
  CAMPAIGN_DAILY_SPIN_CAP?: string;
  /** Anti-farm safety floor: max spins accepted per IP per rolling 24 h on a
   *  campaign, applied in every mode (once + windowed). The merchant's own
   *  `maxPlaysPerIpDay` wins when it is higher; the floor only lifts campaigns
   *  that configured nothing (or something smaller), so one address rotating
   *  cookies/ids cannot replay a wheel. 0/empty disables the floor. */
  IP_SPINS_PER_DAY?: string;
  /** Anti-farm safety floor: max *wins* accepted per IP per rolling 24 h, in
   *  every mode. The merchant's `winBudget` wins when higher. Backstops a farm
   *  from draining a campaign's stock or win budget from a single address.
   *  0/empty disables the floor. */
  IP_WINS_PER_DAY?: string;
  /** Base URL of the standalone WhatsApp Web gateway container. */
  GATEWAY_URL?: string;
  /** HMAC key for per-tenant gateway tokens; never sent to the gateway as-is. */
  GATEWAY_SECRET?: string;
  /** Optional CSV of business ids allowed to use WhatsApp Web (pilot switch). */
  WHATSAPP_WEB_ALLOWLIST?: string;
  /** Shared secret for gateway-to-Worker progress callbacks. */
  WHATSAPP_WEB_CALLBACK_SECRET?: string;
  /** Cloudflare Turnstile secret key (opt-in bot protection, M7). When set,
   *  the public participate endpoint requires a valid Turnstile token. When
   *  unset the check is skipped (fail-open) so nothing breaks before the
   *  operator provisions a widget. */
  TURNSTILE_SECRET_KEY?: string;
  /** Turnstile site key (public), surfaced to the SPA so it can render the
   *  widget only when enforcement is on. */
  TURNSTILE_SITE_KEY?: string;
  /** Optional CSV of frontend hostnames Siteverify must match. */
  TURNSTILE_HOSTNAMES?: string;
  /** SMS-Gate 3rd-party API base URL (default https://api.sms-gate.app/3rdparty/v1). */
  SMS_GATEWAY_URL?: string;
  /** SMS-Gate API user (secret) — paired with SMS_GATEWAY_PASSWORD for Basic auth. */
  SMS_GATEWAY_USER?: string;
  /** SMS-Gate API password (secret). */
  SMS_GATEWAY_PASSWORD?: string;
  /** Optional CSV of business ids allowed to use SMS broadcasts (pilot switch). */
  SMS_ALLOWLIST?: string;
  /** Shared secret for gateway-to-Worker SMS webhook callbacks. */
  SMS_WEBHOOK_SECRET?: string;
};
