import { apiRequest, buildQuery } from './http';

export type CouponStatus = 'issued' | 'redeemed' | 'expired';

export interface Coupon {
  id: string;
  code: string;
  status: CouponStatus;
  customerName: string;
  customerEmail: string;
  rewardName: string;
  campaignName: string;
  issuedAt: string;
  expiresAt: string | null;
  redeemedAt: string | null;
}

interface CouponRow {
  id: string;
  code: string;
  status: string;
  issued_at: string;
  expires_at: string | null;
  redeemed_at: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  reward_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

function mapCoupon(row: CouponRow): Coupon {
  const now = Date.now();
  const expired =
    row.status === 'ISSUED' && row.expires_at !== null && Date.parse(row.expires_at) < now;

  return {
    id: row.id,
    code: row.code,
    status: expired ? 'expired' : row.status === 'REDEEMED' ? 'redeemed' : 'issued',
    customerName: [row.first_name, row.last_name].filter(Boolean).join(' ') || row.email || 'Unknown',
    customerEmail: row.email ?? '',
    rewardName: row.reward_name ?? 'Reward',
    campaignName: row.campaign_name ?? 'Campaign',
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    redeemedAt: row.redeemed_at,
  };
}

export class CouponService {
  static async list(
    options: {
      status?: 'ISSUED' | 'REDEEMED' | 'EXPIRED' | 'ALL' | undefined;
      search?: string | undefined;
      campaignId?: string | undefined;
      page?: number | undefined;
      limit?: number | undefined;
    } = {},
  ): Promise<{ coupons: Coupon[]; total: number; page: number; limit: number }> {
    const query = buildQuery({ ...options, status: options.status ?? 'ALL' });
    const result = await apiRequest<{
      success: boolean;
      coupons: CouponRow[];
      total: number;
      page: number;
      limit: number;
    }>('GET', `/api/business/coupons${query}`, undefined, 'Unable to load coupons.');

    return {
      coupons: (result.coupons ?? []).map(mapCoupon),
      total: Number(result.total ?? 0),
      page: Number(result.page ?? 1),
      limit: Number(result.limit ?? 20),
    };
  }

  static async redeem(couponId: string): Promise<{ code: string; redeemedAt: string }> {
    const result = await apiRequest<{ success: boolean; coupon: { code: string; redeemed_at: string } }>(
      'POST',
      `/api/business/coupons/${encodeURIComponent(couponId)}/redeem`,
      {},
      'Unable to redeem the coupon.',
    );

    return { code: result.coupon.code, redeemedAt: result.coupon.redeemed_at };
  }

  static async update(
    couponId: string,
    input: { status?: 'ISSUED' | 'REDEEMED'; expiresAt?: string | null },
  ): Promise<void> {
    await apiRequest<{ success: boolean }>(
      'PATCH',
      `/api/business/coupons/${encodeURIComponent(couponId)}`,
      input,
      'Unable to update the prize.',
    );
  }

  static async delete(couponId: string): Promise<void> {
    await apiRequest<{ success: boolean }>(
      'DELETE',
      `/api/business/coupons/${encodeURIComponent(couponId)}`,
      undefined,
      'Unable to delete the prize.',
    );
  }
}
