export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  businessName: string;
}

export interface AuthResponse {
  token: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: 'merchant' | 'admin';
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

  static async logout(token: string): Promise<void> {
    await this.request<void>('/auth/logout', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
  }

  static googleSignInUrl(): string {
    return `${this.API_URL}/auth/google`;
  }

  static async forgotPassword(email: string): Promise<{ success: boolean }> {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({ success: true });
      }, 500);
    });
  }

  static async resetPassword(token: string, password: string): Promise<{ success: boolean }> {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({ success: true });
      }, 500);
    });
  }
}
