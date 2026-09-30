"use client";

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CustomerService, type Customer } from '@/services/customer.service';

export default function CustomersPage() {
  const [search, setSearch] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);

      CustomerService.list({ search: search || undefined, limit: 50 })
        .then((result) => {
          if (cancelled) return;
          setCustomers(result.customers);
        })
        .catch((cause: unknown) => {
          if (cancelled) return;
          setError(cause instanceof Error ? cause.message : 'Unable to load customers.');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search]);

  return (
    <div className="p-6">
      <div className="mb-6 flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Customers</h2>
          <p className="text-sm text-gray-600">Manage your customer relationships and track engagement</p>
        </div>
      </div>

      <div className="mb-6">
        <label htmlFor="customer-search" className="block text-sm font-medium text-gray-700 mb-1">
          Search customers
        </label>
        <div className="relative">
          <input
            id="customer-search"
            type="text"
            placeholder="Search by name, email, or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="block w-full rounded-md border-0 px-3 py-2 text-base text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
          />
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        {error ? (
          <div className="py-12 text-center">
            <p className="text-sm text-red-700">{error}</p>
            <div className="mt-4 flex justify-center">
              <Button variant="outline" onClick={() => setSearch('')}>
                Retry
              </Button>
            </div>
          </div>
        ) : loading ? (
          <div className="py-12 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-4" />
            <p className="text-gray-600">Loading customers...</p>
          </div>
        ) : customers.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-gray-500">No customers found.</p>
            <p className="mt-2 text-sm text-gray-400">
              Customers appear here as soon as someone takes part in one of your campaigns.
            </p>
          </div>
        ) : (
          <>
            <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
              <div className="grid grid-cols-6 gap-4 text-sm font-medium text-gray-600">
                <div>Customer</div>
                <div>Contact Info</div>
                <div>Joined</div>
                <div>Last Activity</div>
                <div>Engagement</div>
                <div>Status</div>
              </div>
            </div>

            <div className="divide-y divide-gray-200">
              {customers.map((customer) => (
                <div key={customer.id} className="px-6 py-4 hover:bg-gray-50">
                  <div className="grid grid-cols-6 gap-4">
                    <div className="flex items-center space-x-3">
                      <div className="h-10 w-10 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center">
                        {customer.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{customer.name}</p>
                      </div>
                    </div>

                    <div className="text-sm text-gray-600 space-y-1">
                      <p>{customer.email || '—'}</p>
                      <p>{customer.phone || '—'}</p>
                    </div>

                    <div className="text-sm text-gray-600">
                      {new Date(customer.createdAt).toLocaleDateString()}
                    </div>
                    <div className="text-sm text-gray-600">
                      {customer.lastActivityAt
                        ? new Date(customer.lastActivityAt).toLocaleDateString()
                        : new Date(customer.createdAt).toLocaleDateString()}
                    </div>

                    <div className="flex items-center space-x-3 text-sm">
                      <div className="flex items-center space-x-2 text-gray-500">
                        <span className="text-xs">🎁</span>
                        <span>{customer.participationCount}</span>
                      </div>
                      <div className="flex items-center space-x-2 text-gray-500">
                        <span className="text-xs">🎟️</span>
                        <span>{customer.redeemedCount}</span>
                      </div>
                    </div>

                    <div>
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          customer.status === 'active'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-blue-100 text-blue-800'
                        }`}
                      >
                        {customer.status === 'active' ? 'Active' : 'New'}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
