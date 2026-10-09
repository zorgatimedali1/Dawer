import { apiRequest } from '@/platform/lib/http';

export interface Operator {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

type SessionEnvelope = { success: boolean; operator: Operator };
type LoginEnvelope = { success: boolean; operator: Operator };

export class PlatformAuthService {
  static async session(): Promise<Operator> {
    const result = await apiRequest<SessionEnvelope>(
      'GET',
      '/api/auth/session',
      undefined,
      'Your session has expired. Sign in again.',
    );
    return result.operator;
  }

  static async login(email: string, password: string): Promise<Operator> {
    const result = await apiRequest<LoginEnvelope>(
      'POST',
      '/api/auth/login',
      { email, password },
      'Unable to log in.',
    );
    return result.operator;
  }

  static async logout(): Promise<void> {
    await apiRequest<{ success: boolean }>('POST', '/api/auth/logout', {}, 'Unable to log out.');
  }

  static async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await apiRequest<{ success: boolean }>(
      'POST',
      '/api/auth/password',
      { currentPassword, newPassword },
      'Unable to update the password.',
    );
  }
}
