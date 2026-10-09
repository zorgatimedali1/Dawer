import { apiRequest } from './http';

export interface PlanLimits {
  campaigns: number;
  customers: number;
}

export interface Plan {
  id: string;
  name: string;
  slug: string;
  priceCents: number;
  interval: string;
  features: {
    limits: PlanLimits;
    features: string[];
  };
}

export interface Subscription {
  id: string;
  status: string;
  currentPeriodStart?: string | null;
  currentPeriodEnd: string | null;
  plan: {
    id: string;
    name: string;
    slug: string;
    priceCents: number;
    interval: string;
  };
}

export interface BillingAccess {
  state: 'trial' | 'active' | 'expired' | 'inactive' | 'none';
  canManage: boolean;
  startsAt: string | null;
  endsAt: string | null;
  plan: Plan;
}

/** A plan the merchant asked for and the owner has not activated yet. */
export interface PendingRequest {
  id: string;
  plan: { name: string; slug: string };
  createdAt: string;
}

export interface SubscribeRequestResult {
  requestId: string;
  plan: { id: string; name: string; slug: string };
  whatsappUrl: string;
}

/**
 * Effective platform switches (operator console). Absent payload = everything
 * stays enabled so older deployments keep working.
 */
export interface MarketingFeatures {
  whatsappEnabled: boolean;
  emailEnabled: boolean;
}

export const DEFAULT_MARKETING_FEATURES: MarketingFeatures = {
  whatsappEnabled: true,
  emailEnabled: true,
};

export interface BillingState {
  plans: Plan[];
  subscription: Subscription | null;
  access: BillingAccess;
  pendingRequest: PendingRequest | null;
  usage: { campaigns: number; customers: number };
  features: MarketingFeatures;
}

function mapPlan(plan: Plan): Plan {
  return {
    ...plan,
    features: {
      limits: plan.features?.limits ?? { campaigns: 0, customers: 0 },
      features: plan.features?.features ?? [],
    },
  };
}

export class BillingService {
  static async get(): Promise<BillingState> {
    const result = await apiRequest<{
      success: boolean;
      plans: Plan[];
      subscription: Subscription | null;
      access?: BillingAccess | undefined;
      pendingRequest: PendingRequest | null;
      usage: BillingState['usage'];
      features?: MarketingFeatures | undefined;
    }>('GET', '/api/billing', undefined, 'Unable to load billing.');

    const plans = (result.plans ?? []).map(mapPlan);
    const starter = plans.find((plan) => plan.slug === 'starter') ?? {
      id: '',
      name: 'Starter',
      slug: 'starter',
      priceCents: 0,
      interval: '3_months',
      features: { limits: { campaigns: -1, customers: 100 }, features: [] },
    };

    return {
      plans,
      subscription: result.subscription ?? null,
      access: result.access ?? {
        state: 'none',
        canManage: false,
        startsAt: null,
        endsAt: null,
        plan: starter,
      },
      pendingRequest: result.pendingRequest ?? null,
      usage: result.usage ?? { campaigns: 0, customers: 0 },
      features: {
        whatsappEnabled: result.features?.whatsappEnabled ?? DEFAULT_MARKETING_FEATURES.whatsappEnabled,
        emailEnabled: result.features?.emailEnabled ?? DEFAULT_MARKETING_FEATURES.emailEnabled,
      },
    };
  }

  /**
   * Records the plan and hands back the WhatsApp link of the SaaS owner; the
   * subscription is activated later from the operator console.
   */
  static async subscribeRequest(planSlug: string): Promise<SubscribeRequestResult> {
    return apiRequest<SubscribeRequestResult & { success: boolean }>(
      'POST',
      '/api/billing/subscribe-request',
      { planSlug },
      'Unable to send the subscription request.',
    );
  }
}
