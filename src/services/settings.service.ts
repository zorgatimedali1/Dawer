import { apiRequest } from './http';
import type { WheelTheme } from '@/lib/wheel-theme';

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  return btoa(binary);
}


export interface NotificationPreferences {
  email: boolean;
  sms: boolean;
  push: boolean;
}

export interface BusinessSettings {
  name: string;
  description: string;
  website: string;
  phone: string;
  email: string;
  address: string;
  timezone: string;
  logo: string;
  googleMapsName: string;
  googleMapsUrl: string;
  googlePlaceId: string;
  facebookUrl: string;
  instagramUrl: string;
  twitterUrl: string;
  linkedinUrl: string;
  tiktokUrl: string;
  youtubeUrl: string;
  xUrl?: string;
  notifications: NotificationPreferences;
}

export interface SettingsPatch {
  name?: string;
  description?: string;
  website?: string;
  phone?: string;
  email?: string;
  address?: string;
  timezone?: string;
  logo?: string;
  googleMapsName?: string;
  googleMapsUrl?: string;
  googlePlaceId?: string;
  facebookUrl?: string;
  instagramUrl?: string;
  twitterUrl?: string;
  linkedinUrl?: string;
  tiktokUrl?: string;
  youtubeUrl?: string;
  xUrl?: string;
  notifications?: Partial<NotificationPreferences>;
}

export interface ProfileBusiness {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export interface Profile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string;
  emailVerified: boolean;
  hasPassword: boolean;
  createdAt: string;
  businesses: ProfileBusiness[];
}

/** Response of `GET /api/settings/wheel-theme`. */
export interface WheelThemeState {
  success: boolean;
  /** Plan flag: colors/motion edits (and the merchant theme on the wheel). */
  designAllowed: boolean;
  /** Plan flag: the merchant logo at the wheel hub. */
  centerLogoAllowed: boolean;
  /** Plan flag: the gate step colour (badges + CTA buttons). */
  stepsColorAllowed: boolean;
  planSlug: string;
  planName: string;
  theme: WheelTheme | null;
  override: WheelTheme | null;
  effective: WheelTheme;
  centerLogo: string;
}

export class SettingsService {
  static async getProfile(): Promise<Profile> {
    const result = await apiRequest<{ success: boolean; profile: Profile }>(
      'GET',
      '/api/profile',
      undefined,
      'Unable to load your profile.',
    );
    return result.profile;
  }

  static async updateProfile(changes: { firstName?: string; lastName?: string }): Promise<Profile> {
    const result = await apiRequest<{ success: boolean; profile: Profile }>(
      'PUT',
      '/api/profile',
      changes,
      'Unable to update your profile.',
    );
    return result.profile;
  }

  static async changePassword(currentPassword: string, newPassword: string): Promise<string> {
    const result = await apiRequest<{ success: boolean; message: string }>(
      'POST',
      '/api/profile/password',
      { currentPassword, newPassword },
      'Unable to update your password.',
    );
    return result.message;
  }

  static async getSettings(): Promise<BusinessSettings> {
    const result = await apiRequest<{ success: boolean; settings: BusinessSettings }>(
      'GET',
      '/api/settings',
      undefined,
      'Unable to load settings.',
    );
    return result.settings;
  }

static async updateSettings(changes: SettingsPatch): Promise<BusinessSettings> {
    const result = await apiRequest<{ success: boolean; settings: BusinessSettings }>(
      'PUT',
      '/api/settings',
      changes,
      'Unable to save settings.',
    );
    return result.settings;
  }

  static async uploadLogo(file: File): Promise<string> {
    const dataBase64 = await fileToBase64(file);
    const result = await apiRequest<{ success: boolean; logo: string }>(
      'POST',
      '/api/settings/logo',
      { mimeType: file.type, dataBase64 },
      'Unable to upload the logo.',
    );

    return result.logo;
  }

  static async deleteLogo(): Promise<string> {
    const result = await apiRequest<{ success: boolean; logo: string }>(
      'DELETE',
      '/api/settings/logo',
      undefined,
      'Unable to remove the logo.',
    );

    return result.logo;
  }

  static async getWheelTheme(): Promise<WheelThemeState> {
    return apiRequest<WheelThemeState>(
      'GET',
      '/api/settings/wheel-theme',
      undefined,
      'Unable to load the wheel design.',
    );
  }

  static async saveWheelTheme(theme: WheelTheme): Promise<WheelTheme> {
    const result = await apiRequest<{ success: boolean; theme: WheelTheme }>(
      'PUT',
      '/api/settings/wheel-theme',
      theme,
      'Unable to save the wheel design.',
    );
    return result.theme;
  }

  static async uploadWheelLogo(file: File): Promise<string> {
    const dataBase64 = await fileToBase64(file);
    const result = await apiRequest<{ success: boolean; logo: string }>(
      'POST',
      '/api/settings/wheel-logo',
      { mimeType: file.type, dataBase64 },
      'Unable to upload the wheel logo.',
    );

    return result.logo;
  }

  static async deleteWheelLogo(): Promise<{ success: boolean }> {
    return apiRequest<{ success: boolean }>(
      'DELETE',
      '/api/settings/wheel-logo',
      undefined,
      'Unable to remove the wheel logo.',
    );
  }
}
