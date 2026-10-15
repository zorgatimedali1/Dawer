import { apiRequest } from '@/platform/lib/http';

/** Numerical criteria stored on a plan row (`plans.features.limits`). */
export interface PlanLimits {
  campaigns: number;
  customers: number;
  whatsappMonthly: number;
  whatsappBatch: number;
  emailMonthly: number;
  emailBatch: number;
  /** 1 = merchants on this plan edit wheel colors and motion. */
  wheelDesign: number;
  /** 1 = merchants on this plan use their logo at the wheel hub. */
  wheelCenterLogo: number;
  /** 1 = merchants on this plan set the gate step colour. */
  wheelStepsColor: number;
}

/** A pricing plan as exposed by the operator console API. */
export interface PlatformPlan {
  id: string;
  name: string;
  slug: string;
  priceCents: number;
  interval: string;
  active: boolean;
  features: {
    limits: PlanLimits;
    features: string[];
  };
}

/** Full payload accepted by POST/PUT; the server validates it again. */
export interface PlanPayload {
  name: string;
  slug: string;
  priceCents: number;
  interval: string;
  active?: boolean;
  features: {
    limits: PlanLimits;
    features: string[];
  };
}

/** Operator-side CRUD for pricing plans and their criteria. */
export class PlansService {
  static async list(): Promise<PlatformPlan[]> {
    const result = await apiRequest<{ success: boolean; plans?: PlatformPlan[] }>(
      'GET',
      '/api/admin/plans',
      undefined,
      'Unable to load plans.',
    );
    return result.plans ?? [];
  }

  static async create(input: PlanPayload): Promise<PlatformPlan> {
    const result = await apiRequest<{ success: boolean; plan?: PlatformPlan }>(
      'POST',
      '/api/admin/plans',
      input,
      'Unable to create the plan.',
    );
    if (!result.plan) throw new Error('The server did not return the new plan.');
    return result.plan;
  }

  static async update(id: string, input: PlanPayload): Promise<PlatformPlan> {
    const result = await apiRequest<{ success: boolean; plan?: PlatformPlan }>(
      'PUT',
      `/api/admin/plans/${encodeURIComponent(id)}`,
      input,
      'Unable to save the plan.',
    );
    if (!result.plan) throw new Error('The server did not return the saved plan.');
    return result.plan;
  }

  static async remove(id: string): Promise<void> {
    await apiRequest<{ success: boolean }>(
      'DELETE',
      `/api/admin/plans/${encodeURIComponent(id)}`,
      undefined,
      'Unable to delete the plan.',
    );
  }
}
