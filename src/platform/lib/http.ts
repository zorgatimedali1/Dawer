import { buildQuery } from '@/services/http';

type ErrorBody = {
  message?: string;
  error?: string;
  details?: { fieldErrors?: Record<string, string[] | undefined> };
};

function firstFieldError(details: ErrorBody['details']): string | undefined {
  const entries = Object.values(details?.fieldErrors ?? {});
  for (const list of entries) {
    const first = list?.[0];
    if (first) return first;
  }
  return undefined;
}

/**
 * Same-origin `/api` fetch for the platform Worker. The operator session lives
 * in an HttpOnly cookie, so there is no bearer header and nothing to persist.
 */
export async function apiRequest<T>(
  method: 'GET' | 'PUT' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  fallbackError = 'Unable to reach the server.',
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const text = await response.text();
  let result: T & ErrorBody;
  if (text) {
    try {
      result = JSON.parse(text) as T & ErrorBody;
    } catch {
      // Non-JSON body (edge HTML, plain-text proxy error) — fall back to the
      // status-appropriate message instead of surfacing a raw parse error.
      if (!response.ok) {
        if (response.status === 401) window.dispatchEvent(new Event('platform-session-expired'));
        throw new Error(fallbackError);
      }
      result = {} as T & ErrorBody;
    }
  } else {
    result = {} as T & ErrorBody;
  }

  if (!response.ok) {
    // Session gone: flip the operator context to anonymous so RequireOperator
    // redirects to login instead of leaving a stuck "authenticated" console.
    if (response.status === 401) window.dispatchEvent(new Event('platform-session-expired'));
    throw new Error(firstFieldError(result.details) ?? result.message ?? result.error ?? fallbackError);
  }

  return result;
}

export { buildQuery };
