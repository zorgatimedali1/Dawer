import express from 'express';
import { httpServerHandler } from 'cloudflare:node';
import { env } from 'cloudflare:workers';
import { createRateLimitMiddleware } from '../lib/express-middleware';
import { createWorkerRoute } from '../lib/express-adapter';
import { handleOperatorAuthRoute } from './routes/auth';
import { handleSubscriptionRoute } from './routes/subscriptions';
import { handlePlatformFeaturesRoute } from './routes/settings';
import { handleStatsRoute } from './routes/stats';
import { handleAdminRoute } from './routes/admin';
import { handlePartnerAdminRoute } from './routes/partners';
import { handlePlanAdminRoute } from './routes/plans';
import { handlePublicPartnerRoute } from '../routes/partners';

const app = express();

app.disable('x-powered-by');
// Same baseline security headers as the merchant API (P1-3).
app.use((_request, response, next) => {
  response.set('X-Content-Type-Options', 'nosniff');
  response.set('X-Frame-Options', 'DENY');
  response.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.set('Cross-Origin-Resource-Policy', 'same-origin');
  next();
});
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_request, response) => {
  response.set('Cache-Control', 'public, max-age=0, s-maxage=15');
  response.json({ success: true, status: 'ok' });
});

app.use('/api', createRateLimitMiddleware(env.API_RATE_LIMITER));
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

export default httpServerHandler({ port: 3001 });
