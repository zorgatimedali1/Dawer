export const AUTH_STORAGE_KEY = 'campaign-engage-auth';

export function getSessionToken(): string {
  const session = window.localStorage.getItem(AUTH_STORAGE_KEY);
  if (!session) throw new Error('Sign in to continue.');

  try {
    const token = (JSON.parse(session) as { token?: unknown }).token;
    if (typeof token === 'string' && token) return token;
  } catch {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
  }

  throw new Error('Your session has expired. Sign in again.');
}

/**
 * Same-origin `/api` fetch that carries the bearer session and unwraps the
 * standard `{ success, message, error }` envelope.
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
      authorization: `Bearer ${getSessionToken()}`,
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

export function buildQuery(params: Record<string, string | number | undefined | null>): string {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    query.set(key, String(value));
  }

  const encoded = query.toString();
  return encoded ? `?${encoded}` : '';
}
