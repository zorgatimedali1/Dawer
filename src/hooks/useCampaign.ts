import { useState, useEffect, useCallback } from 'react';
import { CampaignService } from '../services/campaign.service';
import type { Campaign, CampaignFilters } from '../services/campaign.service';
import { readCachedResource, setCachedResource } from './useCachedResource';

export interface UseCampaignResult {
  campaigns: Campaign[];
  loading: boolean;
  error: Error | null;
  filters: CampaignFilters;
  setFilters: (filters: CampaignFilters) => void;
  refetch: () => Promise<void>;
}

function cacheKeyFor(filters: CampaignFilters): string {
  return `campaigns:list:${JSON.stringify(filters)}`;
}

export function useCampaign(initialFilters: CampaignFilters = {}): UseCampaignResult {
  const [filters, setFilters] = useState<CampaignFilters>(initialFilters);
  const cacheKey = cacheKeyFor(filters);

  // A revisit within the cache TTL paints the last list immediately — the
  // full-page skeleton only shows when the cache has nothing to offer.
  const [campaigns, setCampaigns] = useState<Campaign[]>(() => readCachedResource<Campaign[]>(cacheKey) ?? []);
  const [loading, setLoading] = useState<boolean>(() => readCachedResource(cacheKey) === null);
  const [error, setError] = useState<Error | null>(null);

  const fetchCampaigns = useCallback(async (bypassCache = false) => {
    if (!bypassCache) {
      const cached = readCachedResource<Campaign[]>(cacheKey);
      if (cached) {
        setCampaigns(cached);
        setLoading(false);
        return;
      }
    }
    // Between two fresh paints (e.g. the refresh after a save) the visible
    // list already exists — refresh it quietly instead of re-skeletoning.
    if (campaigns.length > 0) {
      setError(null);
      try {
        const data = await CampaignService.getCampaigns(filters);
        setCachedResource(cacheKey, data);
        setCampaigns(data);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('An unknown error occurred'));
      }
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await CampaignService.getCampaigns(filters);
      setCachedResource(cacheKey, data);
      setCampaigns(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('An unknown error occurred'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- campaigns is a best-effort snapshot for the quiet path
  }, [filters, cacheKey]);

  useEffect(() => {
    void fetchCampaigns();
  }, [fetchCampaigns]);

  const refetch = useCallback(async () => {
    await fetchCampaigns(true);
  }, [fetchCampaigns]);

  return {
    campaigns,
    loading,
    error,
    filters,
    setFilters,
    refetch,
  };
}
