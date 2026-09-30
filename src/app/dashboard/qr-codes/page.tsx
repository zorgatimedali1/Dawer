"use client";

import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { CampaignService, type Campaign } from '@/services/campaign.service';
import { QrCodeService, type QrCode } from '@/services/qr.service';

export default function QRCodesPage() {
  const [search, setSearch] = useState('');
  const [qrCodes, setQrCodes] = useState<QrCode[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [formCampaignId, setFormCampaignId] = useState('');
  const [formName, setFormName] = useState('');
  const [formLocation, setFormLocation] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([QrCodeService.list(), CampaignService.getCampaigns({ limit: 100 })])
      .then(([qrList, campaignList]) => {
        setQrCodes(qrList);
        setCampaigns(campaignList);
        setFormCampaignId(campaignList[0]?.id ?? '');
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unable to load QR codes.'))
      .finally(() => setLoading(false));
  }, []);

  const filteredQRCodes = qrCodes.filter(
    (qrCode) =>
      qrCode.name.toLowerCase().includes(search.toLowerCase()) ||
      qrCode.campaignName.toLowerCase().includes(search.toLowerCase()) ||
      qrCode.location.toLowerCase().includes(search.toLowerCase()),
  );

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!formCampaignId) return;

    setSaving(true);
    setError(null);

    try {
      const created = await QrCodeService.create({
        campaignId: formCampaignId,
        name: formName,
        location: formLocation,
      });
      setQrCodes((current) => [created, ...current]);
      setFormName('');
      setFormLocation('');
      setShowForm(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create the QR code.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (qrCode: QrCode) => {
    setError(null);

    try {
      const updated = await QrCodeService.update(qrCode.id, { active: !qrCode.active });
      setQrCodes((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update the QR code.');
    }
  };

  const handleCopy = async (qrCode: QrCode) => {
    try {
      await navigator.clipboard.writeText(qrCode.url);
      setCopiedId(qrCode.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setError('Clipboard access was denied.');
    }
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">QR Codes</h2>
          <p className="text-sm text-gray-600">Track and manage QR codes for your campaigns</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => setShowForm((value) => !value)}>
            {showForm ? 'Close' : 'Create QR Code'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border-l-4 border-red-400 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {showForm && (
        <form onSubmit={handleCreate} className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="qr-campaign" className="block text-sm font-medium text-gray-700 mb-1">
                Campaign
              </label>
              <select
                id="qr-campaign"
                value={formCampaignId}
                onChange={(e) => setFormCampaignId(e.target.value)}
                required
                className="block w-full rounded-md border-0 px-3 py-2 text-base text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm"
              >
                <option value="">Select a campaign</option>
                {campaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="qr-name" className="block text-sm font-medium text-gray-700 mb-1">
                Name
              </label>
              <input
                id="qr-name"
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Main Entrance"
                className="block w-full rounded-md border-0 px-3 py-2 text-base text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm"
              />
            </div>

            <div>
              <label htmlFor="qr-location" className="block text-sm font-medium text-gray-700 mb-1">
                Location
              </label>
              <input
                id="qr-location"
                type="text"
                value={formLocation}
                onChange={(e) => setFormLocation(e.target.value)}
                placeholder="Counter"
                className="block w-full rounded-md border-0 px-3 py-2 text-base text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm"
              />
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <Button type="submit" disabled={saving || !formCampaignId}>
              {saving ? 'Creating...' : 'Create'}
            </Button>
          </div>
        </form>
      )}

      <div className="mb-6">
        <label htmlFor="qr-search" className="block text-sm font-medium text-gray-700 mb-1">
          Search QR codes
        </label>
        <input
          id="qr-search"
          type="text"
          placeholder="Search by name or campaign..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="block w-full rounded-md border-0 px-3 py-2 text-base text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
        />
      </div>

      <div className="space-y-4">
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-4" />
            <p className="text-gray-600">Loading QR codes...</p>
          </div>
        ) : filteredQRCodes.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500">No QR codes found.</p>
            <p className="mt-2 text-sm text-gray-400">
              Create a QR code to give customers a way to open your campaign in-store.
            </p>
          </div>
        ) : (
          filteredQRCodes.map((qrCode) => (
            <div key={qrCode.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center mb-2">
                    <div className="h-8 w-8 flex-shrink-0">
                      <div
                        className={`h-8 w-8 rounded-lg ${
                          qrCode.active ? 'bg-green-100' : 'bg-gray-100'
                        } flex items-center justify-center text-sm font-medium`}
                      >
                        {qrCode.active ? '🟢' : '⚪'}
                      </div>
                    </div>
                    <div className="ml-3">
                      <h3 className="text-lg font-medium text-gray-900">{qrCode.name}</h3>
                      <p className="text-sm text-gray-600">
                        {qrCode.campaignName}
                        {qrCode.location ? ` · ${qrCode.location}` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-600">
                    <div>
                      <span className="font-medium">{qrCode.campaignParticipations}</span>
                      <span> campaign participants</span>
                    </div>
                    <div className="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs text-slate-700">
                      {qrCode.url}
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-3">
                  <Button variant="outline" size="sm" onClick={() => handleCopy(qrCode)}>
                    {copiedId === qrCode.id ? 'Copied' : 'Copy link'}
                  </Button>
                  <Button
                    variant={qrCode.active ? 'destructive' : 'secondary'}
                    size="sm"
                    onClick={() => handleToggle(qrCode)}
                  >
                    {qrCode.active ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-gray-200 text-sm text-gray-500">
                <p>
                  <strong>Created:</strong> {new Date(qrCode.createdAt).toLocaleDateString()}
                  <span className="ml-4 font-mono text-xs">{qrCode.publicCode}</span>
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
