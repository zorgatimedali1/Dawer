import { useState, useEffect, useCallback } from 'react';
import { CampaignService } from '../services/campaign.service';
import type { Campaign, CampaignFilters } from '../services/campaign.service';

export interface UseCampaignResult {
  campaigns: Campaign[];
  loading: boolean;
  error: Error | null;
  filters: CampaignFilters;
  setFilters: (filters: CampaignFilters) => void;
  refetch: () => Promise<void>;
}

export function useCampaign(initialFilters: CampaignFilters = {}): UseCampaignResult {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const [filters, setFilters] = useState<CampaignFilters>(initialFilters);

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await CampaignService.getCampaigns(filters);
      setCampaigns(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('An unknown error occurred'));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  const refetch = useCallback(async () => {
    await fetchCampaigns();
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
