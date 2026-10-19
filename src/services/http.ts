export const AUTH_STORAGE_KEY = 'campaign-engage-auth';

/**
 * The Worker's rate limiter answers 429 with a `Retry-After` header (60s).
 * Retrying once would block the UI for up to a minute with no feedback, so
 * the client waits at most a few seconds: short `Retry-After` windows are
 * smoothed out automatically, long ones surface the message on the first
 * retry instead of the initial burst.
 */
const MAX_429_WAIT_SECONDS = 5;

function retry429DelayMs(response: Response): number {
  const retryAfter = Number(response.headers.get('retry-after') ?? 0);
  const seconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 1;
  return Math.min(MAX_429_WAIT_SECONDS, Math.max(1, seconds)) * 1000;
}

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
  const send = async (): Promise<{ response: Response; text: string; result: (T & { message?: string; error?: string }) | null }> => {
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

    if (response.status === 429) {
      // Handled by the retry loop in apiRequest.
      return { response, text, result: null };
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

    return { response, text, result };
  };

  let attempt = await send();
  if (attempt.response.status === 429) {
    // Refused before anything was processed — one polite retry is safe.
    await new Promise((resolve) => setTimeout(resolve, retry429DelayMs(attempt.response)));
    attempt = await send();
    if (attempt.response.status === 429) {
      throw new Error('Too many requests. Please slow down and try again.');
    }
  }

  const { response, result } = attempt;
  if (result === null) {
    // Unreachable: `result` is only null on a 429, and both 429 outcomes above
    // either retried (non-429 result) or threw.
    throw new Error('The server returned an error.');
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
