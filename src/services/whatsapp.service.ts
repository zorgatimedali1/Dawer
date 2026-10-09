import { apiRequest } from './http';

export interface WhatsAppStatus {
  allowed: boolean;
  /** Platform/account kill switch; false means the operator disabled the channel. */
  enabled?: boolean;
  planSlug: string;
  planName: string;
  monthlyLimit: number;
  batchLimit: number;
  sentThisMonth: number;
  remaining: number;
  configured: boolean;
}

export interface WhatsAppTemplate {
  name: string;
  language: string;
  status: string;
  body?: string;
}

export type WhatsAppPace = 'fast' | 'standard' | 'relaxed';

export type WhatsAppBroadcastStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface WhatsAppBroadcast {
  id: string;
  templateName: string;
  language: string;
  totalRecipients: number;
  sent: number;
  failed: number;
  status: WhatsAppBroadcastStatus;
  lastError?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface WhatsAppBroadcastInput {
  recipients: Array<{ name?: string; phone: string }>;
  templateName: string;
  language: string;
  variables: string[];
  pace: WhatsAppPace;
}

export class WhatsAppService {
  static async status(): Promise<WhatsAppStatus> {
    const result = await apiRequest<{ success: boolean; status: WhatsAppStatus }>(
      'GET',
      '/api/whatsapp/status',
      undefined,
      'Unable to load WhatsApp status.',
    );
    return result.status;
  }

  static async templates(): Promise<WhatsAppTemplate[]> {
    const result = await apiRequest<{ success: boolean; templates?: WhatsAppTemplate[] }>(
      'GET',
      '/api/whatsapp/templates',
      undefined,
      'Unable to load templates.',
    );
    return result.templates ?? [];
  }

  static async list(): Promise<WhatsAppBroadcast[]> {
    const result = await apiRequest<{ success: boolean; campaigns?: WhatsAppBroadcast[] }>(
      'GET',
      '/api/whatsapp/broadcast',
      undefined,
      'Unable to load broadcasts.',
    );
    return result.campaigns ?? [];
  }

  static async get(campaignId: string): Promise<WhatsAppBroadcast> {
    const result = await apiRequest<{ success: boolean; campaign: WhatsAppBroadcast }>(
      'GET',
      `/api/whatsapp/broadcast/${encodeURIComponent(campaignId)}`,
      undefined,
      'Unable to load the broadcast.',
    );
    return result.campaign;
  }

  static async create(input: WhatsAppBroadcastInput): Promise<WhatsAppBroadcast> {
    const result = await apiRequest<{ success: boolean; campaign: WhatsAppBroadcast }>(
      'POST',
      '/api/whatsapp/broadcast',
      input,
      'Unable to start the broadcast.',
    );
    return result.campaign;
  }
}
