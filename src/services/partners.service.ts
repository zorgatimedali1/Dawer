import { apiRequest } from './http';

/** A partner row as exposed by `GET /api/public/partners`. */
export interface Partner {
  id: string;
  name: string;
  logoUrl: string;
}

interface PartnersResponse {
  success: boolean;
  partners?: Partner[];
}

/** Unauthenticated feed for the landing-page partner marquee. */
export class PartnersService {
  static async list(): Promise<Partner[]> {
    const result = await apiRequest<PartnersResponse>(
      'GET',
      '/api/public/partners',
      undefined,
      'Unable to load our partners.',
    );
    return result.partners ?? [];
  }
}
