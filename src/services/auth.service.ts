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

  private static async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.API_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await response.json() as T & { error?: string };

    if (!response.ok) {
      throw new Error(result.error ?? 'The request failed.');
    }

    return result;
  }

  static async login(credentials: LoginCredentials): Promise<AuthResponse> {
    return this.post<AuthResponse>('/auth/login', credentials);
  }

  static async register(data: RegisterData): Promise<AuthResponse> {
    return this.post<AuthResponse>('/auth/register', data);
  }

  static async logout(token: string): Promise<void> {
    const response = await fetch(`${this.API_URL}/auth/logout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error('Unable to end the session.');
    }
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
