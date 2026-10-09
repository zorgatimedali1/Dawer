import { apiRequest } from './http';

export interface WhatsAppWebGateway {
  configured: boolean;
  reachable: boolean;
  state: string | null;
  /** Pairing QR as a data URL while the gateway is waiting to be linked. */
  qr?: string | null;
  /** Deep link to the gateway's pairing page (contains the gateway secret). */
  pairUrl?: string | null;
}

export interface WhatsAppWebStatus {
  allowed: boolean;
  /** Platform/account kill switch; false means the operator disabled the channel. */
  enabled?: boolean;
  planSlug: string;
  planName: string;
  monthlyLimit: number;
  batchLimit: number;
  sentThisMonth: number;
  remaining: number;
  gateway: WhatsAppWebGateway;
}

export type WhatsAppWebCampaignStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface WhatsAppWebCampaign {
  id: string;
  totalRecipients: number;
  sent: number;
  failed: number;
  status: WhatsAppWebCampaignStatus;
  message: string;
  lastError?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface WhatsAppWebWinner {
  id: string;
  name: string | null;
  phone: string;
  prize: string | null;
  campaign: string;
  wonAt: string;
}

export interface WhatsAppWebRecipient {
  name?: string;
  phone: string;
  prize?: string;
}

export interface WhatsAppWebBroadcastInput {
  recipients: WhatsAppWebRecipient[];
  message?: string;
}

export class WhatsAppWebService {
  static async status(): Promise<WhatsAppWebStatus> {
    const result = await apiRequest<{ success: boolean; status: WhatsAppWebStatus }>(
      'GET',
      '/api/whatsapp-web/status',
      undefined,
      'Unable to load WhatsApp Web status.',
    );
    return result.status;
  }

  static async winners(): Promise<WhatsAppWebWinner[]> {
    const result = await apiRequest<{ success: boolean; winners?: WhatsAppWebWinner[] }>(
      'GET',
      '/api/whatsapp-web/winners',
      undefined,
      'Unable to load winners.',
    );
    return result.winners ?? [];
  }

  static async list(): Promise<WhatsAppWebCampaign[]> {
    const result = await apiRequest<{ success: boolean; campaigns?: WhatsAppWebCampaign[] }>(
      'GET',
      '/api/whatsapp-web/broadcast',
      undefined,
      'Unable to load broadcasts.',
    );
    return result.campaigns ?? [];
  }

  static async get(campaignId: string): Promise<WhatsAppWebCampaign> {
    const result = await apiRequest<{ success: boolean; campaign: WhatsAppWebCampaign }>(
      'GET',
      `/api/whatsapp-web/campaigns/${encodeURIComponent(campaignId)}`,
      undefined,
      'Unable to load the broadcast.',
    );
    return result.campaign;
  }

  static async create(input: WhatsAppWebBroadcastInput): Promise<WhatsAppWebCampaign> {
    const result = await apiRequest<{ success: boolean; campaign: WhatsAppWebCampaign }>(
      'POST',
      '/api/whatsapp-web/broadcast',
      input,
      'Unable to start the broadcast.',
    );
    return result.campaign;
  }

  static async cancel(campaignId: string): Promise<WhatsAppWebCampaign | null> {
    const result = await apiRequest<{ success: boolean; campaign?: WhatsAppWebCampaign | null }>(
      'POST',
      `/api/whatsapp-web/campaigns/${encodeURIComponent(campaignId)}/cancel`,
      undefined,
      'Unable to cancel the broadcast.',
    );
    return result.campaign ?? null;
  }

  static async resume(campaignId: string): Promise<WhatsAppWebCampaign | null> {
    const result = await apiRequest<{ success: boolean; campaign?: WhatsAppWebCampaign | null }>(
      'POST',
      `/api/whatsapp-web/campaigns/${encodeURIComponent(campaignId)}/resume`,
      undefined,
      'Unable to resume the broadcast.',
    );
    return result.campaign ?? null;
  }
}
