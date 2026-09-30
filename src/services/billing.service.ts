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
  currentPeriodEnd: string | null;
  plan: {
    id: string;
    name: string;
    slug: string;
    priceCents: number;
    interval: string;
  };
}

export interface BillingState {
  plans: Plan[];
  subscription: Subscription | null;
  usage: { campaigns: number; customers: number };
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
    const result = await apiRequest<{ success: boolean; plans: Plan[]; subscription: Subscription | null; usage: BillingState['usage'] }>(
      'GET',
      '/api/billing',
      undefined,
      'Unable to load billing.',
    );

    return {
      plans: (result.plans ?? []).map(mapPlan),
      subscription: result.subscription ?? null,
      usage: result.usage ?? { campaigns: 0, customers: 0 },
    };
  }

  static async changePlan(planSlug: string): Promise<BillingState> {
    const result = await apiRequest<{ success: boolean; plans: Plan[]; subscription: Subscription | null; usage: BillingState['usage'] }>(
      'POST',
      '/api/billing/change-plan',
      { planSlug },
      'Unable to change the plan.',
    );

    return {
      plans: (result.plans ?? []).map(mapPlan),
      subscription: result.subscription ?? null,
      usage: result.usage ?? { campaigns: 0, customers: 0 },
    };
  }
}
