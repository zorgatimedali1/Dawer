import express from 'express';
import { httpServerHandler } from 'cloudflare:node';
import { env } from 'cloudflare:workers';
import * as Sentry from '@sentry/cloudflare';
import { createCrossOriginGuard, createRateLimitMiddleware } from '../lib/express-middleware';
import { createWorkerRoute } from '../lib/express-adapter';
import { timingSafeEqualString } from '../lib/crypto';
import { handleOperatorAuthRoute } from './routes/auth';
import { handleSubscriptionRoute } from './routes/subscriptions';
import { handlePlatformFeaturesRoute } from './routes/settings';
import { handleStatsRoute } from './routes/stats';
import { handleAdminRoute } from './routes/admin';
import { handlePartnerAdminRoute } from './routes/partners';
import { handlePlanAdminRoute } from './routes/plans';
import { handlePublicPartnerRoute } from '../routes/partners';
import type { Env } from '../types';

// No SENTRY_DSN secret -> no-op (same pattern as the merchant worker).
const sentryOptions = (sentryEnv: Env) => ({
  dsn: sentryEnv.SENTRY_DSN,
  environment: sentryEnv.SENTRY_ENVIRONMENT || 'production',
  tracesSampleRate: 0.2,
});

const app = express();

app.disable('x-powered-by');
// Same baseline security headers as the merchant API (P1-3), plus HSTS and a
// strict JSON CSP. The platform SPA document gets its set from `_headers`.
app.use((_request, response, next) => {
  response.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  response.set('X-Content-Type-Options', 'nosniff');
  response.set('X-Frame-Options', 'DENY');
  response.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
  response.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.set('Cross-Origin-Resource-Policy', 'same-origin');
  response.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  next();
});
// CSRF backstop for state-changing requests; GETs (navigation) pass through.
app.use(createCrossOriginGuard());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (request, response) => {
  // Same token gate as the merchant worker: operational heartbeat stays open
  // until HEALTH_CHECK_TOKEN is registered, then requires `x-health-token`.
  const healthToken = (env as Env).HEALTH_CHECK_TOKEN;
  const rawHealthHeader = request.headers['x-health-token'];
  const providedHealthToken = Array.isArray(rawHealthHeader) ? rawHealthHeader[0] : rawHealthHeader;
  if (healthToken && !(providedHealthToken && timingSafeEqualString(providedHealthToken, healthToken))) {
    response.status(404).json({ success: false, error: 'Route not found.' });
    return;
  }
  response.set('Cache-Control', 'public, max-age=0, s-maxage=15');
  response.json({ success: true, status: 'ok' });
});

app.use('/api', createRateLimitMiddleware(env.API_RATE_LIMITER));
// Operator auth gets a dedicated tight bucket on top of the general API one
// (mirrors the merchant worker) and runs fail-closed: login is exactly where a
// limiter outage must not mean "allow".
app.use('/api/auth', createRateLimitMiddleware(env.AUTH_RATE_LIMITER, { ipOnly: true, failClosed: true }));
app.use('/api/auth', createWorkerRoute(handleOperatorAuthRoute, env));
// Partner marquee management. The console lives on its own origin, so it also
// mounts the public partners feed/logo route to render the stored images.
app.use('/api/public/partners', createWorkerRoute(handlePublicPartnerRoute, env, { cacheTtlSeconds: 30 }));
app.use('/api/admin/partners', createWorkerRoute(handlePartnerAdminRoute, env));
app.use('/api/admin/plans', createWorkerRoute(handlePlanAdminRoute, env));
// Before the `/api/admin` mount: admin only recognises `/api/admin/accounts`
// and would answer 404 for anything else.
app.use('/api/admin/subscriptions', createWorkerRoute(handleSubscriptionRoute, env));
app.use('/api/admin/platform-features', createWorkerRoute(handlePlatformFeaturesRoute, env));
app.use('/api/admin/stats', createWorkerRoute(handleStatsRoute, env));
app.use('/api/admin', createWorkerRoute(handleAdminRoute, env));

app.use((_request, response) => {
  response.status(404).json({ success: false, error: 'Route not found.' });
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled platform API error.', error);
  response.status(500).json({ success: false, error: 'Internal server error.' });
});

const expressServer = app.listen(3001);
const viteHot = (import.meta as ImportMeta & { hot?: { dispose: (callback: () => void) => void } }).hot;
viteHot?.dispose(() => expressServer.close());

export default Sentry.withSentry(sentryOptions, httpServerHandler({ port: 3001 }));
