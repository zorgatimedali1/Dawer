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
  const body = method === 'GET' || method === 'HEAD' || request.body === undefined
    ? undefined
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
          cached.headers.forEach((value, name) => expressResponse.setHeader(name, value));
          expressResponse.setHeader('X-Cache', 'HIT');
          expressResponse.status(cached.status).send(await cached.text());
          return;
        }
      }

      const response = await route(request, env);
      if (cacheKey && response.ok) {
        response.headers.set('Cache-Control', `public, max-age=0, s-maxage=${options.cacheTtlSeconds}`);
        response.headers.set('X-Cache', 'MISS');
        await caches.default.put(cacheKey, response.clone());
      }

      response.headers.forEach((value, name) => expressResponse.setHeader(name, value));
      expressResponse.status(response.status).send(await response.text());
    } catch (error) {
      next(error);
    }
  };
}