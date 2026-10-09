const googleMapsHosts = new Set([
  'google.com',
  'www.google.com',
  'maps.google.com',
  'maps.app.goo.gl',
  'goo.gl',
  'g.page',
  'search.google.com',
]);

function parseGoogleUrl(value: string): URL | null {
  if (!/^https?:\/\//i.test(value)) return null;

  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && googleMapsHosts.has(url.hostname.toLowerCase())) {
      return url;
    }
  } catch {
    // Treat invalid URLs as a store-name search.
  }

  return null;
}

function isReviewLink(url: URL): boolean {
  return /(^|\/)(review|writereview)(\/|$)/i.test(url.pathname);
}

export function getGoogleMapsUrl(storeNameOrUrl: string, placeId?: string): string {
  const value = storeNameOrUrl.trim();
  const googleUrl = parseGoogleUrl(value);

  if (googleUrl) return googleUrl.toString();

  const url = new URL('https://www.google.com/maps/search/');
  url.searchParams.set('api', '1');
  url.searchParams.set('query', value);
  if (placeId) url.searchParams.set('query_place_id', placeId);
  return url.toString();
}

/**
 * Deep link straight into Google's "write a review" dialog.
 *
 * Order of preference: an explicit review short link the merchant saved,
 * then the place id (Google's own write-review endpoint), then the place URL,
 * and finally a plain Google search — the knowledge panel that result opens
 * carries the review button.
 */
export function getGoogleReviewUrl(storeNameOrUrl: string, placeId?: string): string {
  const value = storeNameOrUrl.trim();
  const googleUrl = parseGoogleUrl(value);

  if (googleUrl && isReviewLink(googleUrl)) return googleUrl.toString();

  const place = placeId?.trim();
  if (place) {
    return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(place)}`;
  }

  if (googleUrl) return googleUrl.toString();

  const url = new URL('https://www.google.com/search');
  url.searchParams.set('q', value);
  return url.toString();
}