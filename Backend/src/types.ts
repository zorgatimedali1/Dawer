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
  /** Public origin of the SPA, used to build links in outbound emails. */
  APP_ORIGIN?: string;
  /** `true`/`1` makes the public geofence reject requests with no country signal. */
  GEOFENCE_STRICT?: string;
  /** Base URL of the standalone WhatsApp Web gateway container. */
  GATEWAY_URL?: string;
  /** HMAC key for per-tenant gateway tokens; never sent to the gateway as-is. */
  GATEWAY_SECRET?: string;
  /** Optional CSV of business ids allowed to use WhatsApp Web (pilot switch). */
  WHATSAPP_WEB_ALLOWLIST?: string;
  /** Shared secret for gateway-to-Worker progress callbacks. */
  WHATSAPP_WEB_CALLBACK_SECRET?: string;
};
