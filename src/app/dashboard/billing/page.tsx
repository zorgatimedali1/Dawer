"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export default function BillingPage() {
  const [tab, setTab] = useState('overview');

  const subscription = {
    plan: 'Professional',
    status: 'active',
    amount: 49.99,
    currency: 'USD',
    interval: 'month',
    nextBillingDate: '2026-10-05',
  };

  const recentInvoices = [
    { id: 'inv_001', date: '2026-09-05', amount: 49.99, status: 'paid' },
    { id: 'inv_002', date: '2026-08-05', amount: 49.99, status: 'paid' },
    { id: 'inv_003', date: '2026-07-05', amount: 49.99, status: 'paid' },
  ];

  const handleUpdatePaymentMethod = () => console.log('Update payment method');
  const handleChangePlan = () => console.log('Change plan');
  const handleDownloadInvoice = () => console.log('Download invoice');
  const handleViewInvoice = () => console.log('View invoice');
  const handleAddPaymentMethod = () => console.log('Add payment method');

  return (
    <div className="p-6">
      <div className="mb-6 flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Billing</h2>
          <p className="text-sm text-gray-600">Manage your subscription, payments, and usage</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={handleUpdatePaymentMethod}>Update Payment Method</Button>
          <Button onClick={handleChangePlan}>Change Plan</Button>
        </div>
      </div>

      <div className="mb-6 flex border-b border-gray-200">
        {['overview', 'usage', 'invoices', 'history'].map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium ${
              tab === key ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {key === 'overview' && 'Overview'}
            {key === 'usage' && 'Usage'}
            {key === 'invoices' && 'Invoices'}
            {key === 'history' && 'Payment History'}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Current Subscription</h3>
            <p className="text-gray-600">Professional Plan • Active • ${subscription.amount}/month</p>
          </div>
        </div>
      )}

      {tab === 'usage' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Usage Information</h3>
            <p className="text-gray-600">Campaigns: 3/10 • Customers: 892/10000 • Emails: 1240/5000</p>
          </div>
        </div>
      )}

      {tab === 'invoices' && (
        <div className="space-y-4">
          {recentInvoices.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500">No invoices found.</p>
            </div>
          ) : (
            recentInvoices.map((invoice) => (
              <div key={invoice.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center mb-2">
                      <div className="h-8 w-8 flex-shrink-0">
                        <div className={`h-8 w-8 rounded-lg ${invoice.status === 'paid' ? 'bg-green-100' : invoice.status === 'pending' ? 'bg-yellow-100' : 'bg-red-100'} flex items-center justify-center text-sm font-medium`}>
                          {invoice.status === 'paid' ? '✅' : invoice.status === 'pending' ? '⏳' : '❌'}
                        </div>
                      </div>
                      <div className="ml-3">
                        <h3 className="text-lg font-medium text-gray-900">#{invoice.id}</h3>
                        <p className="text-sm text-gray-600">{invoice.date}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center space-x-3">
                      <p className="text-sm font-medium text-gray-500">Date</p>
                      <p className="text-sm font-medium text-gray-500">{invoice.date}</p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-3">
                    <p className="text-sm font-medium text-gray-500">Amount</p>
                    <p className="text-lg font-bold text-gray-900">{subscription.currency}{invoice.amount}</p>
                    <div className="mt-2 flex items-center space-x-3">
                      <p className="text-sm font-medium text-gray-500">Status</p>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${invoice.status === 'paid' ? 'bg-green-100 text-green-800' : invoice.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>
                        {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-gray-200 flex gap-3">
                  <Button variant="outline" size="sm" onClick={handleDownloadInvoice}>Download PDF</Button>
                  <Button variant="outline" size="sm" onClick={handleViewInvoice}>View Details</Button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'history' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Payment Methods</h3>
          <div className="space-y-3">
            <div className="p-3 bg-gray-50 rounded-lg">
              <span className="text-sm font-medium text-gray-500">Visa •••• 4242</span>
              <span className="text-sm font-medium text-gray-500 ml-2">Expires 12/26 • Default</span>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg">
              <span className="text-sm font-medium text-gray-500">Bank Account •••• 6789</span>
              <span className="text-sm font-medium text-gray-500 ml-2">Checking Account</span>
            </div>
          </div>

          <div className="mt-4">
            <Button onClick={handleAddPaymentMethod}>Add Payment Method</Button>
          </div>
        </div>
      )}
    </div>
  );
}