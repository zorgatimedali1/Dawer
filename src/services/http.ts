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
  let response: Response;
  let text: string;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    text = await response.text();
  } catch {
    // Network-level failure (offline, DNS, connection reset): surface the
    // translated fallback instead of a raw "Failed to fetch" TypeError.
    throw new Error(fallbackError);
  }

  let result: T & { message?: string; error?: string };
  try {
    result = (text ? JSON.parse(text) : {}) as T & { message?: string; error?: string };
  } catch {
    // An intermediate proxy returned an HTML error page (502/522/…): the
    // envelope is unparseable, so report the status, not a JSON SyntaxError.
    console.error(`apiRequest: non-JSON ${response.status} body from ${method} ${path}`);
    throw new Error(response.ok ? fallbackError : 'The server returned an error.');
  }

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
