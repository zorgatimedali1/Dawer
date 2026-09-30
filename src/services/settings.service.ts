import { apiRequest } from './http';

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
  primaryColor: string;
  secondaryColor: string;
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
  primaryColor?: string;
  secondaryColor?: string;
  notifications?: NotificationPreferences;
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
  createdAt: string;
  businesses: ProfileBusiness[];
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
}
