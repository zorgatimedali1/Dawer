import { apiRequest, buildQuery } from './http';

export interface Customer {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  email: string;
  phone: string;
  birthday: string | null;
  marketingConsent: boolean;
  createdAt: string;
  lastActivityAt: string | null;
  participationCount: number;
  couponCount: number;
  redeemedCount: number;
  status: 'active' | 'new';
}

export interface CustomerDetail {
  customer: Customer;
  participations: Array<{
    id: string;
    campaign_id: string;
    campaign_name: string | null;
    reward_id: string | null;
    reward_name: string | null;
    result: string | null;
    created_at: string;
  }>;
  coupons: Array<{
    id: string;
    campaign_id: string;
    reward_id: string | null;
    code: string;
    status: string;
    issued_at: string;
    expires_at: string | null;
    redeemed_at: string | null;
  }>;
}

interface CustomerRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  birthday: string | null;
  marketing_consent: number;
  created_at: string;
  last_activity_at: string | null;
  participation_count?: number;
  coupon_count?: number;
  redeemed_count?: number;
}

function mapCustomer(row: CustomerRow): Customer {
  const firstName = row.first_name ?? '';
  const lastName = row.last_name ?? '';
  const participationCount = Number(row.participation_count ?? 0);

  return {
    id: row.id,
    firstName,
    lastName,
    name: [firstName, lastName].filter(Boolean).join(' ') || row.email || 'Customer',
    email: row.email ?? '',
    phone: row.phone ?? '',
    birthday: row.birthday,
    marketingConsent: Number(row.marketing_consent ?? 0) === 1,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
    participationCount,
    couponCount: Number(row.coupon_count ?? 0),
    redeemedCount: Number(row.redeemed_count ?? 0),
    status: participationCount > 0 ? 'active' : 'new',
  };
}

export class CustomerService {
  static async list(
    options: {
      search?: string | undefined;
      campaignId?: string | undefined;
      page?: number | undefined;
      limit?: number | undefined;
    } = {},
  ): Promise<{
    customers: Customer[];
    total: number;
    page: number;
    limit: number;
  }> {
    const query = buildQuery(options);
    const result = await apiRequest<{
      success: boolean;
      customers: CustomerRow[];
      total: number;
      page: number;
      limit: number;
    }>('GET', `/api/business/customers${query}`, undefined, 'Unable to load customers.');

    return {
      customers: (result.customers ?? []).map(mapCustomer),
      total: Number(result.total ?? 0),
      page: Number(result.page ?? 1),
      limit: Number(result.limit ?? 20),
    };
  }

  static async get(customerId: string): Promise<CustomerDetail> {
    const result = await apiRequest<{ success: boolean } & Omit<CustomerDetail, 'customer'> & { customer: CustomerRow }>(
      'GET',
      `/api/business/customers/${encodeURIComponent(customerId)}`,
      undefined,
      'Unable to load the customer.',
    );

    return {
      customer: mapCustomer(result.customer),
      participations: result.participations ?? [],
      coupons: result.coupons ?? [],
    };
  }
}
