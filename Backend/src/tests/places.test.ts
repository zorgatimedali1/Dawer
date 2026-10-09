import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handlePlacesAutocomplete } from '../routes/places';
import { createTestEnv, type TestEnv } from './helpers/d1';
import { bearer, seedMerchant } from './helpers/fixtures';
import type { Env } from '../types';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Google Places autocomplete', () => {
  let testEnv: TestEnv;
  let authHeader: Record<string, string>;

  beforeEach(async () => {
    testEnv = createTestEnv();
    const merchant = await seedMerchant(testEnv.DB);
    authHeader = bearer(merchant.token);
  });

  it('rejects unauthenticated callers before touching the Places key', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await handlePlacesAutocomplete(
      new Request('https://campaignflow.test/api/places/autocomplete?input=Splash%20Food'),
      { ...testEnv, GOOGLE_MAPS_API_KEY: 'test-key' } as unknown as Env,
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires a server-side API key', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await handlePlacesAutocomplete(
      new Request('https://campaignflow.test/api/places/autocomplete?input=Splash%20Food', {
        headers: authHeader,
      }),
      testEnv as unknown as Env,
    );

    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('restricts predictions to Tunisia and returns place IDs for selection', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      suggestions: [
        {
          placePrediction: {
            placeId: 'tn-place-123',
            text: { text: 'Splash Food, Tunis, Tunisia' },
            structuredFormat: {
              mainText: { text: 'Splash Food' },
              secondaryText: { text: 'Tunis, Tunisia' },
            },
          },
        },
        { queryPrediction: { text: { text: 'ignored non-place result' } } },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await handlePlacesAutocomplete(
      new Request('https://campaignflow.test/api/places/autocomplete?input=Splash%20Food', {
        headers: authHeader,
      }),
      { ...testEnv, GOOGLE_MAPS_API_KEY: 'test-key' } as unknown as Env,
    );
    const body = await response.json() as {
      success: boolean;
      suggestions: Array<{ placeId: string; label: string; mainText: string; secondaryText: string }>;
    };
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      input: 'Splash Food',
      includedRegionCodes: ['tn'],
      languageCode: 'fr',
    });
    expect(body.suggestions).toEqual([{
      placeId: 'tn-place-123',
      label: 'Splash Food, Tunis, Tunisia',
      mainText: 'Splash Food',
      secondaryText: 'Tunis, Tunisia',
    }]);
  });
});
