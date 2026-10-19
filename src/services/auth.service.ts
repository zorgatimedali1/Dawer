export interface LoginCredentials {
  email: string;
  password: string;
  /** Single-use Turnstile token; sent whenever a widget is rendered. */
  turnstileToken?: string | undefined;
}

export interface RegisterData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  businessName: string;
}

/**
 * The session token is an HttpOnly cookie set by the backend; this body only
 * ever carries the profile the SPA may cache for route guards (P1-1).
 */
export interface AuthResponse {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: 'merchant';
  };
}

export class AuthService {
  private static readonly API_URL = import.meta.env.VITE_API_URL ?? '/api';

  private static async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.API_URL}${path}`, init);
    const text = await response.text();
    const result = (text ? JSON.parse(text) : {}) as T & { message?: string; error?: string; details?: unknown };

    if (!response.ok) {
      throw new Error(result.message ?? result.error ?? 'The request failed.');
    }

    return result;
  }

  private static async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  static async login(credentials: LoginCredentials): Promise<AuthResponse> {
    return this.post<AuthResponse>('/auth/login', credentials);
  }

  static async register(data: RegisterData): Promise<AuthResponse> {
    return this.post<AuthResponse>('/auth/register', data);
  }

  static async logout(): Promise<void> {
    // Cookie-based: the server revokes the session the HttpOnly cookie points
    // at and expires the cookie itself.
    await this.request<void>('/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
    });
  }

  static googleSignInUrl(): string {
    return `${this.API_URL}/auth/google`;
  }

  /**
   * The OAuth handoff parks the session in an HttpOnly cookie and redirects to
   * `/auth/callback`; this fetches the profile that cookie belongs to.
   */
  static async sessionFromCookie(): Promise<AuthResponse> {
    return this.request<AuthResponse>('/auth/session', { method: 'GET', credentials: 'same-origin' });
  }

  /**
   * Revalidates the HttpOnly session cookie against the server on app bootstrap.
   * Returns the fresh profile, `null` when the session is gone (401 — expired or
   * revoked), and throws on network failures so callers keep their cached state.
   */
  static async revalidateSession(): Promise<AuthResponse | null> {
    const response = await fetch(`${this.API_URL}/auth/session`, {
      method: 'GET',
      credentials: 'same-origin',
    });
    if (response.status === 401) return null;

    const text = await response.text();
    const result = (text ? JSON.parse(text) : {}) as AuthResponse & { message?: string; error?: string };
    if (!response.ok) {
      throw new Error(result.message ?? result.error ?? 'The request failed.');
    }
    return result;
  }

  /**
   * POST /api/auth/forgot-password — the backend always answers success for
   * unknown emails (no account enumeration), so this resolves for any input
   * the server accepted.
   */
  static async forgotPassword(email: string): Promise<{ success: boolean; message?: string }> {
    return this.post<{ success: boolean; message?: string }>('/auth/forgot-password', { email });
  }

  /** Redeems the single-use token from the emailed reset link. */
  static async resetPassword(token: string, password: string): Promise<{ success: boolean; message?: string }> {
    return this.post<{ success: boolean; message?: string }>('/auth/reset-password', { token, password });
  }
}
