type Coordinates = { latitude: number; longitude: number };

/**
 * Resolves a Google place ID to coordinates (Places Details, `location` field
 * only). Returns null whenever the key is missing, the call fails or the
 * place has no location — the proximity signal degrades to "unknown", never
 * to a blocked save (P2-7).
 */
export async function fetchPlaceCoordinates(
  placeId: string,
  apiKey: string | undefined,
): Promise<Coordinates | null> {
  if (!placeId || !apiKey) return null;

  try {
    const response = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      headers: {
        'x-goog-api-key': apiKey,
        'x-goog-fieldmask': 'location',
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as { location?: { latitude?: unknown; longitude?: unknown } };
    const { latitude, longitude } = data.location ?? {};

    if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

    return { latitude, longitude };
  } catch {
    return null;
  }
}
