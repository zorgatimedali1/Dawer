import type { Request as ExpressRequest, RequestHandler } from 'express';
import type { Env } from '../types';

type WorkerRoute = (request: Request, env: Env) => Promise<Response>;

interface WorkerRouteOptions {
  cacheTtlSeconds?: number;
}

function toWorkerRequest(request: ExpressRequest): Request {
  const headers = new Headers();

  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined) {
      headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
  }

  const method = request.method.toUpperCase();
  // `express.text` (webhook routes) leaves a string body that must pass through
  // byte-exact — re-stringifying it would corrupt the X-Hub-Signature-256 input.
  const body = method === 'GET' || method === 'HEAD' || request.body === undefined
    ? undefined
    : typeof request.body === 'string'
      ? request.body
      : JSON.stringify(request.body);

  return new Request(new URL(request.originalUrl, `https://${request.get('host') ?? 'localhost'}`), {
    method,
    headers,
    ...(body === undefined ? {} : { body }),
  });
}

export function createWorkerRoute(
  route: WorkerRoute,
  env: Env,
  options: WorkerRouteOptions = {},
): RequestHandler {
  return async (expressRequest, expressResponse, next) => {
    try {
      const request = toWorkerRequest(expressRequest);
      const canCache = options.cacheTtlSeconds !== undefined
        && request.method === 'GET'
        && !request.headers.has('authorization')
        && !request.headers.has('cookie');
      const cacheKey = canCache ? new Request(request.url, { method: 'GET' }) : undefined;

      if (cacheKey) {
        const cached = await caches.default.match(cacheKey);
        if (cached) {
            const cachedCookies = cached.headers.getSetCookie();
          if (cachedCookies.length > 0) {
            expressResponse.setHeader('set-cookie', cachedCookies);
          }
          cached.headers.forEach((value, name) => {
            if (name.toLowerCase() !== 'set-cookie') expressResponse.setHeader(name, value);
          });
          expressResponse.setHeader('X-Cache', 'HIT');
          // Bytes, not text: `response.text()` would decode binary bodies
          // (the stored company logo) as UTF-8 and corrupt every non-UTF-8
          // byte into U+FFFD on the way out.
          expressResponse.status(cached.status).send(Buffer.from(await cached.arrayBuffer()));
          return;
        }
      }

      const response = await route(request, env);
      if (cacheKey && response.ok) {
        response.headers.set('X-Cache', 'MISS');
        // A response that hands out a cookie (the signed visitor identity)
        // must never be stored: replaying one Set-Cookie would pin every
        // visitor onto the same identity. The edge cache already refuses such
        // entries — this keeps the Cache API equally strict. A route that set
        // its own Cache-Control (e.g. `no-store` on the public campaign GET,
        // whose QR-scan side effect must run per visitor) is honoured too.
        const routeControl = response.headers.get('Cache-Control');
        const routeNoStore = routeControl !== null && /no-store|private/i.test(routeControl);
        if (response.headers.getSetCookie().length === 0 && !routeNoStore) {
          response.headers.set('Cache-Control', routeControl ?? `public, max-age=0, s-maxage=${options.cacheTtlSeconds}`);
          await caches.default.put(cacheKey, response.clone());
        }
      }

      // `setHeader` replaces, so the cookies are collected first — otherwise the
      // last one silently overwrites every Set-Cookie before it.
      const setCookies = response.headers.getSetCookie();
      if (setCookies.length > 0) {
        expressResponse.setHeader('set-cookie', setCookies);
      }
      response.headers.forEach((value, name) => {
        if (name.toLowerCase() !== 'set-cookie') expressResponse.setHeader(name, value);
      });
      // `send(Buffer)` forwards the body untouched — `await response.text()`
      // would re-encode binary responses (e.g. /api/public/.../logo) through
      // UTF-8 and turn every high byte into a replacement character.
      expressResponse.status(response.status).send(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      next(error);
    }
  };
}