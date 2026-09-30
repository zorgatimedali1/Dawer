"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export default function CustomersPage() {
  const [search, setSearch] = useState('');

  const customers = [
    {
      id: 'cust_1',
      name: 'Alex Johnson',
      email: 'alex.johnson@email.com',
      phone: '(555) 123-4567',
      firstVisit: '2026-09-15',
      lastVisit: '2026-09-25',
      totalVisits: 8,
      totalRewards: 3,
      totalCoupons: 2,
      status: 'active',
    },
    {
      id: 'cust_2',
      name: 'Maria Garcia',
      email: 'maria.garcia@email.com',
      phone: '(555) 987-6543',
      firstVisit: '2026-09-10',
      lastVisit: '2026-09-24',
      totalVisits: 5,
      totalRewards: 2,
      totalCoupons: 1,
      status: 'active',
    },
    {
      id: 'cust_3',
      name: 'James Wilson',
      email: 'james.wilson@email.com',
      phone: '(555) 456-7890',
      firstVisit: '2026-09-20',
      lastVisit: '2026-09-25',
      totalVisits: 3,
      totalRewards: 1,
      totalCoupons: 0,
      status: 'new',
    },
  ];

  const filteredCustomers = customers.filter((customer) => {
    const matchesSearch =
      customer.name.toLowerCase().includes(search.toLowerCase()) ||
      customer.email.toLowerCase().includes(search.toLowerCase()) ||
      customer.phone.includes(search);

    return matchesSearch;
  });

  const handleAddCustomer = () => {
    console.log('Add customer clicked');
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Customers</h2>
          <p className="text-sm text-gray-600">Manage your customer relationships and track engagement</p>
        </div>
        <div>
          <Button variant="outline" onClick={handleAddCustomer}>Add Customer</Button>
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
        {filteredCustomers.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-gray-500">No customers found.</p>
          </div>
        ) : (
          <>
            <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
              <div className="grid grid-cols-6 gap-4 text-sm font-medium text-gray-600">
                <div>Customer</div>
                <div>Contact Info</div>
                <div>First Visit</div>
                <div>Last Visit</div>
                <div>Engagement</div>
                <div>Status</div>
              </div>
            </div>

            <div className="divide-y divide-gray-200">
              {filteredCustomers.map((customer) => (
                <div key={customer.id} className="px-6 py-4 hover:bg-gray-50">
                  <div className="grid grid-cols-6 gap-4">
                    <div className="flex items-center space-x-3">
                      <div className="h-10 w-10 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center">
                        {customer.name.charAt(0)}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{customer.name}</p>
                      </div>
                    </div>

                    <div className="text-sm text-gray-600 space-y-1">
                      <p>{customer.email}</p>
                      <p>{customer.phone}</p>
                    </div>

                    <div className="text-sm text-gray-600">{customer.firstVisit}</div>
                    <div className="text-sm text-gray-600">{customer.lastVisit}</div>

                    <div className="flex items-center space-x-3 text-sm">
                      <div className="flex items-center space-x-2 text-gray-500">
                        <span className="text-xs">🎁</span>
                        <span>{customer.totalRewards}</span>
                      </div>
                      <div className="flex items-center space-x-2 text-gray-500">
                        <span className="text-xs">🎟️</span>
                        <span>{customer.totalCoupons}</span>
                      </div>
                    </div>

                    <div>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${customer.status === 'active' ? 'bg-green-100 text-green-800' : customer.status === 'new' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'}`}>
                        {customer.status.charAt(0).toUpperCase() + customer.status.slice(1)}
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