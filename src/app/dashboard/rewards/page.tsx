"use client";

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { RewardService, type RewardSummary } from '@/services/reward.service';

const TYPE_ICONS: Record<string, { className: string; glyph: string }> = {
  percentage_discount: { className: 'bg-amber-100', glyph: '%' },
  fixed_discount: { className: 'bg-blue-100', glyph: '$' },
  free_product: { className: 'bg-green-100', glyph: '🎁' },
  free_service: { className: 'bg-green-100', glyph: '🎁' },
  custom_reward: { className: 'bg-purple-100', glyph: '⭐' },
  none: { className: 'bg-gray-100', glyph: '🚫' },
};

const FALLBACK_ICON = { className: 'bg-purple-100', glyph: '⭐' };

const TYPE_LABELS: Record<string, string> = {
  percentage_discount: 'Percentage Discount',
  fixed_discount: 'Fixed Amount Discount',
  free_product: 'Free Product',
  free_service: 'Free Service',
  custom_reward: 'Custom Reward',
  none: 'No Reward',
};

export default function RewardsPage() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [rewards, setRewards] = useState<RewardSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    RewardService.list()
      .then(setRewards)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unable to load rewards.'))
      .finally(() => setLoading(false));
  }, []);

  const totalWeight = useMemo(
    () => rewards.filter((reward) => reward.active).reduce((sum, reward) => sum + reward.weight, 0),
    [rewards],
  );

  const filteredRewards = rewards.filter((reward) => {
    const matchesSearch =
      reward.name.toLowerCase().includes(search.toLowerCase()) ||
      reward.description.toLowerCase().includes(search.toLowerCase());
    const matchesType = typeFilter === 'all' || reward.type === typeFilter;
    return matchesSearch && matchesType;
  });

  const patch = async (reward: RewardSummary, changes: { active?: boolean; quantity?: number }) => {
    setBusyId(reward.id);
    setError(null);

    try {
      const updated = await RewardService.update(reward.id, changes);
      setRewards((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update the reward.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Rewards</h2>
          <p className="text-sm text-gray-600">Manage the rewards and incentives for your campaigns</p>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border-l-4 border-red-400 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex-1 min-w-[200px]">
            <label htmlFor="reward-search" className="block text-sm font-medium text-gray-700 mb-1">
              Search rewards
            </label>
            <input
              id="reward-search"
              type="text"
              placeholder="Search by name or description..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="block w-full rounded-md border-0 px-3 py-2 text-base text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
            />
          </div>

          <div className="flex-1">
            <label htmlFor="reward-type-filter" className="block text-sm font-medium text-gray-700 mb-1">
              Reward Type
            </label>
            <select
              id="reward-type-filter"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="block w-full rounded-md border-0 px-3 py-2 text-base text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
            >
              <option value="all">All Types</option>
              {Object.entries(TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-4" />
            <p className="text-gray-600">Loading rewards...</p>
          </div>
        ) : filteredRewards.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500">No rewards found matching your criteria.</p>
            <p className="mt-2 text-sm text-gray-400">
              Configure rewards inside a campaign from the Wheel page.
            </p>
          </div>
        ) : (
          filteredRewards.map((reward) => {
            const icon = TYPE_ICONS[reward.type] ?? FALLBACK_ICON;
            const probability =
              reward.active && totalWeight > 0 ? Math.round((reward.weight / totalWeight) * 100) : 0;

            return (
              <div key={reward.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div className="flex justify-between items-start">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center mb-2">
                      <div className="h-8 w-8 flex-shrink-0">
                        <div
                          className={`h-8 w-8 rounded-lg ${icon.className} flex items-center justify-center text-sm font-medium`}
                        >
                          {icon.glyph}
                        </div>
                      </div>
                      <div className="ml-3">
                        <h3 className="text-lg font-medium text-gray-900">{reward.name}</h3>
                        <p className="text-sm text-gray-600">{reward.description || reward.campaignName}</p>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-600">
                      <div>
                        <span className="font-medium">{reward.value}</span>
                        <span>{reward.type === 'percentage_discount' ? '%' : reward.type === 'fixed_discount' ? ' off' : ''}</span>
                      </div>
                      <div>
                        <span className="font-medium">{Math.max(reward.quantity, 0)}</span>
                        <span> of {reward.quantityInitial ?? reward.quantity} remaining</span>
                      </div>
                      <div>
                        <span className="font-medium">{probability}%</span>
                        <span> chance to win</span>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          reward.active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {reward.active ? 'Active' : 'Inactive'}
                      </span>
                      <span className="text-xs text-gray-400">{reward.campaignName}</span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-3">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyId === reward.id || reward.quantity <= 0}
                      onClick={() => patch(reward, { quantity: reward.quantity - 1 })}
                    >
                      -1 stock
                    </Button>
                    <Button
                      variant={reward.active ? 'outline' : 'secondary'}
                      size="sm"
                      disabled={busyId === reward.id}
                      onClick={() => patch(reward, { active: !reward.active })}
                    >
                      {reward.active ? 'Deactivate' : 'Activate'}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
