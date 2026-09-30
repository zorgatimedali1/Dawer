export interface Campaign {
  id: string;
  name: string;
  description: string;
  status: 'draft' | 'scheduled' | 'active' | 'paused' | 'completed' | 'archived';
  startsAt: string;
  endsAt: string;
  participantCount: number;
  rewardCount: number;
  redemptionCount: number;
  conversionRate: number;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignFilters {
  status?: ('draft' | 'scheduled' | 'active' | 'paused' | 'completed' | 'archived')[];
  search?: string;
  page?: number;
  limit?: number;
}

export interface CampaignStats {
  totalCampaigns: number;
  activeCampaigns: number;
  scheduledCampaigns: number;
  completedCampaigns: number;
  totalParticipants: number;
  totalRewardsIssued: number;
  totalCouponsRedeemed: number;
  averageConversionRate: number;
}

export class CampaignService {
  private static readonly API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api';

  static async getCampaigns(filters: CampaignFilters = {}): Promise<Campaign[]> {
    // Simulate API call
    return new Promise((resolve) => {
      setTimeout(() => {
        const mockCampaigns: Campaign[] = [
          {
            id: 'camp_1',
            name: 'Summer Splash Campaign',
            description: 'Scan to play our prize wheel and win exciting rewards!',
            status: 'active',
            startsAt: '2026-09-01T00:00:00Z',
            endsAt: '2026-09-30T23:59:59Z',
            participantCount: 234,
            rewardCount: 45,
            redemptionCount: 32,
            conversionRate: 68.5,
            createdAt: '2026-08-15T10:30:00Z',
            updatedAt: '2026-09-20T14:22:00Z',
          },
          {
            id: 'camp_2',
            name: 'Holiday Giveaway',
            description: 'Win big prizes this holiday season!',
            status: 'scheduled',
            startsAt: '2026-12-01T00:00:00Z',
            endsAt: '2026-12-31T23:59:59Z',
            participantCount: 0,
            rewardCount: 0,
            redemptionCount: 0,
            conversionRate: 0,
            createdAt: '2026-09-10T15:45:00Z',
            updatedAt: '2026-09-10T15:45:00Z',
          },
          {
            id: 'camp_3',
            name: 'Loyalty Program',
            description: 'Earn points for every visit',
            status: 'active',
            startsAt: '2026-01-01T00:00:00Z',
            endsAt: '2026-12-31T23:59:59Z',
            participantCount: 89,
            rewardCount: 32,
            redemptionCount: 28,
            conversionRate: 87.2,
            createdAt: '2026-01-05T09:00:00Z',
            updatedAt: '2026-09-18T11:30:00Z',
          },
        ];

        // Apply filters
        let filtered = mockCampaigns;
        if (filters.status) {
          filtered = filtered.filter(campaign => filters.status!.includes(campaign.status as any));
        }
        if (filters.search) {
          const searchLower = filters.search.toLowerCase();
          filtered = filtered.filter(campaign => 
            campaign.name.toLowerCase().includes(searchLower) || 
            campaign.description.toLowerCase().includes(searchLower)
          );
        }

        // Apply pagination
        const page = filters.page ?? 1;
        const limit = filters.limit ?? 10;
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const paginated = filtered.slice(startIndex, endIndex);

        resolve(paginated);
      }, 500);
    });
  }

  static async getCampaignById(id: string): Promise<Campaign | null> {
    return new Promise((resolve) => {
      setTimeout(() => {
        // Simulate finding a campaign
        if (id === 'camp_1') {
          resolve({
            id: 'camp_1',
            name: 'Summer Splash Campaign',
            description: 'Scan to play our prize wheel and win exciting rewards!',
            status: 'active',
            startsAt: '2026-09-01T00:00:00Z',
            endsAt: '2026-09-30T23:59:59Z',
            participantCount: 234,
            rewardCount: 45,
            redemptionCount: 32,
            conversionRate: 68.5,
            createdAt: '2026-08-15T10:30:00Z',
            updatedAt: '2026-09-20T14:22:00Z',
          });
        } else {
          resolve(null);
        }
      }, 300);
    });
  }

  static async createCampaign(data: Omit<Campaign, 'id' | 'createdAt' | 'updatedAt'>): Promise<Campaign> {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          id: `camp_${Date.now()}`,
          ...data,
          participantCount: 0,
          rewardCount: 0,
          redemptionCount: 0,
          conversionRate: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }, 800);
    });
  }

  static async updateCampaign(id: string, data: Partial<Campaign>): Promise<Campaign> {
    return new Promise((resolve) => {
      setTimeout(() => {
        // In a real app, this would fetch the campaign, update it, and save
        resolve({
          id,
          name: data.name || 'Unknown Campaign',
          description: data.description || '',
          status: data.status || 'draft',
          startsAt: data.startsAt || new Date().toISOString(),
          endsAt: data.endsAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          participantCount: data.participantCount ?? 0,
          rewardCount: data.rewardCount ?? 0,
          redemptionCount: data.redemptionCount ?? 0,
          conversionRate: data.conversionRate ?? 0,
          createdAt: new Date().toISOString(), // This would be fetched from DB in reality
          updatedAt: new Date().toISOString(),
        });
      }, 600);
    });
  }

  static async deleteCampaign(id: string): Promise<boolean> {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(true);
      }, 400);
    });
  }

  static async duplicateCampaign(id: string): Promise<Campaign> {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          id: `camp_${Date.now()}`,
          name: 'Copy of Campaign',
          description: 'Duplicated campaign',
          status: 'draft',
          startsAt: new Date().toISOString(),
          endsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          participantCount: 0,
          rewardCount: 0,
          redemptionCount: 0,
          conversionRate: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }, 700);
    });
  }

  static async getCampaignStats(): Promise<CampaignStats> {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          totalCampaigns: 3,
          activeCampaigns: 2,
          scheduledCampaigns: 1,
          completedCampaigns: 0,
          totalParticipants: 323,
          totalRewardsIssued: 77,
          totalCouponsRedeemed: 60,
          averageConversionRate: 77.85,
        });
      }, 500);
    });
  }
}
