const googleMapsHosts = new Set([
  'google.com',
  'www.google.com',
  'maps.google.com',
  'maps.app.goo.gl',
  'goo.gl',
  'g.page',
]);

export function getGoogleMapsUrl(storeNameOrUrl: string, placeId?: string): string {
  const value = storeNameOrUrl.trim();

  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' && googleMapsHosts.has(url.hostname.toLowerCase())) {
        return url.toString();
      }
    } catch {
      // Treat invalid URLs as a store-name search.
    }
  }

  const url = new URL('https://www.google.com/maps/search/');
  url.searchParams.set('api', '1');
  url.searchParams.set('query', value);
  if (placeId) url.searchParams.set('query_place_id', placeId);
  return url.toString();
}