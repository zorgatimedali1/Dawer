import { describe, expect, it } from 'vitest';
import { getGoogleMapsUrl, getGoogleReviewUrl } from '@/lib/google-maps';

describe('getGoogleMapsUrl', () => {
  it('passes through allowed https Google hostnames', () => {
    expect(getGoogleMapsUrl('https://www.google.com/maps/place/Cafe+du+Centre')).toBe(
      'https://www.google.com/maps/place/Cafe+du+Centre',
    );
    expect(getGoogleMapsUrl('https://g.page/r/abc/review')).toBe('https://g.page/r/abc/review');
  });

  it('rejects non-Google hostnames and falls back to a search URL', () => {
    expect(getGoogleMapsUrl('https://evil.example.com/maps')).toBe(
      'https://www.google.com/maps/search/?api=1&query=https%3A%2F%2Fevil.example.com%2Fmaps',
    );
  });

  it('rejects insecure http Google hostnames', () => {
    expect(getGoogleMapsUrl('http://www.google.com/maps')).toBe(
      'https://www.google.com/maps/search/?api=1&query=http%3A%2F%2Fwww.google.com%2Fmaps',
    );
  });

  it('builds a search URL from a plain store name', () => {
    expect(getGoogleMapsUrl('Café du Centre')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Caf%C3%A9+du+Centre',
    );
  });

  it('appends query_place_id when a place id is provided', () => {
    expect(getGoogleMapsUrl('Cafe du Centre', 'ChIJN1t_tDeuEmsRUsoyG83frY4')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Cafe+du+Centre&query_place_id=ChIJN1t_tDeuEmsRUsoyG83frY4',
    );
  });
});

describe('getGoogleReviewUrl', () => {
  it('opens the write-review dialog directly when a place id is known', () => {
    expect(getGoogleReviewUrl('Carrefour market Chotana', 'ChIJN1t_tDeuEmsRUsoyG83frY4')).toBe(
      'https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4',
    );
  });

  it('prefers an explicit review short link over the place id', () => {
    expect(getGoogleReviewUrl('https://g.page/r/abc/review', 'ChIJN1t_tDeuEmsRUsoyG83frY4')).toBe(
      'https://g.page/r/abc/review',
    );
  });

  it('falls back to a Google search that shows the knowledge panel', () => {
    expect(getGoogleReviewUrl('Carrefour market Chotana, Al Hayat')).toBe(
      'https://www.google.com/search?q=Carrefour+market+Chotana%2C+Al+Hayat',
    );
  });

  it('passes through a Google place URL when there is no place id', () => {
    expect(getGoogleReviewUrl('https://www.google.com/maps/place/Cafe+du+Centre')).toBe(
      'https://www.google.com/maps/place/Cafe+du+Centre',
    );
  });

  it('never sends visitors to a non-Google host', () => {
    expect(getGoogleReviewUrl('https://evil.example.com/review')).toBe(
      'https://www.google.com/search?q=https%3A%2F%2Fevil.example.com%2Freview',
    );
  });
});
