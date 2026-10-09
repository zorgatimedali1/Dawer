import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import type { RateLimit } from '@cloudflare/workers-types';
import { createGeofenceMiddleware, createRateLimitMiddleware } from '../lib/express-middleware';

function fakeRequest(overrides: Partial<Record<string, unknown>> = {}): ExpressRequest {
  const headers = (overrides.headers as Record<string, string> | undefined) ?? {};
  const originalUrl = (overrides.originalUrl as string | undefined) ?? '/api/business/customers';
  return {
    method: 'GET',
    originalUrl,
    url: originalUrl,
    path: originalUrl.split('?')[0],
    ip: undefined,
    get: (name: string) => headers[name.toLowerCase()],
    ...overrides,
  } as unknown as ExpressRequest;
}

class FakeResponse {
  statusCode = 200;

  readonly headers = new Map<string, string>();

  body: unknown;

  set(name: string, value: string): this {
    this.headers.set(name.toLowerCase(), value);
    return this;
  }

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  json(body: unknown): this {
    this.body = body;
    return this;
  }
}

function asExpressResponse(response: FakeResponse): ExpressResponse {
  return response as unknown as ExpressResponse;
}

function fakeLimiter(behaviour: { success: boolean } | Error = { success: true }): {
  limiter: RateLimit;
  limit: ReturnType<typeof vi.fn>;
} {
  const limit = vi.fn(async () => {
    if (behaviour instanceof Error) throw behaviour;
    return behaviour;
  });
  return { limiter: { limit } as unknown as RateLimit, limit };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createRateLimitMiddleware', () => {
  it('charges the ip + method + normalized path key and calls next', async () => {
    const { limiter, limit } = fakeLimiter();
    const next = vi.fn();
    const request = fakeRequest({
      originalUrl: '/api/customers/a1b2c3d4-e5f6-7890-abcd-ef0123456789',
      headers: { 'cf-connecting-ip': '198.51.100.7' },
    });

    await createRateLimitMiddleware(limiter)(request, asExpressResponse(new FakeResponse()), next);

    expect(limit).toHaveBeenCalledTimes(1);
    expect(limit.mock.calls[0]?.[0]).toEqual({ key: '198.51.100.7:GET:/api/customers/:id' });
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]?.[0]).toBeUndefined();
  });

  it('429s when the bucket is exhausted', async () => {
    const { limiter } = fakeLimiter({ success: false });
    const next = vi.fn();
    const response = new FakeResponse();
    const request = fakeRequest({ headers: { 'cf-connecting-ip': '198.51.100.7' } });

    await createRateLimitMiddleware(limiter)(request, asExpressResponse(response), next);

    expect(response.statusCode).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(response.body).toEqual({ success: false, error: 'Too many requests.' });
    expect(next).not.toHaveBeenCalled();
  });

  it('fails open when no client IP is available instead of sharing one bucket', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { limiter, limit } = fakeLimiter();
    const next = vi.fn();

    await createRateLimitMiddleware(limiter)(fakeRequest(), asExpressResponse(new FakeResponse()), next);

    expect(limit).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]?.[0]).toBeUndefined();
    expect(console.error).toHaveBeenCalledWith('rate_limiter_missing_ip', expect.any(String));
  });

  it('fails open when the limiter itself errors instead of 500ing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { limiter } = fakeLimiter(new Error('binding unavailable'));
    const next = vi.fn();
    const response = new FakeResponse();
    const request = fakeRequest({ headers: { 'cf-connecting-ip': '198.51.100.7' } });

    await createRateLimitMiddleware(limiter)(request, asExpressResponse(response), next);

    expect(response.statusCode).toBe(200);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]?.[0]).toBeUndefined();
    expect(console.error).toHaveBeenCalledWith('rate_limiter_error', expect.stringContaining('binding unavailable'));
  });

  it('bypasses limiter calls for configured skipPaths', async () => {
    const { limiter, limit } = fakeLimiter();
    const next = vi.fn();
    const request = fakeRequest({
      originalUrl: '/api/public/campaigns/C4244DA64D58/participate',
      headers: { 'cf-connecting-ip': '198.51.100.7' },
    });

    await createRateLimitMiddleware(limiter, { skipPaths: ['/api/public'] })(
      request,
      asExpressResponse(new FakeResponse()),
      next,
    );

    expect(limit).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('keys ip-only when asked (webhook bucket)', async () => {
    const { limiter, limit } = fakeLimiter();
    const next = vi.fn();
    const request = fakeRequest({
      originalUrl: '/api/webhooks/whatsapp',
      headers: { 'cf-connecting-ip': '203.0.113.9' },
    });

    await createRateLimitMiddleware(limiter, { ipOnly: true })(
      request,
      asExpressResponse(new FakeResponse()),
      next,
    );

    expect(limit.mock.calls[0]?.[0]).toEqual({ key: '203.0.113.9' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('fail-closed: rejects when the limiter itself errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { limiter } = fakeLimiter(new Error('binding unavailable'));
    const next = vi.fn();
    const response = new FakeResponse();
    const request = fakeRequest({ headers: { 'cf-connecting-ip': '198.51.100.7' } });

    await createRateLimitMiddleware(limiter, { failClosed: true })(
      request,
      asExpressResponse(response),
      next,
    );

    expect(response.statusCode).toBe(503);
    expect(response.body).toEqual({ success: false, error: 'Service temporarily unavailable.' });
    expect(next).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('rate_limiter_error', expect.stringContaining('binding unavailable'));
  });

  it('fail-closed: rejects requests with no client IP instead of passing them', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { limiter, limit } = fakeLimiter();
    const next = vi.fn();
    const response = new FakeResponse();

    await createRateLimitMiddleware(limiter, { failClosed: true })(
      fakeRequest(),
      asExpressResponse(response),
      next,
    );

    expect(limit).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(403);
    expect(response.body).toEqual({ success: false, error: 'Unable to verify your network.' });
    expect(next).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('rate_limiter_missing_ip', expect.any(String));
  });
});

describe('createGeofenceMiddleware', () => {
  const allowed = new Set(['TN']);

  it('passes requests from an allowed country', () => {
    const next = vi.fn();
    const request = fakeRequest({ headers: { 'cf-ipcountry': 'tn' } });

    createGeofenceMiddleware(allowed)(request, asExpressResponse(new FakeResponse()), next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('passes requests with no country header (Cloudflare always sets it in production)', () => {
    const next = vi.fn();

    createGeofenceMiddleware(allowed)(fakeRequest(), asExpressResponse(new FakeResponse()), next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('403s requests from other countries', () => {
    const next = vi.fn();
    const response = new FakeResponse();
    const request = fakeRequest({ headers: { 'cf-ipcountry': 'FR' } });

    createGeofenceMiddleware(allowed)(request, asExpressResponse(response), next);

    expect(response.statusCode).toBe(403);
    expect(response.body).toEqual({ success: false, error: 'Unavailable in your region.' });
    expect(next).not.toHaveBeenCalled();
  });

  it('prefers the edge cf object over the spoofable header', () => {
    const next = vi.fn();
    const response = new FakeResponse();
    // Client claims TN in the header; the authoritative cf object says FR.
    const request = fakeRequest({ headers: { 'cf-ipcountry': 'TN' }, cf: { country: 'FR' } });

    createGeofenceMiddleware(allowed)(request, asExpressResponse(response), next);

    expect(response.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('403s a missing country signal only in strict mode', () => {
    const next = vi.fn();
    const response = new FakeResponse();

    createGeofenceMiddleware(allowed, { strict: true })(fakeRequest(), asExpressResponse(response), next);

    expect(response.statusCode).toBe(403);
    expect(response.body).toEqual({ success: false, error: 'Unavailable in your region.' });
    expect(next).not.toHaveBeenCalled();
  });
});
