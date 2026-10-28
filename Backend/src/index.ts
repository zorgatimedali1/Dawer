import express from 'express';
import { httpServerHandler } from 'cloudflare:node';
import { env } from 'cloudflare:workers';
import * as Sentry from '@sentry/cloudflare';
import { createCrossOriginGuard, createGeofenceMiddleware, createRateLimitMiddleware } from './lib/express-middleware';
import { createWorkerRoute } from './lib/express-adapter';
import { timingSafeEqualString } from './lib/crypto';
import { runReconcile } from './lib/reconcile';
import { CampaignParticipationLock as CampaignParticipationLockBase } from './durable/campaign-lock';
import { EmailBroadcastSender as EmailBroadcastSenderBase } from './durable/email-sender';
import { WhatsAppPacingGate as WhatsAppPacingGateBase } from './durable/pacing-gate';
import { WhatsAppBroadcastSender as WhatsAppBroadcastSenderBase } from './durable/whatsapp-sender';
import { handleAnalyticsRoute } from './routes/analytics';
import { handleAuthRoute } from './routes/auth';
import { handleBusinessRoute } from './routes/business';
import { handleEmailAssetRoute, handleEmailRoute } from './routes/email';
import { handlePlacesAutocomplete } from './routes/places';
import { handlePublicPartnerRoute } from './routes/partners';
import { handlePublicPlansRoute } from './routes/public-plans';
import { handleOauthDiscoveryRoute, handleOauthTokenRoute } from './routes/oauth';
import { handlePublicCampaignRoute } from './routes/public';
import { handleVisitRoute } from './routes/visits';
import { handleSettingsRoute } from './routes/settings';
import { handleWhatsAppRoute } from './routes/whatsapp';
import { handleWhatsAppWebRoute } from './routes/whatsapp-web';
import { handleSmsRoute } from './routes/sms';
import { handleWebhookRoute } from './routes/webhooks';
import type { Env } from './types';

// No SENTRY_DSN secret -> dsn is undefined and the SDK stays a no-op, so the
// wiring costs nothing until a DSN is configured.
const sentryOptions = (sentryEnv: Env) => ({
  dsn: sentryEnv.SENTRY_DSN,
  environment: sentryEnv.SENTRY_ENVIRONMENT || 'production',
  tracesSampleRate: 0.2,
});

export const CampaignParticipationLock = Sentry.instrumentDurableObjectWithSentry(
  sentryOptions,
  CampaignParticipationLockBase,
);
export const EmailBroadcastSender = Sentry.instrumentDurableObjectWithSentry(
  sentryOptions,
  EmailBroadcastSenderBase,
);
export const WhatsAppPacingGate = Sentry.instrumentDurableObjectWithSentry(sentryOptions, WhatsAppPacingGateBase);
export const WhatsAppBroadcastSender = Sentry.instrumentDurableObjectWithSentry(
  sentryOptions,
  WhatsAppBroadcastSenderBase,
);

const app = express();

app.disable('x-powered-by');
// Baseline security headers for every API response; the SPA document gets the
// same set (plus CSP) from the static assets `_headers` file. The API CSP
// allows inline styles only: the one-click unsubscribe page (text/html) styles
// itself with attribute styles and ships no script.
app.use((_request, response, next) => {
  response.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  response.set('X-Content-Type-Options', 'nosniff');
  response.set('X-Frame-Options', 'DENY');
  response.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
  response.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.set('Cross-Origin-Resource-Policy', 'same-origin');
  response.set(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
  );
  next();
});
// CSRF backstop for state-changing requests; runs before any body parsing so a
// cross-site write is refused without paying for it. Skips GET (OAuth
// callback, one-click unsubscribe) and the signed webhook callbacks.
app.use(createCrossOriginGuard());
// Meta webhook POSTs must reach the route as the exact raw bytes it signed,
// so this runs before express.json and keeps the body a plain string.
app.use('/api/webhooks/whatsapp', express.text({ type: '*/*', limit: '1mb' }));
// Brevo webhook payloads are JSON parsed from the exact raw body too.
app.use('/api/webhooks/brevo', express.text({ type: '*/*', limit: '1mb' }));
// Mailjet event callbacks are raw JSON as well (single event or grouped array).
app.use('/api/webhooks/mailjet', express.text({ type: '*/*', limit: '1mb' }));
// Attachment uploads carry up to 8 MB of base64 — they need their own body
// parser before the global 1 MB limit applies (body-parser skips
// requests whose body it already parsed).
app.use('/api/email/asset', express.json({ limit: '12mb' }));
// Logo uploads carry up to 512 KB of binary (~700 KB of base64). The global
// 1 MB limit is too tight once JSON overhead is counted, and a body that
// blows the limit dies inside body-parser with an opaque 500 before the
// route can answer with a helpful validation message.
app.use('/api/settings/logo', express.json({ limit: '2mb' }));
app.use('/api/settings/wheel-logo', express.json({ limit: '2mb' }));
// RFC 6749 §4.3.2 token grants arrive as form-encoded bodies; parse that
// content type ahead of the global JSON parser.
app.use('/api/oauth/token', express.urlencoded({ extended: false }));
app.use(express.json({ limit: '1mb' }));

