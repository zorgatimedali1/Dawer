import type { RequestHandler } from 'express';
import type { RateLimit } from '@cloudflare/workers-types';

export function createRateLimitMiddleware(limiter: RateLimit): RequestHandler {
  return async (request, response, next) => {
    try {
      const clientIp = request.get('cf-connecting-ip') ?? request.ip ?? 'unknown';
      const { success } = await limiter.limit({ key: `${clientIp}:${request.path}` });

      if (!success) {
        response.set('Retry-After', '60');
        response.status(429).json({ success: false, error: 'Too many requests.' });
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}