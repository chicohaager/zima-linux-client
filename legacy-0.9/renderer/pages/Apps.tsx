import React, { useEffect, useState } from 'react';
import { useAppStore } from '../store';
import { useSMB } from '../hooks/useSMB';

interface ZimaOSApp {
  id: string;
  name: string;
  icon: string;
  url: string;
  port?: number;
}

export const AppsPage: React.FC = () => {
  const { selectedDevice } = useAppStore();
  const { discoverShares } = useSMB();
  const [loading, setLoading] = useState(true);
  const [apps, setApps] = useState<ZimaOSApp[]>([]);

  useEffect(() => {
    if (selectedDevice) {
      loadShares();
      loadApps();
    }
  }, [selectedDevice]); // loadShares and loadApps are stable and don't need to be in deps

  const loadShares = async () => {
    if (!selectedDevice) return;

    setLoading(true);
    try {
      await discoverShares(selectedDevice.ipAddress);
    } finally {
      setLoading(false);
    }
  };

  const loadApps = async () => {
    if (!selectedDevice) return;

    try {
      console.log('Loading apps from ZimaOS API...');
      console.log('Auth token:', selectedDevice.authToken ? 'Present' : 'Missing');

      // If we have auth token, use it to get Docker apps
      if (selectedDevice.authToken) {
        const appsFromAPI = await fetchDockerApps(selectedDevice.ipAddress, selectedDevice.authToken);
        if (appsFromAPI.length > 0) {
          setApps(appsFromAPI);
          return;
        }
      }

      // No auth token or API failed - show default ZimaOS apps
      console.log('No auth token or API failed, showing default ZimaOS apps...');
      const defaultApps: ZimaOSApp[] = [];

      // Add ZimaOS Dashboard - main entry point
      defaultApps.push({
        id: 'zimaos-dashboard',
        name: 'ZimaOS',
        icon: '🏠',
        url: `http://${selectedDevice.ipAddress}`,
        port: 80,
      });

      // Add Files app - opens ZimaOS Files module directly
      defaultApps.push({
        id: 'files-browser',
        name: 'Files',
        icon: '📁',
        url: `http://${selectedDevice.ipAddress}/#/files`,
        port: 80,
      });

      // Try to get SMB shares from device (if available from scan)
      if (selectedDevice.shares && selectedDevice.shares.length > 0) {
        console.log(`Adding ${selectedDevice.shares.length} SMB shares from device`);
        for (const share of selectedDevice.shares) {
          defaultApps.push({
            id: `smb-${share.name}`,
            name: share.name,
            icon: '📂',
            url: `smb://${selectedDevice.ipAddress}/${share.name}`,
          });
        }
      } else {
        // Discover shares manually if not available
        console.log('No shares in device object, discovering manually...');
        const sharesResult = await window.electron.smb.discoverShares(selectedDevice.ipAddress);
        console.log('SMB shares result:', sharesResult);

        if (sharesResult.success && sharesResult.data) {
          for (const share of sharesResult.data) {
            defaultApps.push({
              id: `smb-${share.name}`,
              name: share.name,
              icon: '📂',
              url: `smb://${selectedDevice.ipAddress}/${share.name}`,
            });
          }
        }
      }

      console.log('Using default apps:', defaultApps);
      setApps(defaultApps);
    } catch (error) {
      console.error('Failed to load apps:', error);

      // Even on error, show at least the dashboard
      setApps([
        {
          id: 'zimaos-dashboard',
          name: 'ZimaOS',
          icon: '🏠',
          url: `http://${selectedDevice.ipAddress}`,
          port: 80,
        }
      ]);
    }
  };

  const getAppIcon = (app: any): string => {
    // If app has an icon URL/emoji, use it
    if (app.icon && app.icon.length <= 2) return app.icon;

    // Otherwise, return default based on name
    const name = app.name?.toLowerCase() || '';
    if (name.includes('storage')) return '📦';
    if (name.includes('backup')) return '💾';
    if (name.includes('peer') || name.includes('drop')) return '📤';
    if (name.includes('file')) return '📁';
    if (name.includes('media') || name.includes('plex') || name.includes('jellyfin')) return '🎬';
    if (name.includes('photo')) return '📷';
    if (name.includes('music')) return '🎵';
    return '📱'; // Default app icon
  };

  const extractPort = (url: string): number | undefined => {
    const match = url.match(/:(\d+)/);
    return match ? parseInt(match[1]) : undefined;
  };

  const fetchDockerApps = async (deviceIP: string, token: string): Promise<ZimaOSApp[]> => {
    try {
      console.log('Fetching Docker apps with token:', token.substring(0, 50) + '...');

      // Use the correct CasaOS API endpoint: /v2/app_management/compose
      const response = await fetch(`http://${deviceIP}/v2/app_management/compose`, {
        method: 'GET',
        headers: {
          'Authorization': token,
          'Content-Type': 'application/json',
        },
      });

      console.log('API response status:', response.status);

      // Get response body
      const responseText = await response.text();

      if (!response.ok) {
        console.error('API error response:', responseText);
        try {
          const errorJson = JSON.parse(responseText);
          console.error('API error details:', errorJson);
        } catch (e) {
          // Not JSON, already logged as text
        }
        return [];
      }

      // Parse successful response
      try {
        const data = JSON.parse(responseText);
        console.log('Docker apps response:', data);

        // The response format is:
        // { data: { "app-id": { store_info: {...}, compose: {...}, status: "running" } } }
        if (data.data && typeof data.data === 'object') {
          const dockerApps: ZimaOSApp[] = [];

          // Iterate over the app IDs
          for (const [appId, appData] of Object.entries<any>(data.data)) {
            const storeInfo = appData.store_info || {};
            const compose = appData.compose || {};

            // Extract title (it's an object with language keys)
            const title = storeInfo.title?.en_us || storeInfo.title?.en || compose.name || appId;

            // Get icon URL or use emoji fallback
            const icon = storeInfo.icon || getAppIcon({ name: title });

            // Build web UI URL - use deviceIP instead of hostname
            const portMap = storeInfo.port_map || '';
            const scheme = storeInfo.scheme || 'http';

            // Build the URL
            let webUrl = '';
            if (portMap) {
              webUrl = `${scheme}://${deviceIP}:${portMap}`;
            } else {
              // No port map, try to find port from compose
              webUrl = `http://${deviceIP}`;
            }

            console.log(`App ${appId}: ${title} -> ${webUrl}`);

            dockerApps.push({
              id: appId,
              name: title,
              icon: icon,
              url: webUrl,
              port: portMap ? parseInt(portMap) : undefined,
            });
          }

          // Add Files app - opens ZimaOS Files module directly
          dockerApps.push({
            id: 'files-browser',
            name: 'Files',
            icon: '📁',
            url: `http://${deviceIP}/modules/icewhale_files/#/files`,
            port: 80,
          });

          return dockerApps;
        }
      } catch (parseError) {
        console.error('Failed to parse Docker apps response:', parseError);
      }
    } catch (error) {
      console.error('Failed to fetch Docker apps:', error);
    }

    return [];
  };

  if (!selectedDevice) {
    return (
      <div className="px-4 py-8 flex items-center justify-center min-h-[60vh]">
        <p className="text-zima-text-secondary text-lg">No device selected</p>
      </div>
    );
  }

  return (
    <div className="px-4 py-8 pb-24">
      <div className="max-w-md mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <p className="text-xs font-semibold text-zima-text-secondary tracking-wider mb-2">APPS</p>
          <h1 className="text-3xl font-bold text-zima-blue mb-1">
            View and use your
          </h1>
          <p className="text-3xl font-bold text-zima-blue">
            docker apps.
          </p>
        </div>

        {/* Main Card */}
        <div className="bg-white rounded-3xl shadow-lg p-6">
          <h2 className="text-xl font-semibold text-zima-text-primary mb-6">App</h2>

          {/* Apps Grid */}
          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin w-10 h-10 border-4 border-zima-blue border-t-transparent rounded-full mx-auto mb-4"></div>
              <p className="text-sm text-zima-text-secondary">Loading...</p>
            </div>
          ) : apps.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-zima-text-secondary">No apps available</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-6">
              {apps.map((app) => (
                <div
                  key={app.id}
                  onClick={() => window.electron.app.open(app.url, selectedDevice?.authToken)}
                  className="flex flex-col items-center cursor-pointer hover:opacity-70 transition-opacity"
                >
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-2 overflow-hidden bg-gray-50">
                    {app.icon.startsWith('http') ? (
                      <img src={app.icon} alt={app.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-3xl">{app.icon}</span>
                    )}
                  </div>
                  <p className="text-xs text-center text-zima-text-primary font-medium truncate w-full">
                    {app.name}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