app.get('/health', async (request, response) => {
  // The heartbeat payload is operational detail (cron/reconcile recency), so
  // once HEALTH_CHECK_TOKEN exists probes must prove it — `.github/workflows/
  // health-monitor.yml` sends the same value in the `x-health-token` header.
  // Unset (local dev, or production before the secret is registered) keeps
  // probes open so nothing breaks the moment this ships.
  const healthToken = (env as Env).HEALTH_CHECK_TOKEN;
  const rawHealthHeader = request.headers['x-health-token'];
  const providedHealthToken = Array.isArray(rawHealthHeader) ? rawHealthHeader[0] : rawHealthHeader;
  if (healthToken && !(providedHealthToken && timingSafeEqualString(providedHealthToken, healthToken))) {
    response.status(404).json({ success: false, error: 'Route not found.' });
    return;
  }
  response.set('Cache-Control', 'public, max-age=0, s-maxage=15');
  let lastCronAt: string | null = null;
  let lastReconcileAt: string | null = null;
  try {
    // Heartbeats written by the cron (TTL 2 days): lastCronAt proves the
    // trigger still fires, lastReconcileAt additionally proves a run finished.
    const [cron, reconcile] = await Promise.all([
      env.TOKENS.get('health:last_cron', { cacheTtl: 30 }),
      env.TOKENS.get('health:last_reconcile', { cacheTtl: 30 }),
    ]);
    lastCronAt = cron ?? null;
    lastReconcileAt = reconcile ?? null;
  } catch {
    // Informational only — never fail the health probe over it.
  }
  response.json({ success: true, status: 'ok', lastCronAt, lastReconcileAt });
});

// Webhooks get their own (ip-keyed) limiter bucket: Meta's status bursts run
// past the general API budget, and a 429 there marks the endpoint unhealthy
// in Meta's eyes. Keying deliberately stays on the IP — keying on signature
// headers would let a forged header mint fresh buckets. Signature verification
// is the security control, not the limiter.
app.use(
  '/api/webhooks',
  createRateLimitMiddleware(env.WEBHOOK_RATE_LIMITER, { ipOnly: true }),
  createWorkerRoute(handleWebhookRoute, env),
);
// Public campaign links circulate outside our control and get far more traffic
// than the dashboard: they carry their own budget, and the API limiter skips
// the same paths so a social burst cannot spend the dashboard's quota.
const geofenceCountries = new Set(
  (env.GEOFENCE_COUNTRIES ?? 'TN')
    .split(',')
    .map((country) => country.trim().toUpperCase())
    .filter(Boolean),
);
// The runtime env is typed from the wrangler config; optional knobs that are
// not declared as config vars (set via `wrangler secret put` when needed)
// come from the extended Env type.
const geofenceStrict = (env as Env).GEOFENCE_STRICT === 'true' || (env as Env).GEOFENCE_STRICT === '1';
// The partner marquee is public marketing content: its feed and logo bytes
// must load for visitors from anywhere, so this mount runs ahead of the TN
// geofence. It still carries the dedicated public rate-limit bucket and the
// 30s edge cache every public GET gets.
app.use(
  '/api/public/partners',
  createRateLimitMiddleware(env.PUBLIC_RATE_LIMITER),
  createWorkerRoute(handlePublicPartnerRoute, env, { cacheTtlSeconds: 30 }),
);
// Public pricing feed for the landing page: same treatment as the partner
// marquee (global reach, public bucket, 30s edge cache) so operator plan
// edits reach visitors without waiting on a redeploy.
app.use(
  '/api/public/plans',
  createRateLimitMiddleware(env.PUBLIC_RATE_LIMITER),
  createWorkerRoute(handlePublicPlansRoute, env, { cacheTtlSeconds: 30 }),
);
// Campaign attachment bytes (inline images fetched by mail scanners from
// inside the inbox): served outside the TN geofence on purpose — the
// recipients' mail clients live everywhere. Random UUID keys + a long edge
// cache keep the origin load tiny; the public bucket absorbs refetch bursts.
app.use(
  '/api/email-assets',
  createRateLimitMiddleware(env.PUBLIC_RATE_LIMITER),
  createWorkerRoute(handleEmailAssetRoute, env, { cacheTtlSeconds: 3600 }),
);
// Website visit beacon from the SPA: mounted with the public bucket ahead of
// the TN geofence so page views from anywhere are counted for the operator
// analytics (one lightweight insert per SPA route change).
app.use(
  '/api/public/visit',
  createRateLimitMiddleware(env.PUBLIC_RATE_LIMITER),
  createWorkerRoute(handleVisitRoute, env),
);
app.use('/api/public', createGeofenceMiddleware(geofenceCountries, { strict: geofenceStrict }));
app.use('/api/public', createRateLimitMiddleware(env.PUBLIC_RATE_LIMITER));
app.use('/api', createRateLimitMiddleware(env.API_RATE_LIMITER, { skipPaths: ['/api/public'] }));
app.use('/api/places', createWorkerRoute(handlePlacesAutocomplete, env));
// Auth gets a dedicated tight bucket on top of the general API one, and runs
// fail-closed: login is exactly where a limiter outage must not mean "allow".
app.use('/api/auth', createRateLimitMiddleware(env.AUTH_RATE_LIMITER, { ipOnly: true, failClosed: true }));
app.use('/api/auth', createWorkerRoute(handleAuthRoute, env));
// RFC 8414 discovery doc: static JSON ahead of the SPA fallback. /.well-known/*
// is in run_worker_first so the asset layer never claims it.
app.use('/.well-known', createWorkerRoute(handleOauthDiscoveryRoute, env));
// OAuth token endpoint shares the interactive login's tight bucket (parameter
// brute force is credential assault, not dashboard traffic).
app.use('/api/oauth', createRateLimitMiddleware(env.AUTH_RATE_LIMITER, { ipOnly: true, failClosed: true }));
app.use('/api/oauth', createWorkerRoute(handleOauthTokenRoute, env));
app.use('/api/business', createWorkerRoute(handleBusinessRoute, env));
app.use('/api/analytics', createWorkerRoute(handleAnalyticsRoute, env));
app.use('/api/profile', createWorkerRoute(handleSettingsRoute, env));
app.use('/api/settings', createWorkerRoute(handleSettingsRoute, env));
app.use('/api/billing', createWorkerRoute(handleSettingsRoute, env));
app.use('/api/whatsapp', createWorkerRoute(handleWhatsAppRoute, env));
// Parallel WhatsApp Web gateway feature (whatsapp-saas-backend container).
app.use('/api/whatsapp-web', createWorkerRoute(handleWhatsAppWebRoute, env));
// Parallel SMS marketing feature (SMS-Gate 3rd-party API).
app.use('/api/sms', createWorkerRoute(handleSmsRoute, env));
app.use('/api/email', createWorkerRoute(handleEmailRoute, env));
app.use('/api/public', createWorkerRoute(handlePublicCampaignRoute, env, { cacheTtlSeconds: 30 }));

