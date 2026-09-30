"use client";

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';

export default function SettingsPage() {
  const [tab, setTab] = useState('profile');
  const [loading, setLoading] = useState(false);

  // Integration states
  const [googleMaps, setGoogleMaps] = useState({ placeId: '', apiKey: '' });
  const [facebook, setFacebook] = useState({ pageId: '', accessToken: '' });
  const [instagram, setInstagram] = useState({ instagramAccountId: '', accessToken: '' });
  const [showFacebook, setShowFacebook] = useState(false);
  const [showInstagram, setShowInstagram] = useState(false);

  // Fetch existing integrations
  useEffect(() => {
    const fetchIntegrations = async () => {
      setLoading(true);
      try {
        // Simulate API call - replace with actual API endpoint
        // const response = await fetch('/api/integrations');
        // const data = await response.json();

        // Mock data for demonstration
        const mockData = {
          googleMaps: { placeId: 'ChIJN1t_tDeuEmsRUsoyG83frY4', apiKey: 'AIza...' },
          facebook: { pageId: '1234567890', accessToken: 'EAAC...' },
          instagram: { instagramAccountId: '17841400000000000', accessToken: 'EAAC...' }
        };

        setGoogleMaps(mockData.googleMaps);
        setFacebook(mockData.facebook);
        setInstagram(mockData.instagram);
        setShowFacebook(true);
        setShowInstagram(true);
      } catch (error) {
        console.error('Failed to fetch integrations:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchIntegrations();
  }, []);

  const handleSaveGoogleMaps = async () => {
    setLoading(true);
    try {
      // Simulate API call
      // await fetch('/api/integrations/google-maps', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify(googleMaps)
      // });
      console.log('Saving Google Maps config:', googleMaps);
      alert('Google Maps configuration saved!');
    } catch (error) {
      console.error('Failed to save Google Maps config:', error);
      alert('Failed to save configuration');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveFacebook = async () => {
    setLoading(true);
    try {
      // await fetch('/api/integrations/facebook', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify(facebook)
      // });
      console.log('Saving Facebook config:', facebook);
      alert('Facebook configuration saved!');
    } catch (error) {
      console.error('Failed to save Facebook config:', error);
      alert('Failed to save configuration');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveInstagram = async () => {
    setLoading(true);
    try {
      // await fetch('/api/integrations/instagram', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify(instagram)
      // });
      console.log('Saving Instagram config:', instagram);
      alert('Instagram configuration saved!');
    } catch (error) {
      console.error('Failed to save Instagram config:', error);
      alert('Failed to save configuration');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Settings</h2>
          <p className="text-sm text-gray-600">Manage your account, preferences, and security settings</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => console.log('Save changes')}>
            Save Changes
          </Button>
        </div>
      </div>

      <div className="mb-6 flex border-b border-gray-200">
        {['profile', 'business', 'notifications', 'security', 'branding', 'integrations'].map((tabKey) => (
          <button
            key={tabKey}
            onClick={() => setTab(tabKey)}
            className={`px-4 py-2 text-sm font-medium ${
              tab === tabKey ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tabKey === 'profile' && 'Profile'}
            {tabKey === 'business' && 'Business'}
            {tabKey === 'notifications' && 'Notifications'}
            {tabKey === 'security' && 'Security'}
            {tabKey === 'branding' && 'Branding'}
            {tabKey === 'integrations' && 'Integrations'}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Profile Information</h3>
            <p className="text-gray-600">John Doe • john.doe@business.com</p>
          </div>
        </div>
      )}

      {tab === 'business' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Business Information</h3>
            <p className="text-gray-600">Beachside Cafe • Miami, FL</p>
          </div>
        </div>
      )}

      {tab === 'notifications' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Notification Preferences</h3>
            <div className="space-y-4">
              <div className="p-3 bg-gray-50 rounded-lg">
                <span className="text-sm font-medium text-gray-500">Email Updates</span>
                <span className="text-sm font-medium text-gray-500 ml-2">✓ Enabled</span>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <span className="text-sm font-medium text-gray-500">SMS Alerts</span>
                <span className="text-sm font-medium text-gray-500 ml-2">✗ Disabled</span>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <span className="text-sm font-medium text-gray-500">Push Notifications</span>
                <span className="text-sm font-medium text-gray-500 ml-2">✓ Enabled</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'security' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Account Security</h3>
            <div className="space-y-4">
              <div className="p-3 bg-gray-50 rounded-lg">
                <span className="text-sm font-medium text-gray-500">Password</span>
                <span className="text-sm font-medium text-gray-500 ml-2">Last changed: Sep 1, 2026</span>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <span className="text-sm font-medium text-gray-500">Two-Factor Auth</span>
                <span className="text-sm font-medium text-gray-500 ml-2">✗ Disabled</span>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <span className="text-sm font-medium text-gray-500">Active Sessions</span>
                <span className="text-sm font-medium text-gray-500 ml-2">2 active</span>
              </div>
            </div>

            <div className="mt-4 flex gap-3">
              <Button variant="outline" onClick={() => console.log('Change password')}>
                Change Password
              </Button>
              <Button variant="outline" onClick={() => console.log('Enable 2FA')}>
                Enable Two-Factor Auth
              </Button>
              <Button variant="destructive" onClick={() => console.log('Sign out elsewhere')}>
                Sign Out Elsewhere
              </Button>
            </div>
          </div>
        </div>
      )}

      {tab === 'branding' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Branding & Appearance</h3>
            <div className="space-y-4">
              <div className="p-3 bg-gray-50 rounded-lg">
                <span className="text-sm font-medium text-gray-500">Primary Color</span>
                <input type="color" value="#4f46e5" className="ml-2 w-10 h-10" />
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <span className="text-sm font-medium text-gray-500">Secondary Color</span>
                <input type="color" value="#10b981" className="ml-2 w-10 h-10" />
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <span className="text-sm font-medium text-gray-500">Logo</span>
                <input type="file" accept="image/*" className="ml-2 block w-full" />
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'integrations' && (
        <div className="space-y-6">
          {/* Google Maps / Google Business Section */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              Enregistrer la configuration Google Maps / Google Business
            </h3>
            {loading ? (
              <p className="text-gray-500">Loading configuration...</p>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Google Place ID
                  </label>
                  <input
                    type="text"
                    value={googleMaps.placeId}
                    onChange={(e) => setGoogleMaps({ ...googleMaps, placeId: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="Enter your Google Place ID"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Google API Key
                  </label>
                  <input
                    type="text"
                    value={googleMaps.apiKey}
                    onChange={(e) => setGoogleMaps({ ...googleMaps, apiKey: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="Enter your Google API Key"
                  />
                </div>
                <Button
                  variant="default"
                  onClick={handleSaveGoogleMaps}
                  className="w-full"
                >
                  Save Google Maps Configuration
                </Button>
              </div>
            )}
          </div>

          {/* Facebook Section - only show if added in database */}
          {showFacebook && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mt-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                Enregistrer la configuration Facebook
              </h3>
              {loading ? (
                <p className="text-gray-500">Loading configuration...</p>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Facebook Page ID
                    </label>
                    <input
                      type="text"
                      value={facebook.pageId}
                      onChange={(e) => setFacebook({ ...facebook, pageId: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="Enter your Facebook Page ID"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Access Token
                    </label>
                    <input
                      type="text"
                      value={facebook.accessToken}
                      onChange={(e) => setFacebook({ ...facebook, accessToken: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="Enter your Facebook Access Token"
                    />
                  </div>
                  <Button
                    variant="default"
                    onClick={handleSaveFacebook}
                    className="w-full"
                  >
                    Save Facebook Configuration
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Instagram Section - only show if added in database */}
          {showInstagram && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mt-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                Enregistrer la configuration Instagram
              </h3>
              {loading ? (
                <p className="text-gray-500">Loading configuration...</p>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Instagram Business Account ID
                    </label>
                    <input
                      type="text"
                      value={instagram.instagramAccountId}
                      onChange={(e) => setInstagram({ ...instagram, instagramAccountId: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="Enter your Instagram Business Account ID"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Access Token
                    </label>
                    <input
                      type="text"
                      value={instagram.accessToken}
                      onChange={(e) => setInstagram({ ...instagram, accessToken: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="Enter your Instagram Access Token"
                    />
                  </div>
                  <Button
                    variant="default"
                    onClick={handleSaveInstagram}
                    className="w-full"
                  >
                    Save Instagram Configuration
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}