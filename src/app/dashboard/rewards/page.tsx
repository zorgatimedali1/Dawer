"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export default function RewardsPage() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');

  const rewards = [
    {
      id: 'rew_1',
      name: '5% OFF Coupon',
      type: 'percentage_discount',
      value: 5,
      description: 'Get 5% off your next purchase',
      quantity: 100,
      remaining: 75,
      probability: 0.3,
      active: true,
    },
    {
      id: 'rew_2',
      name: '10% OFF Coupon',
      type: 'percentage_discount',
      value: 10,
      description: 'Get 10% off your next purchase',
      quantity: 50,
      remaining: 30,
      probability: 0.25,
      active: true,
    },
    {
      id: 'rew_3',
      name: 'Free Drink',
      type: 'free_product',
      value: 1,
      description: 'Enjoy a free beverage on us',
      quantity: 30,
      remaining: 20,
      probability: 0.2,
      active: true,
    },
    {
      id: 'rew_4',
      name: 'Free Dessert',
      type: 'free_product',
      value: 1,
      description: 'Complimentary dessert with any meal',
      quantity: 25,
      remaining: 15,
      probability: 0.15,
      active: true,
    },
    {
      id: 'rew_5',
      name: 'JACKPOT: 50% OFF',
      type: 'percentage_discount',
      value: 50,
      description: 'Half off your entire purchase',
      quantity: 10,
      remaining: 8,
      probability: 0.05,
      active: true,
    },
    {
      id: 'rew_6',
      name: 'Try Again',
      type: 'none',
      value: 0,
      description: 'Spin the wheel again',
      quantity: 200,
      remaining: 150,
      probability: 0.05,
      active: true,
    },
  ];

  const filteredRewards = rewards.filter((reward) => {
    const matchesSearch =
      reward.name.toLowerCase().includes(search.toLowerCase()) ||
      reward.description.toLowerCase().includes(search.toLowerCase());

    const matchesType = typeFilter === 'all' || reward.type === typeFilter;

    return matchesSearch && matchesType;
  });

  const handleCreateReward = () => console.log('Create reward');

  return (
    <div className="p-6">
      <div className="mb-6 flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Rewards</h2>
          <p className="text-sm text-gray-600">Manage the rewards and incentives for your campaigns</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={handleCreateReward}>New Reward</Button>
        </div>
      </div>

      <div className="mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex-1 min-w-[200px]">
            <label htmlFor="reward-search" className="block text-sm font-medium text-gray-700 mb-1">
              Search rewards
            </label>
            <div className="relative">
              <input
                id="reward-search"
                type="text"
                placeholder="Search by name or description..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="block w-full rounded-md border-0 px-3 py-2 text-base text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
              />
            </div>
          </div>

          <div className="flex-1 sm:flex-1 flex-wrap gap-3 sm:justify-end">
            <div>
              <label htmlFor="reward-type-filter" className="block text-sm font-medium text-gray-700 mb-1">
                Reward Type
              </label>
              <select
                id="reward-type-filter"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="block w-full rounded-md border-0 px-3 py-2 text-base text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
              >
                <option value="all">All Types</option>
                <option value="percentage_discount">Percentage Discount</option>
                <option value="fixed_discount">Fixed Amount Discount</option>
                <option value="free_product">Free Product</option>
                <option value="free_service">Free Service</option>
                <option value="custom_reward">Custom Reward</option>
                <option value="none">No Reward</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {filteredRewards.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500">No rewards found matching your criteria.</p>
          </div>
        ) : (
          filteredRewards.map((reward) => (
            <div key={reward.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex justify-between items-start">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center mb-2">
                    <div className="h-8 w-8 flex-shrink-0">
                      <div className={`h-8 w-8 rounded-lg ${reward.type === 'percentage_discount' ? 'bg-amber-100' : reward.type === 'fixed_discount' ? 'bg-blue-100' : reward.type === 'free_product' || reward.type === 'free_service' ? 'bg-green-100' : reward.type === 'custom_reward' ? 'bg-purple-100' : 'bg-gray-100'} flex items-center justify-center text-sm font-medium`}>
                        {reward.type === 'percentage_discount' ? '%' : reward.type === 'fixed_discount' ? '$' : reward.type === 'free_product' || reward.type === 'free_service' ? '🎁' : reward.type === 'custom_reward' ? '⭐' : '🚫'}
                      </div>
                    </div>
                    <div className="ml-3">
                      <h3 className="text-lg font-medium text-gray-900">{reward.name}</h3>
                      <p className="text-sm text-gray-600">{reward.description}</p>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center space-x-4 text-sm text-gray-600">
                    <div>
                      <span className="font-medium">{reward.value}</span>
                      <span>{reward.type === 'percentage_discount' ? '%' : reward.type === 'fixed_discount' ? ' off' : ''}</span>
                    </div>
                    <div>
                      <span className="font-medium">{reward.remaining}</span>
                      <span>/ {reward.quantity} remaining</span>
                    </div>
                    <div>
                      <span className="font-medium">{Math.round(reward.probability * 100)}%</span>
                      <span> chance to win</span>
                    </div>
                    <div>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${reward.active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {reward.active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-3">
                  <Button variant="outline" size="sm">Edit</Button>
                  <Button variant="destructive" size="sm">Delete</Button>
                  <Button variant={reward.active ? 'outline' : 'secondary'} size="sm">
                    {reward.active ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}