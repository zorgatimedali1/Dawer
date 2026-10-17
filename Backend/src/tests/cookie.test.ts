import { describe, expect, it } from 'vitest';
import { readCookie } from '../lib/cookie';

function requestWithCookie(header: string | null): Request {
  return new Request('https://example.test/', {
    headers: header === null ? {} : { cookie: header },
  });
}

describe('readCookie', () => {
  it('returns the decoded value of a well-formed cookie', () => {
    expect(readCookie(requestWithCookie('cf_session=abc.def%2Fghi'), 'cf_session')).toBe('abc.def/ghi');
  });

  it('returns null for a malformed percent-escape instead of throwing (M4)', () => {
    // A stray '%' used to crash the route with an uncaught URIError.
    expect(readCookie(requestWithCookie('cf_spin_visitor=dead%beef'), 'cf_spin_visitor')).toBeNull();
  });

  it('returns null when the cookie header is missing', () => {
    expect(readCookie(requestWithCookie(null), 'cf_session')).toBeNull();
  });

  it('returns null when the named cookie is absent', () => {
    expect(readCookie(requestWithCookie('other=value'), 'cf_session')).toBeNull();
  });

  it('picks the right cookie out of a multi-cookie header', () => {
    const request = requestWithCookie('a=1; cf_session=token; b=2');
    expect(readCookie(request, 'cf_session')).toBe('token');
  });
});
