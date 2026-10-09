import { apiRequest } from './http';

export type EmailStatus = {
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
  /** Daily provider quota (Brevo free tier: 300/day, resets at midnight UTC). */
  quota?: {
    dailyUsed: number | null;
    dailyLimit: number;
  };
  /** Today's marketing reservation against the daily cap. */
  dailyReserved?: number;
  dailyCap?: number;
  /** Addresses excluded from future sends (unsubscribes, bounces, complaints). */
  suppressed?: number;
};

export type EmailCampaignStatus = 'PENDING' | 'PROCESSING' | 'PAUSED' | 'COMPLETED' | 'FAILED';

export type EmailCampaign = {
  id: string;
  subject: string;
  senderName: string;
  /** Original file name of the attached photo/PDF, when the campaign has one. */
  assetName?: string | null;
  totalRecipients: number;
  sent: number;
  failed: number;
  status: EmailCampaignStatus;
  lastError?: string | null;
  createdAt: string;
};

export type EmailRecipient = { email: string; name?: string };

/** An uploaded campaign attachment (photo embedded in the email, or a PDF). */
export type EmailAsset = {
  id: string;
  name: string;
  mime: string;
  url: string;
};

export type EmailBroadcastInput = {
  senderName: string;
  subject: string;
  content: string;
  link?: string | undefined;
  asset?: { id: string } | undefined;
  recipients: EmailRecipient[];
};

export type EmailBroadcastResult = {
  campaign: EmailCampaign;
  usage: { sentThisMonth: number; monthlyLimit: number; remaining: number; suppressed?: number };
};

export class EmailService {
  static async status(): Promise<EmailStatus> {
    const result = await apiRequest<{ success: boolean; status: EmailStatus }>(
      'GET',
      '/api/email/status',
      undefined,
      'Unable to load email status.',
    );
    return result.status;
  }

  static async list(): Promise<EmailCampaign[]> {
    const result = await apiRequest<{ success: boolean; campaigns: EmailCampaign[] }>(
      'GET',
      '/api/email/broadcast',
      undefined,
      'Unable to load email campaigns.',
    );
    return result.campaigns ?? [];
  }

  static async broadcast(input: EmailBroadcastInput): Promise<EmailBroadcastResult> {
    const result = await apiRequest<{ success: boolean; campaign: EmailCampaign; usage: EmailBroadcastResult['usage'] }>(
      'POST',
      '/api/email/broadcast',
      input,
      'Unable to send the campaign.',
    );
    return { campaign: result.campaign, usage: result.usage };
  }

  /** Stores one attachment (photo/PDF) and returns the id the broadcast references. */
  static async uploadAsset(input: { name: string; mimeType: string; dataBase64: string }): Promise<EmailAsset> {
    const result = await apiRequest<{ success: boolean; asset: EmailAsset }>(
      'POST',
      '/api/email/asset',
      input,
      'Unable to upload the attachment.',
    );
    return result.asset;
  }
}
