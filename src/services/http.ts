export const AUTH_STORAGE_KEY = 'campaign-engage-auth';

/**
 * Same-origin `/api` fetch that authenticates through the HttpOnly session
 * cookie (JavaScript never sees a token, P1-1) and unwraps the standard
 * `{ success, message, error }` envelope.
 */
export async function apiRequest<T>(
  method: 'GET' | 'PUT' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  fallbackError = 'Unable to reach the server.',
): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const text = await response.text();
  const result = (text ? JSON.parse(text) : {}) as T & { message?: string; error?: string };

  if (!response.ok) {
    if (response.status === 401) {
      // The session cookie is gone or expired: drop the cached user so route
      // guards bounce to sign-in on the next render, and tell the AppProvider
      // to clear its React state too — localStorage alone leaves `user` stale
      // and the guards never redirect mid-visit.
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
      window.dispatchEvent(new Event('session-expired'));
    }
    throw new Error(result.message ?? result.error ?? fallbackError);
  }

  return result;
}

export function buildQuery(params: Record<string, string | number | undefined | null>): string {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    query.set(key, String(value));
  }

  const encoded = query.toString();
  return encoded ? `?${encoded}` : '';
}
