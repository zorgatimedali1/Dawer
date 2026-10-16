import { apiRequest } from './http';

/** A plan row as exposed by `GET /api/public/plans`. */
export interface PublicPlan {
  name: string;
  slug: string;
  priceCents: number;
  interval: string;
  features: string[];
}

interface PublicPlansResponse {
  success: boolean;
  plans?: PublicPlan[];
}

/**
 * Unauthenticated pricing feed for the landing page. The list is whatever the
 * operator last saved in the console, so a price/name/feature edit reaches
 * visitors without a redeploy; the page falls back to its bundled catalog if
 * this request fails.
 */
export class PublicPlansService {
  static async list(): Promise<PublicPlan[]> {
    const result = await apiRequest<PublicPlansResponse>(
      'GET',
      '/api/public/plans',
      undefined,
      'Unable to load pricing.',
    );
    return result.plans ?? [];
  }
}
