"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export default function QRCodesPage() {
  const [search, setSearch] = useState('');

  const qrCodes = [
    {
      id: 'qrc_1',
      name: 'Main Entrance',
      campaignName: 'Summer Splash Campaign',
      status: 'active',
      scans: 124,
      starts: 98,
      completions: 76,
      rewards: 45,
      redemptions: 32,
    },
    {
      id: 'qrc_2',
      name: 'Table Tents',
      campaignName: 'Summer Splash Campaign',
      status: 'active',
      scans: 87,
      starts: 65,
      completions: 52,
      rewards: 31,
      redemptions: 24,
    },
    {
      id: 'qrc_3',
      name: 'Window Display',
      campaignName: 'Summer Splash Campaign',
      status: 'inactive',
      scans: 45,
      starts: 32,
      completions: 28,
      rewards: 16,
      redemptions: 12,
    },
  ];

  const filteredQRCodes = qrCodes.filter(
    (qrCode) =>
      qrCode.name.toLowerCase().includes(search.toLowerCase()) ||
      qrCode.campaignName.toLowerCase().includes(search.toLowerCase())
  );

  const handleCreateQrCode = () => console.log('Create QR code');

  return (
    <div className="p-6">
      <div className="mb-6 flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">QR Codes</h2>
          <p className="text-sm text-gray-600">Track and manage QR codes for your campaigns</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={handleCreateQrCode}>Create QR Code</Button>
        </div>
      </div>

      <div className="mb-6">
        <label htmlFor="qr-search" className="block text-sm font-medium text-gray-700 mb-1">
          Search QR codes
        </label>
        <div className="relative">
          <input
            id="qr-search"
            type="text"
            placeholder="Search by name or campaign..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="block w-full rounded-md border-0 px-3 py-2 text-base text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
          />
        </div>
      </div>

      <div className="space-y-4">
        {filteredQRCodes.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500">No QR codes found.</p>
          </div>
        ) : (
          filteredQRCodes.map((qrCode) => (
            <div key={qrCode.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center mb-2">
                    <div className="h-8 w-8 flex-shrink-0">
                      <div className={`h-8 w-8 rounded-lg ${qrCode.status === 'active' ? 'bg-green-100' : qrCode.status === 'inactive' ? 'bg-gray-100' : 'bg-blue-100'} flex items-center justify-center text-sm font-medium`}>
                        {qrCode.status === 'active' ? '🟢' : qrCode.status === 'inactive' ? '⚪' : '🔵'}
                      </div>
                    </div>
                    <div className="ml-3">
                      <h3 className="text-lg font-medium text-gray-900">{qrCode.name}</h3>
                      <p className="text-sm text-gray-600">{qrCode.campaignName}</p>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center space-x-4 text-sm text-gray-600">
                    <div>
                      <span className="font-medium">{qrCode.scans}</span>
                      <span> total scans</span>
                    </div>
                    <div>
                      <span className="font-medium">{qrCode.starts}</span>
                      <span> campaign starts</span>
                    </div>
                    <div>
                      <span className="font-medium">{qrCode.completions}</span>
                      <span> game completions</span>
                    </div>
                    <div>
                      <span className="font-medium">{qrCode.rewards}</span>
                      <span> rewards awarded</span>
                    </div>
                    <div>
                      <span className="font-medium">{qrCode.redemptions}</span>
                      <span> coupon redemptions</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-3">
                  <Button variant="outline" size="sm">View Details</Button>
                  <Button variant="outline" size="sm">Download</Button>
                  <Button variant={qrCode.status === 'active' ? 'destructive' : 'secondary'} size="sm">
                    {qrCode.status === 'active' ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-gray-200 text-sm text-gray-500 space-y-1">
                <p><strong>Created:</strong> {new Date('2026-09-01').toLocaleDateString()}</p>
                <p><strong>Expires:</strong> {new Date('2026-09-30').toLocaleDateString()}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}