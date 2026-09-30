"use client";

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CouponService, type Coupon } from '@/services/coupon.service';

const STATUS_FILTERS = [
  { value: 'ALL', label: 'All' },
  { value: 'ISSUED', label: 'Issued' },
  { value: 'REDEEMED', label: 'Redeemed' },
  { value: 'EXPIRED', label: 'Expired' },
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number]['value'];

export default function CouponsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [redeemingId, setRedeemingId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);

    CouponService.list({ status, search: search || undefined, limit: 50 })
      .then((result) => setCoupons(result.coupons))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unable to load coupons.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, status]);

  const handleRedeem = async (couponId: string) => {
    setRedeemingId(couponId);
    setError(null);

    try {
      await CouponService.redeem(couponId);
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to redeem the coupon.');
    } finally {
      setRedeemingId(null);
    }
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Coupons</h2>
          <p className="text-sm text-gray-600">Track and manage coupon issuance and redemption</p>
        </div>
      </div>

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="coupon-search" className="block text-sm font-medium text-gray-700 mb-1">
            Search coupons
          </label>
          <input
            id="coupon-search"
            type="text"
            placeholder="Search by code, customer, reward, or campaign..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="block w-full rounded-md border-0 px-3 py-2 text-base text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
          />
        </div>

        <div>
          <label htmlFor="coupon-status" className="block text-sm font-medium text-gray-700 mb-1">
            Status
          </label>
          <select
            id="coupon-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className="block w-full rounded-md border-0 px-3 py-2 text-base text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
          >
            {STATUS_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border-l-4 border-red-400 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-4">
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-4" />
            <p className="text-gray-600">Loading coupons...</p>
          </div>
        ) : coupons.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500">No coupons found.</p>
            <p className="mt-2 text-sm text-gray-400">
              Coupons are issued automatically when a customer wins a reward.
            </p>
          </div>
        ) : (
          coupons.map((coupon) => (
            <div key={coupon.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center mb-2">
                    <div className="h-8 w-8 flex-shrink-0">
                      <div
                        className={`h-8 w-8 rounded-lg ${
                          coupon.status === 'issued'
                            ? 'bg-blue-100'
                            : coupon.status === 'redeemed'
                              ? 'bg-green-100'
                              : 'bg-gray-100'
                        } flex items-center justify-center text-sm font-medium`}
                      >
                        {coupon.status === 'issued' ? '🎫' : coupon.status === 'redeemed' ? '✅' : '⏰'}
                      </div>
                    </div>
                    <div className="ml-3">
                      <h3 className="text-lg font-medium text-gray-900">{coupon.code}</h3>
                      <p className="text-sm text-gray-600">{coupon.customerName}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-600">
                    <span className="font-medium">{coupon.rewardName}</span>
                    <span className="font-medium">{coupon.campaignName}</span>
                    <span>{new Date(coupon.issuedAt).toLocaleDateString()}</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        coupon.status === 'issued'
                          ? 'bg-blue-100 text-blue-800'
                          : coupon.status === 'redeemed'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {coupon.status.charAt(0).toUpperCase() + coupon.status.slice(1)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center space-x-3">
                  {coupon.status === 'issued' && (
                    <Button
                      size="sm"
                      onClick={() => handleRedeem(coupon.id)}
                      disabled={redeemingId === coupon.id}
                    >
                      {redeemingId === coupon.id ? 'Redeeming...' : 'Redeem'}
                    </Button>
                  )}
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-gray-200 text-sm text-gray-500 space-y-1">
                {coupon.expiresAt && (
                  <p>
                    <strong>Expires:</strong> {new Date(coupon.expiresAt).toLocaleDateString()}
                  </p>
                )}
                {coupon.redeemedAt && (
                  <p>
                    <strong>Redeemed:</strong> {new Date(coupon.redeemedAt).toLocaleDateString()}
                  </p>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
