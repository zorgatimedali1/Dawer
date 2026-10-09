import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '@/services/auth.service';

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('auth service password reset', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('posts the email to the forgot-password endpoint', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ success: true, message: 'sent' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await AuthService.forgotPassword('ada@example.test');

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('/api/auth/forgot-password');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ email: 'ada@example.test' });
  });

  it('posts the token and new password to the reset-password endpoint', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ success: true }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await AuthService.resetPassword('cfr_abc123', 'NewPass123!');

    expect(result.success).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('/api/auth/reset-password');
    expect(JSON.parse(String(init?.body))).toEqual({
      token: 'cfr_abc123',
      password: 'NewPass123!',
    });
  });

  it('throws the server message on rejection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ success: false, message: 'Unable to send the reset email right now.' }, 503),
      ),
    );

    await expect(AuthService.forgotPassword('ada@example.test')).rejects.toThrow(
      'Unable to send the reset email right now.',
    );
  });
});
