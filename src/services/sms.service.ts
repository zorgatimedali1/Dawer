import { apiRequest } from './http';

export type SmsGatewayState = 'ONLINE' | 'OFFLINE' | 'UNKNOWN';

export interface SmsGateway {
  state: SmsGatewayState;
}

export interface SmsStatus {
  allowed: boolean;
  /** Platform/account kill switch; false means the operator disabled the channel. */
  enabled?: boolean;
  planSlug: string | null;
  planName: string | null;
  monthlyLimit: number;
  batchLimit: number;
  sentThisMonth: number;
  remaining: number;
  configured: boolean;
  gateway: SmsGateway;
}

export type SmsCampaignStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface SmsCampaign {
  id: string;
  businessId: string;
  message: string;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  status: SmsCampaignStatus;
  lastError?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface SmsWinner {
  id: string;
  name: string;
  phone: string;
  prize: string;
  campaignId: string;
}

export interface SmsRecipient {
  name?: string;
  phone: string;
}

export interface SmsBroadcastInput {
  message: string;
  recipients: SmsRecipient[];
}

export class SmsService {
  static async status(): Promise<SmsStatus> {
    const result = await apiRequest<{ success: boolean; status: SmsStatus }>(
      'GET',
      '/api/sms/status',
      undefined,
      'Unable to load SMS status.',
    );
    return result.status;
  }

  static async winners(): Promise<SmsWinner[]> {
    const result = await apiRequest<{ success: boolean; winners?: SmsWinner[] }>(
      'GET',
      '/api/sms/winners',
      undefined,
      'Unable to load winners.',
    );
    return result.winners ?? [];
  }

  static async list(): Promise<SmsCampaign[]> {
    const result = await apiRequest<{ success: boolean; campaigns?: SmsCampaign[] }>(
      'GET',
      '/api/sms/broadcast',
      undefined,
      'Unable to load broadcasts.',
    );
    return result.campaigns ?? [];
  }

  static async get(campaignId: string): Promise<SmsCampaign> {
    const result = await apiRequest<{ success: boolean; campaign: SmsCampaign }>(
      'GET',
      `/api/sms/broadcast/${encodeURIComponent(campaignId)}`,
      undefined,
      'Unable to load the broadcast.',
    );
    return result.campaign;
  }

  static async create(input: SmsBroadcastInput): Promise<SmsCampaign> {
    const result = await apiRequest<{ success: boolean; campaign: SmsCampaign }>(
      'POST',
      '/api/sms/broadcast',
      input,
      'Unable to start the broadcast.',
    );
    return result.campaign;
  }

  static async cancel(campaignId: string): Promise<void> {
    await apiRequest<{ success: boolean; ok?: boolean }>(
      'POST',
      `/api/sms/broadcast/${encodeURIComponent(campaignId)}/cancel`,
      undefined,
      'Unable to cancel the broadcast.',
    );
  }

  static async resume(campaignId: string): Promise<void> {
    await apiRequest<{ success: boolean; ok?: boolean }>(
      'POST',
      `/api/sms/broadcast/${encodeURIComponent(campaignId)}/resume`,
      undefined,
      'Unable to resume the broadcast.',
    );
  }
}
