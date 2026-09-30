"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export default function AnalyticsPage() {
  const [dateRange, setDateRange] = useState('last_30_days');

  const overviewStats = {
    totalScans: 1240,
    totalParticipants: 892,
    totalRewardsIssued: 456,
    totalCouponsRedeemed: 324,
    averageConversionRate: 68.5,
  };

  const handleExport = () => {
    console.log('Export analytics clicked');
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Analytics</h2>
          <p className="text-sm text-gray-600">
            Monitor and analyze campaign performance and customer engagement
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={handleExport}>Export Report</Button>
        </div>
      </div>

      <div className="mb-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-sm font-medium text-gray-500 mb-2">Total Scans</h3>
            <p className="text-2xl font-bold text-gray-900">{overviewStats.totalScans}</p>
            <p className="text-xs text-indigo-600 flex items-center">
              <span className="mr-1">+</span>12.5% vs last period
            </p>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-sm font-medium text-gray-500 mb-2">Total Participants</h3>
            <p className="text-2xl font-bold text-gray-900">{overviewStats.totalParticipants}</p>
            <p className="text-xs text-indigo-600 flex items-center">
              <span className="mr-1">+</span>8.3% vs last period
            </p>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-sm font-medium text-gray-500 mb-2">Rewards Issued</h3>
            <p className="text-2xl font-bold text-gray-900">{overviewStats.totalRewardsIssued}</p>
            <p className="text-xs text-indigo-600 flex items-center">
              <span className="mr-1">+</span>15.7% vs last period
            </p>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-sm font-medium text-gray-500 mb-2">Coupons Redeemed</h3>
            <p className="text-2xl font-bold text-gray-900">{overviewStats.totalCouponsRedeemed}</p>
            <p className="text-xs text-indigo-600 flex items-center">
              <span className="mr-1">+</span>22.1% vs last period
            </p>
          </div>
        </div>
      </div>

      <div className="mb-6">
        <label htmlFor="date-range" className="block text-sm font-medium text-gray-700 mb-1">
          Date Range
        </label>
        <select
          id="date-range"
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value)}
          className="block w-full rounded-md border-0 px-3 py-2 text-base text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
        >
          <option value="last_7_days">Last 7 Days</option>
          <option value="last_30_days">Last 30 Days</option>
          <option value="last_90_days">Last 90 Days</option>
          <option value="this_year">This Year</option>
        </select>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Performance Trends</h3>
          <div className="h-48 bg-gray-100 rounded-lg">
            <div className="flex h-full items-center justify-center text-gray-400">Performance Chart</div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Conversion Funnel</h3>
          <div className="h-48 bg-gray-100 rounded-lg">
            <div className="flex h-full items-center justify-center text-gray-400">Conversion Funnel Chart</div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Reward Distribution</h3>
          <div className="h-48 bg-gray-100 rounded-lg">
            <div className="flex h-full items-center justify-center text-gray-400">Reward Distribution Chart</div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Geographic Distribution</h3>
          <div className="h-48 bg-gray-100 rounded-lg">
            <div className="flex h-full items-center justify-center text-gray-400">Geographic Chart</div>
          </div>
        </div>
      </div>

      <div className="mt-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Key Insights</h3>
          <div className="space-y-4">
            <div className="flex items-start space-x-3">
              <div className="h-8 w-8 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center">💡</div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">Highest Engagement Days</p>
                <p className="text-gray-600">Wednesdays and Fridays show 23% higher engagement</p>
              </div>
            </div>
            <div className="flex items-start space-x-3">
              <div className="h-8 w-8 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center">🎯</div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">Top Performing Reward</p>
                <p className="text-gray-600">Free Drink rewards have highest redemption rate</p>
              </div>
            </div>
            <div className="flex items-start space-x-3">
              <div className="h-8 w-8 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center">📈</div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">Growth Trend</p>
                <p className="text-gray-600">Month-over-month customer acquisition increased by 34%</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}