app.use((_request, response) => {
  response.status(404).json({ success: false, error: 'Route not found.' });
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  // body-parser / express.json failures (payload too large, invalid JSON)
  // carry their own status; without this they surface as an opaque 500.
  const status =
    typeof error === 'object' && error !== null && 'status' in error && typeof (error as { status?: unknown }).status === 'number'
      ? (error as { status: number }).status
      : 500;
  if (status >= 500) {
    console.error('Unhandled API error.', error);
    response.status(500).json({ success: false, error: 'Internal server error.' });
    return;
  }
  const message =
    status === 413
      ? 'The uploaded file is too large.'
      : 'Unable to send the request.';
  response.status(status).json({ success: false, error: message });
});

const expressServer = app.listen(3000);
const viteHot = (import.meta as ImportMeta & { hot?: { dispose: (callback: () => void) => void } }).hot;
viteHot?.dispose(() => expressServer.close());

/**
 * Cron trigger (every 10 minutes): settles broadcasts whose sender died so a
 * stranded campaign can never hold its quota reservation forever.
 */
export async function scheduled(
  _controller: ScheduledController,
  scheduledEnv: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  const heartbeat = { expirationTtl: 172_800 };
  // Liveness first: even a failing reconciler must leave proof the trigger ran.
  try {
    await scheduledEnv.TOKENS.put('health:last_cron', new Date().toISOString(), heartbeat);
  } catch (error) {
    console.error('Cron heartbeat failed.', error);
  }

  try {
    await runReconcile(scheduledEnv);
    try {
      await scheduledEnv.TOKENS.put('health:last_reconcile', new Date().toISOString(), heartbeat);
    } catch (error) {
      console.error('Reconcile heartbeat failed.', error);
    }
  } catch (error) {
    console.error('Reconcile run failed.', error);
  }
}

// The default export must be ONE handler object: when a default-exported
// handler object exists, the runtime dispatches cron events through it and
// ignores module-level named exports, so `scheduled` hangs off the same
// object (otherwise every tick dies with "Handler does not export a
// scheduled() function"). withSentry instruments fetch + scheduled in place.
const handler = httpServerHandler({ port: 3000 });

export default Sentry.withSentry(sentryOptions, { ...handler, scheduled });
