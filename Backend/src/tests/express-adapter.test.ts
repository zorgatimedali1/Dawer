import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { createWorkerRoute } from '../lib/express-adapter';
import type { Env } from '../types';

/** Minimal stand-ins for the Express objects the adapter actually touches. */
function fakeRequest(overrides: Partial<ExpressRequest> = {}): ExpressRequest {
  return {
    headers: {},
    method: 'GET',
    body: undefined,
    originalUrl: '/api/auth/google/callback?code=x&state=y',
    get: (name: string) => (name.toLowerCase() === 'host' ? 'example.test' : undefined),
    ...overrides,
  } as unknown as ExpressRequest;
}

class FakeResponse {
  readonly headers = new Map<string, string[]>();

  statusCode = 200;

  setHeader(name: string, value: string | string[]): void {
    this.headers.set(name.toLowerCase(), Array.isArray(value) ? value : [value]);
  }

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  send(body: string | Buffer): this {
    this.body = body;
    return this;
  }

  body: string | Buffer = '';

  get(name: string): string[] | undefined {
    return this.headers.get(name.toLowerCase());
  }
}

function asExpressResponse(response: FakeResponse): ExpressResponse {
  return response as unknown as ExpressResponse;
}

function sentBody(response: FakeResponse): Buffer {
  const body = response.body;
  return typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('express adapter response marshalling', () => {
  it('keeps every Set-Cookie instead of letting the last one overwrite the rest', async () => {
    const handler = createWorkerRoute(
      async () => {
        const response = new Response(null, { status: 302, headers: { location: '/auth/callback' } });
        response.headers.append('set-cookie', 'cf_session=abc; Path=/; HttpOnly; Max-Age=60');
        response.headers.append('set-cookie', 'cf_oauth_state=; Path=/; HttpOnly; Max-Age=0');
        return response;
      },
      {} as Env,
    );

    const expressResponse = new FakeResponse();
    await handler(fakeRequest(), asExpressResponse(expressResponse), (error) => {
      throw error;
    });

    expect(expressResponse.statusCode).toBe(302);
    expect(expressResponse.get('location')).toEqual(['/auth/callback']);
    expect(expressResponse.get('set-cookie')).toEqual([
      'cf_session=abc; Path=/; HttpOnly; Max-Age=60',
      'cf_oauth_state=; Path=/; HttpOnly; Max-Age=0',
    ]);
  });

  it('does not emit an empty set-cookie header when the response has none', async () => {
    const handler = createWorkerRoute(
      async () => Response.json({ success: true }),
      {} as Env,
    );

    const expressResponse = new FakeResponse();
    await handler(fakeRequest({ originalUrl: '/api/auth/session' }), asExpressResponse(expressResponse), (error) => {
      throw error;
    });

    expect(expressResponse.headers.has('set-cookie')).toBe(false);
    expect(sentBody(expressResponse)).toEqual(Buffer.from('{"success":true}', 'utf8'));
  });

  it('passes binary bodies through unchanged on cache MISS and HIT', async () => {
    // High bytes that a UTF-8 text round-trip would turn into U+FFFD
    // (EF BF BD) — the exact corruption that broke the company logo.
    const payload = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0xff, 0x80, 0x00, 0x7f, 0xc3, 0x28, 0xe2, 0x82, 0xac]);
    const handler = createWorkerRoute(
      async () =>
        new Response(payload, {
          headers: { 'content-type': 'image/webp', 'cache-control': 'public, max-age=300' },
        }),
      {} as Env,
      { cacheTtlSeconds: 30 },
    );

    const store = new Map<string, Response>();
    vi.stubGlobal('caches', {
      default: {
        match: async (request: Request) => store.get(request.url)?.clone(),
        put: async (request: Request, response: Response) => {
          store.set(request.url, response.clone());
        },
      },
    });

    const miss = new FakeResponse();
    await handler(
      fakeRequest({ originalUrl: '/api/public/businesses/biz-1/logo' }),
      asExpressResponse(miss),
      (error) => {
        throw error;
      },
    );
    expect(miss.statusCode).toBe(200);
    expect(miss.get('x-cache')).toEqual(['MISS']);
    expect(sentBody(miss)).toEqual(Buffer.from(payload));
    expect(sentBody(miss).includes(Buffer.from([0xef, 0xbf, 0xbd]))).toBe(false);

    const hit = new FakeResponse();
    await handler(
      fakeRequest({ originalUrl: '/api/public/businesses/biz-1/logo' }),
      asExpressResponse(hit),
      (error) => {
        throw error;
      },
    );
    expect(hit.get('x-cache')).toEqual(['HIT']);
    expect(sentBody(hit)).toEqual(Buffer.from(payload));
  });

  it('does not cache a route response that sets Cache-Control: no-store', async () => {
    const handler = createWorkerRoute(
      async () =>
        new Response(JSON.stringify({ success: true }), {
          headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
        }),
      {} as Env,
      { cacheTtlSeconds: 30 },
    );

    const store = new Map<string, Response>();
    vi.stubGlobal('caches', {
      default: {
        match: async (request: Request) => store.get(request.url)?.clone(),
        put: async (request: Request, response: Response) => {
          store.set(request.url, response.clone());
        },
      },
    });

    const miss = new FakeResponse();
    await handler(
      fakeRequest({ originalUrl: '/api/public/campaigns/ABC123' }),
      asExpressResponse(miss),
      (error) => {
        throw error;
      },
    );
    expect(miss.get('cache-control')).toEqual(['no-store']);
    // The no-store response must never reach the Cache API.
    expect(store.size).toBe(0);

    const second = new FakeResponse();
    await handler(
      fakeRequest({ originalUrl: '/api/public/campaigns/ABC123' }),
      asExpressResponse(second),
      (error) => {
        throw error;
      },
    );
    // Still a MISS — nothing was stored on the first pass.
    expect(second.get('x-cache')).toEqual(['MISS']);
    expect(second.get('cache-control')).toEqual(['no-store']);
  });
});
