"use client";

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  CampaignConfigService,
  type RewardConfiguration,
  type SavedCampaignConfiguration,
} from '@/services/campaign-config.service';
import { CampaignService, type Campaign } from '@/services/campaign.service';

const SEGMENT_COLORS = [
  '#ff9e80',
  '#ffcc80',
  '#a5d6a7',
  '#81c784',
  '#ff8a80',
  '#e0e0e0',
  '#80deea',
  '#b39ddb',
];

type GameSegment = {
  id: string;
  label: string;
  color: string;
  weight: number;
  active: boolean;
  type: RewardConfiguration['type'];
  value: number;
  quantity: number;
};

function segmentsFromRewards(rewards: RewardConfiguration[] | undefined): GameSegment[] {
  return (rewards ?? []).map((reward, index) => ({
    id: reward.id ?? `new-${index}`,
    label: reward.name,
    color: SEGMENT_COLORS[index % SEGMENT_COLORS.length] ?? '#80deea',
    weight: Math.max(reward.weight ?? 0, 1),
    active: reward.active !== false,
    type: reward.type ?? 'custom_reward',
    value: reward.value ?? 0,
    quantity: reward.quantity ?? 0,
  }));
}

export default function GamesPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState('');
  const [config, setConfig] = useState<SavedCampaignConfiguration | null>(null);
  const [gameType, setGameType] = useState('prize_wheel');
  const [themeColor, setThemeColor] = useState('#ff6b6b');
  const [segments, setSegments] = useState<GameSegment[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    CampaignService.getCampaigns({ limit: 100 })
      .then((list) => {
        setCampaigns(list);
        setCampaignId(list[0]?.id ?? '');
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unable to load campaigns.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!campaignId) return;

    let cancelled = false;
    setStatus(null);
    setError(null);

    CampaignConfigService.load(campaignId)
      .then((loaded) => {
        if (cancelled) return;
        setConfig(loaded);
        setTitle(loaded?.title ?? '');
        setDescription(loaded?.description ?? '');
        setSegments(segmentsFromRewards(loaded?.rewards));
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to load the game configuration.');
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  const totalWeight = useMemo(() => segments.reduce((sum, segment) => sum + segment.weight, 0), [segments]);

  const handleSaveGameConfiguration = async () => {
    if (!config || !campaignId) return;

    setSaving(true);
    setStatus(null);
    setError(null);

    try {
      await CampaignConfigService.save({
        title,
        description,
        googleMapsName: config.googleMapsName,
        googleMapsUrl: config.googleMapsUrl,
        googlePlaceId: config.googlePlaceId,
        facebookUrl: config.facebookUrl,
        instagramUrl: config.instagramUrl,
        action: config.action,
        campaignId,
        status: config.status,
        startAt: config.startAt,
        endAt: config.endAt,
        rewards: segments.map((segment) => ({
          id: segment.id.startsWith('new-') ? undefined : segment.id,
          name: segment.label,
          description: config.rewards?.find((reward) => reward.id === segment.id)?.description ?? '',
          type: segment.type,
          value: segment.value,
          weight: segment.weight,
          quantity: segment.quantity,
          active: segment.active,
        })),
      });
      setStatus('Game configuration saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save the game configuration.');
    } finally {
      setSaving(false);
    }
  };

  const updateSegment = (id: string, patch: Partial<GameSegment>) => {
    setSegments((current) => current.map((segment) => (segment.id === id ? { ...segment, ...patch } : segment)));
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-4" />
          <p className="text-gray-600">Loading games...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Games</h2>
          <p className="text-sm text-gray-600">Create and manage interactive games for your campaigns</p>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border-l-4 border-red-400 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}
      {status && (
        <div className="mb-6 rounded-lg border-l-4 border-green-400 bg-green-50 p-4 text-sm text-green-700">
          {status}
        </div>
      )}

      <div className="mb-6 p-4 bg-gray-50 rounded-lg">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center space-x-4">
            <span className="text-sm font-medium text-gray-700">Game Type:</span>
            <select
              value={gameType}
              onChange={(e) => setGameType(e.target.value)}
              className="block rounded-md border-0 px-3 py-2 text-base text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
            >
              <option value="prize_wheel">Prize Wheel</option>
              <option value="scratch_card">Scratch Card</option>
              <option value="slot_machine">Slot Machine</option>
            </select>
          </div>

          <div className="flex items-center space-x-4">
            <label htmlFor="game-campaign" className="text-sm font-medium text-gray-700">
              Campaign:
            </label>
            <select
              id="game-campaign"
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
              className="block rounded-md border-0 px-3 py-2 text-base text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
            >
              <option value="">Select a campaign</option>
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {!campaignId ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-12 text-center text-gray-500">
          {campaigns.length === 0
            ? 'Create a campaign first, then come back to configure its game.'
            : 'Pick a campaign to configure its prize wheel.'}
        </div>
      ) : !config ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-12 text-center text-gray-500">
          This campaign has no saved configuration yet. Save it from the Wheel page first.
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Game Configuration</h3>

            <div className="mb-4">
              <label htmlFor="game-title" className="block text-sm font-medium text-gray-700 mb-1">
                Game Title
              </label>
              <input
                id="game-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="block w-full rounded-md border-0 px-3 py-2 text-base text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
              />
            </div>

            <div className="mb-4">
              <label htmlFor="game-description" className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                id="game-description"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="block w-full rounded-md border-0 px-3 py-2 text-base text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
              />
            </div>

            <div className="mb-4">
              <label htmlFor="theme-color" className="block text-sm font-medium text-gray-700 mb-1">
                Theme Color
              </label>
              <input
                id="theme-color"
                type="color"
                value={themeColor}
                onChange={(e) => setThemeColor(e.target.value)}
                className="w-12 h-12 rounded-md border-0 p-0"
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Live Preview</label>
              <div className="aspect-square bg-gray-50 rounded-lg flex items-center justify-center relative overflow-hidden">
                <div
                  className="absolute inset-0"
                  style={{
                    background: `conic-gradient(${segments
                      .map((segment, idx) => {
                        const before = segments.slice(0, idx).reduce((sum, s) => sum + s.weight, 0);
                        const share = totalWeight > 0 ? segment.weight / totalWeight : 0;
                        const beforeShare = totalWeight > 0 ? before / totalWeight : 0;
                        return `${segment.color} ${beforeShare * 360}deg ${(beforeShare + share) * 360}deg`;
                      })
                      .reverse()
                      .join(', ')})`,
                    WebkitMaskImage: 'radial-gradient(circle closest-side, white 70%, transparent 71%)',
                    maskImage: 'radial-gradient(circle closest-side, white 70%, transparent 71%)',
                  }}
                />
                <div className="relative z-10 flex items-center justify-center h-full w-full">
                  <div className="h-12 w-12 rounded-full bg-white flex items-center justify-center shadow-lg">
                    <span className="text-2xl font-bold">🎡</span>
                  </div>
                </div>
              </div>
              <p className="mt-2 text-xs text-gray-500 text-center">
                Wheel preview - slice sizes mirror the live reward weights
              </p>
            </div>

            <div className="mb-6">
              <label htmlFor="segments" className="block text-sm font-medium text-gray-700 mb-1">
                Wheel Segments
              </label>
              <div className="space-y-3">
                {segments.map((segment) => (
                  <div key={segment.id} className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg">
                    <div className="flex-shrink-0 h-8 w-8" style={{ backgroundColor: segment.color }} />
                    <div className="flex-1">
                      <div className="flex justify-between">
                        <input
                          type="text"
                          aria-label="Segment label"
                          value={segment.label}
                          onChange={(e) => updateSegment(segment.id, { label: e.target.value })}
                          className="block w-full rounded-md border-0 px-2 py-1 text-sm text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-indigo-600"
                        />
                        <div className="flex items-center space-x-2">
                          <span className="text-xs text-gray-500">
                            {totalWeight > 0 ? Math.round((segment.weight / totalWeight) * 100) : 0}%
                          </span>
                          <input
                            type="number"
                            min="0"
                            aria-label="Segment weight"
                            value={segment.weight}
                            onChange={(e) => updateSegment(segment.id, { weight: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                            className="w-24 rounded-md border-0 px-2 py-1 text-sm text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-indigo-600"
                          />
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setSegments((current) => current.filter((item) => item.id !== segment.id))}
                    >
                      Remove
                    </Button>
                  </div>
                ))}

                <div className="mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setSegments((current) => [
                        ...current,
                        {
                          id: `new-${Date.now()}`,
                          label: 'New Segment',
                          color: SEGMENT_COLORS[current.length % SEGMENT_COLORS.length] ?? '#80deea',
                          weight: 10,
                          active: true,
                          type: 'custom_reward',
                          value: 0,
                          quantity: 0,
                        },
                      ])
                    }
                  >
                    Add Segment
                  </Button>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-gray-200">
                <Button onClick={handleSaveGameConfiguration} disabled={saving}>
                  {saving ? 'Saving...' : 'Save Game Configuration'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
