"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export default function CouponsPage() {
  const [search, setSearch] = useState('');

  const coupons = [
    {
      id: 'cpn_1',
      code: 'SUMMER5',
      customerName: 'Alex Johnson',
      rewardName: '5% OFF Coupon',
      campaignName: 'Summer Splash Campaign',
      status: 'issued',
      issuedDate: '2026-09-20',
      expiresAt: '2026-10-20',
    },
    {
      id: 'cpn_2',
      code: 'SUMMER10',
      customerName: 'Maria Garcia',
      rewardName: '10% OFF Coupon',
      campaignName: 'Summer Splash Campaign',
      status: 'redeemed',
      issuedDate: '2026-09-18',
      expiresAt: '2026-10-18',
      redeemedAt: '2026-09-22',
    },
    {
      id: 'cpn_3',
      code: 'FREEDRINK',
      customerName: 'James Wilson',
      rewardName: 'Free Drink',
      campaignName: 'Summer Splash Campaign',
      status: 'expired',
      issuedDate: '2026-09-10',
      expiresAt: '2026-09-25',
    },
  ];

  const filteredCoupons = coupons.filter(
    (coupon) =>
      coupon.code.toLowerCase().includes(search.toLowerCase()) ||
      coupon.customerName.toLowerCase().includes(search.toLowerCase()) ||
      coupon.rewardName.toLowerCase().includes(search.toLowerCase()) ||
      coupon.campaignName.toLowerCase().includes(search.toLowerCase())
  );

  const handleIssueCoupon = () => {
    console.log('Issue coupon clicked');
  };

  const handleRedeemCoupon = () => {
    console.log('Redeem coupon clicked');
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Coupons</h2>
          <p className="text-sm text-gray-600">Track and manage coupon issuance and redemption</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={handleIssueCoupon}>Issue Coupon</Button>
        </div>
      </div>

      <div className="mb-6">
        <label htmlFor="coupon-search" className="block text-sm font-medium text-gray-700 mb-1">
          Search coupons
        </label>
        <div className="relative">
          <input
            id="coupon-search"
            type="text"
            placeholder="Search by code, customer, reward, or campaign..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="block w-full rounded-md border-0 px-3 py-2 text-base text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
          />
        </div>
      </div>

      <div className="space-y-4">
        {filteredCoupons.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500">No coupons found.</p>
          </div>
        ) : (
          filteredCoupons.map((coupon) => (
            <div key={coupon.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center mb-2">
                    <div className="h-8 w-8 flex-shrink-0">
                      <div className={`h-8 w-8 rounded-lg ${coupon.status === 'issued' ? 'bg-blue-100' : coupon.status === 'redeemed' ? 'bg-green-100' : coupon.status === 'expired' ? 'bg-gray-100' : 'bg-red-100'} flex items-center justify-center text-sm font-medium`}>
                        {coupon.status === 'issued' ? '🎫' : coupon.status === 'redeemed' ? '✅' : coupon.status === 'expired' ? '⏰' : '❌'}
                      </div>
                    </div>
                    <div className="ml-3">
                      <h3 className="text-lg font-medium text-gray-900">{coupon.code}</h3>
                      <p className="text-sm text-gray-600">{coupon.customerName}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center space-x-4 text-sm text-gray-600">
                    <div>
                      <span className="font-medium">{coupon.rewardName}</span>
                    </div>
                    <div>
                      <span className="font-medium">{coupon.campaignName}</span>
                    </div>
                    <div>
                      <span className="font-medium">{coupon.issuedDate}</span>
                    </div>
                    <div>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${coupon.status === 'issued' ? 'bg-blue-100 text-blue-800' : coupon.status === 'redeemed' ? 'bg-green-100 text-green-800' : coupon.status === 'expired' ? 'bg-gray-100 text-gray-800' : 'bg-red-100 text-red-800'}`}>
                        {coupon.status.charAt(0).toUpperCase() + coupon.status.slice(1)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-3">
                  <Button variant="outline" size="sm">View Details</Button>
                  {coupon.status === 'issued' && <Button onClick={handleRedeemCoupon}>Redeem</Button>}
                  <Button variant="destructive" size="sm">Cancel</Button>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-gray-200 text-sm text-gray-500 space-y-1">
                <p><strong>Expires:</strong> {new Date(coupon.expiresAt).toLocaleDateString()}</p>
                {coupon.redeemedAt && (
                  <p><strong>Redeemed:</strong> {new Date(coupon.redeemedAt).toLocaleDateString()}</p>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}