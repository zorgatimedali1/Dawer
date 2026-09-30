import express from 'express';
import { httpServerHandler } from 'cloudflare:node';
import { env } from 'cloudflare:workers';
import { createRateLimitMiddleware } from './lib/express-middleware';
import { createWorkerRoute } from './lib/express-adapter';
import { CampaignParticipationLock } from './durable/campaign-lock';
import { handleAnalyticsRoute } from './routes/analytics';
import { handleAuthRoute } from './routes/auth';
import { handleBusinessRoute } from './routes/business';
import { handlePlacesAutocomplete } from './routes/places';
import { handlePublicCampaignRoute } from './routes/public';
import { handleSettingsRoute } from './routes/settings';

export { CampaignParticipationLock };

const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_request, response) => {
  response.set('Cache-Control', 'public, max-age=0, s-maxage=15');
  response.json({ success: true, status: 'ok' });
});

app.use('/api', createRateLimitMiddleware(env.API_RATE_LIMITER));
app.use('/api/places', createWorkerRoute(handlePlacesAutocomplete, env));
app.use('/api/auth', createWorkerRoute(handleAuthRoute, env));
app.use('/api/business', createWorkerRoute(handleBusinessRoute, env));
app.use('/api/analytics', createWorkerRoute(handleAnalyticsRoute, env));
app.use('/api/profile', createWorkerRoute(handleSettingsRoute, env));
app.use('/api/settings', createWorkerRoute(handleSettingsRoute, env));
app.use('/api/billing', createWorkerRoute(handleSettingsRoute, env));
app.use('/api/public', createWorkerRoute(handlePublicCampaignRoute, env, { cacheTtlSeconds: 30 }));

app.use((_request, response) => {
  response.status(404).json({ success: false, error: 'Route not found.' });
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled API error.', error);
  response.status(500).json({ success: false, error: 'Internal server error.' });
});

const expressServer = app.listen(3000);
const viteHot = (import.meta as ImportMeta & { hot?: { dispose: (callback: () => void) => void } }).hot;
viteHot?.dispose(() => expressServer.close());

export default httpServerHandler({ port: 3000 });
