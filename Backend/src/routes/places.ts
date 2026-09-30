import { jsonResponse } from '../lib/http';
import type { Env } from '../types';

interface GooglePlacePrediction {
  placeId?: string;
  text?: { text?: string };
  structuredFormat?: {
    mainText?: { text?: string };
    secondaryText?: { text?: string };
  };
}

interface GoogleAutocompleteResponse {
  suggestions?: Array<{ placePrediction?: GooglePlacePrediction }>;
}

export async function handlePlacesAutocomplete(request: Request, env: Env): Promise<Response> {
  const input = new URL(request.url).searchParams.get('input')?.trim() ?? '';

  if (input.length < 3 || input.length > 120) {
    return jsonResponse({ success: false, error: 'Enter between 3 and 120 characters.' }, 400);
  }

  const apiKey = (env as Env & { GOOGLE_MAPS_API_KEY?: string }).GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return jsonResponse({ success: false, error: 'Google place suggestions are not configured.' }, 503);
  }

  try {
    const response = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
        'x-goog-fieldmask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat.mainText.text,suggestions.placePrediction.structuredFormat.secondaryText.text',
      },
      body: JSON.stringify({
        input,
        includedRegionCodes: ['tn'],
        languageCode: 'fr',
        regionCode: 'tn',
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.error('Google Places autocomplete request failed.', response.status);
      return jsonResponse({ success: false, error: 'Google place suggestions are temporarily unavailable.' }, 502);
    }

    const result = await response.json() as GoogleAutocompleteResponse;
    const suggestions = (result.suggestions ?? []).flatMap(({ placePrediction }) => {
      if (!placePrediction?.placeId || !placePrediction.text?.text) return [];

      return [{
        placeId: placePrediction.placeId,
        label: placePrediction.text.text,
        mainText: placePrediction.structuredFormat?.mainText?.text ?? placePrediction.text.text,
        secondaryText: placePrediction.structuredFormat?.secondaryText?.text ?? '',
      }];
    });

    const resultResponse = jsonResponse({ success: true, suggestions });
    resultResponse.headers.set('Cache-Control', 'no-store');
    return resultResponse;
  } catch (error) {
    console.error('Google Places autocomplete request failed.', error);
    return jsonResponse({ success: false, error: 'Google place suggestions are temporarily unavailable.' }, 502);
  }
}