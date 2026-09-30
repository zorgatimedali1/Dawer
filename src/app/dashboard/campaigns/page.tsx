"use client";

import { useCampaign } from '@/hooks/useCampaign';
import { Button } from '@/components/ui/button';

export default function CampaignsPage() {
  const { campaigns, loading, error, refetch } = useCampaign();

  const handleCreateCampaign = () => {
    console.log('Create campaign clicked');
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-4" />
          <p className="text-gray-600">Loading campaigns...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border-l-4 border-red-400 p-6 mb-6">
          <h3 className="text-sm font-medium text-red-800">Error Loading Campaigns</h3>
          <p className="text-sm text-red-700 mt-2">{error.message}</p>
        </div>
        <div className="flex justify-end">
          <Button variant="outline" onClick={refetch}>Retry</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex justify-between items-start flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Campaigns</h2>
          <p className="text-sm text-gray-600">Manage your marketing campaigns</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={handleCreateCampaign}>New Campaign</Button>
        </div>
      </div>

      {campaigns.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-500">No campaigns found. Create your first campaign to get started.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {campaigns.map((campaign) => (
            <div key={campaign.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="font-medium text-gray-900">{campaign.name}</h3>
                  <p className="text-sm text-gray-600 line-clamp-2">{campaign.description}</p>
                </div>
                <div className="text-sm space-y-1">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${campaign.status === 'active' ? 'bg-green-100 text-green-800' : campaign.status === 'scheduled' ? 'bg-blue-100 text-blue-800' : campaign.status === 'paused' ? 'bg-yellow-100 text-yellow-800' : campaign.status === 'completed' ? 'bg-gray-100 text-gray-800' : campaign.status === 'archived' ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-800'}`}>
                    {campaign.status.charAt(0).toUpperCase() + campaign.status.slice(1)}
                  </span>
                  <span className="ml-2">• {campaign.participantCount} participants</span>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3 text-sm text-gray-600">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs text-gray-400">Starts:</span>
                    <span>{new Date(campaign.startsAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs text-gray-400">Ends:</span>
                    <span>{new Date(campaign.endsAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs text-gray-400">Conversion:</span>
                    <span className="font-medium">{campaign.conversionRate}%</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex justify-end space-x-3">
                <Button variant="outline" size="sm">Edit</Button>
                <Button variant="outline" size="sm">Duplicate</Button>
                <Button variant="outline" size="sm">{campaign.status === 'active' ? 'Pause' : 'Activate'}</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}