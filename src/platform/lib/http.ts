import { buildQuery } from '@/services/http';

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
  const result = (text ? JSON.parse(text) : {}) as T & { message?: string; error?: string };

  if (!response.ok) {
    throw new Error(result.message ?? result.error ?? fallbackError);
  }

  return result;
}

export { buildQuery };
