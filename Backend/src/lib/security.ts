/**
 * Login-CSRF helpers shared by the merchant and platform auth routes.
 *
 * Browsers attach `Origin` to cross-origin POSTs (and most same-origin ones);
 * server-to-server callers (curl, webhook providers) send none. A missing
 * header therefore passes — those clients hold no victim cookie jar, and the
 * SameSite=Lax session cookie covers the browser case anyway.
 */
export function isCrossSitePost(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  if (origin === 'null') return true;
  try {
    return new URL(origin).host !== new URL(request.url).host;
  } catch {
    return true;
  }
}
