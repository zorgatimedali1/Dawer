import { apiRequest, buildQuery } from './http';

export interface QrCode {
  id: string;
  campaignId: string;
  campaignName: string;
  publicCode: string;
  name: string;
  location: string;
  active: boolean;
  createdAt: string;
  campaignParticipations: number;
  url: string;
}

interface QrRow {
  id: string;
  campaign_id: string;
  campaign_name: string | null;
  campaign_public_code: string | null;
  public_code: string;
  name: string | null;
  location: string | null;
  active: number;
  created_at: string;
  campaign_participations?: number;
}

function mapQr(row: QrRow): QrCode {
  const slug = row.campaign_public_code ?? row.campaign_id;

  return {
    id: row.id,
    campaignId: row.campaign_id,
    campaignName: row.campaign_name ?? 'Campaign',
    publicCode: row.public_code,
    name: row.name || 'Untitled QR code',
    location: row.location ?? '',
    active: Number(row.active ?? 1) === 1,
    createdAt: row.created_at,
    campaignParticipations: Number(row.campaign_participations ?? 0),
    url: `${window.location.origin}/customer/${slug}`,
  };
}

export class QrCodeService {
  static async list(options: { campaignId?: string | undefined } = {}): Promise<QrCode[]> {
    const query = buildQuery(options);
    const result = await apiRequest<{ success: boolean; qrCodes: QrRow[] }>(
      'GET',
      `/api/business/qr-codes${query}`,
      undefined,
      'Unable to load QR codes.',
    );

    return (result.qrCodes ?? []).map(mapQr);
  }

  static async create(input: { campaignId: string; name?: string; location?: string }): Promise<QrCode> {
    const result = await apiRequest<{ success: boolean; qrCode: QrRow }>(
      'POST',
      '/api/business/qr-codes',
      input,
      'Unable to create the QR code.',
    );

    return mapQr(result.qrCode);
  }

  static async update(qrId: string, changes: { name?: string; location?: string; active?: boolean }): Promise<QrCode> {
    const result = await apiRequest<{ success: boolean; qrCode: QrRow }>(
      'PATCH',
      `/api/business/qr-codes/${encodeURIComponent(qrId)}`,
      changes,
      'Unable to update the QR code.',
    );

    return mapQr(result.qrCode);
  }
}
