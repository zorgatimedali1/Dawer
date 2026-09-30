import { apiRequest, buildQuery } from './http';

export interface Poster {
  id: string;
  campaignId: string;
  campaignName: string;
  template: string;
  title: string;
  subtitle: string;
  theme: string;
  configuration: Record<string, unknown> | null;
  updatedAt: string;
}

interface PosterRow {
  id: string;
  campaign_id: string;
  campaign_name: string | null;
  template: string;
  title: string | null;
  subtitle: string | null;
  theme: string | null;
  configuration: string | null;
  updated_at: string;
}

function mapPoster(row: PosterRow): Poster {
  let configuration: Record<string, unknown> | null = null;

  if (row.configuration) {
    try {
      configuration = JSON.parse(row.configuration) as Record<string, unknown>;
    } catch {
      configuration = null;
    }
  }

  return {
    id: row.id,
    campaignId: row.campaign_id,
    campaignName: row.campaign_name ?? 'Campaign',
    template: row.template,
    title: row.title ?? '',
    subtitle: row.subtitle ?? '',
    theme: row.theme ?? '#4f46e5',
    configuration,
    updatedAt: row.updated_at,
  };
}

export class PosterService {
  static async list(options: { campaignId?: string | undefined } = {}): Promise<Poster[]> {
    const query = buildQuery(options);
    const result = await apiRequest<{ success: boolean; posters: PosterRow[] }>(
      'GET',
      `/api/business/posters${query}`,
      undefined,
      'Unable to load posters.',
    );

    return (result.posters ?? []).map(mapPoster);
  }

  static async create(input: {
    campaignId: string;
    template?: string;
    title?: string;
    subtitle?: string;
    theme?: string;
    configuration?: Record<string, unknown>;
  }): Promise<Poster> {
    const result = await apiRequest<{ success: boolean; poster: PosterRow }>(
      'POST',
      '/api/business/posters',
      input,
      'Unable to create the poster.',
    );

    return mapPoster(result.poster);
  }

  static async update(
    posterId: string,
    changes: {
      template?: string;
      title?: string;
      subtitle?: string;
      theme?: string;
      configuration?: Record<string, unknown>;
    },
  ): Promise<Poster> {
    const result = await apiRequest<{ success: boolean; poster: PosterRow }>(
      'PATCH',
      `/api/business/posters/${encodeURIComponent(posterId)}`,
      changes,
      'Unable to save the poster.',
    );

    return mapPoster(result.poster);
  }
}
