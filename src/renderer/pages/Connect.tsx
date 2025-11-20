import React, { useState, useEffect } from 'react';
import { useAppStore } from '../store';
import { useZeroTier } from '../hooks/useZeroTier';
import { RecentConnection } from '@shared/types';

export const ConnectPage: React.FC = () => {
  const { setCurrentView, setSelectedDevice, setDevices, sessionCredentials, setSessionCredentials, addToast } = useAppStore();
  const { loading: ztLoading } = useZeroTier();

  const [remoteId, setRemoteId] = useState('');
  const [showRemoteDialog, setShowRemoteDialog] = useState(false);
  const scanning = false; // Placeholder for future implementation
  const [showLoginDialog, setShowLoginDialog] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pendingDeviceIP, setPendingDeviceIP] = useState<string | null>(null);
  const [pendingNetworkId, setPendingNetworkId] = useState<string | null>(null);
  const [recentConnections, setRecentConnections] = useState<RecentConnection[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [discoveredDevices, setDiscoveredDevices] = useState<any[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryProgress, setDiscoveryProgress] = useState(0);
  const [pinnedShareUrls, setPinnedShareUrls] = useState<string[]>([]);

  // Load recent connections and pinned shares on mount
  useEffect(() => {
    loadRecentConnections();
    loadPinnedShares();
  }, []);

  const loadPinnedShares = async () => {
    try {
      const result = await window.electron.smb.listPinned();
      if (result.success && result.data) {
        console.log('[Connect] Loaded pinned share URLs:', result.data);
        setPinnedShareUrls(result.data);
      }
    } catch (error) {
      console.error('Failed to load pinned shares:', error);
    }
  };

  // Debug: Log when discovery state changes
  // useEffect(() => {
  //   console.log('=== Discovery State Changed ===');
  //   console.log('discovering:', discovering);
  //   console.log('discoveredDevices.length:', discoveredDevices.length);
  //   console.log('Should show devices:', !discovering && discoveredDevices.length > 0);
  //   console.log('==============================');
  // }, [discovering, discoveredDevices]);

  const loadRecentConnections = async () => {
    try {
      const result = await window.electron.connection.getRecent();
      if (result.success && result.data) {
        setRecentConnections(result.data);
      }
    } catch (error) {
      console.error('Failed to load recent connections:', error);
    } finally {
      setLoadingRecent(false);
    }
  };

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      addToast({ type: 'warning', message: 'Please enter username and password' });
      return;
    }

    if (!pendingDeviceIP) return;

    try {
      console.log('Logging into ZimaOS...');

      // Login to ZimaOS
      const loginResponse = await fetch(`http://${pendingDeviceIP}/v1/users/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const loginData = await loginResponse.json();
      console.log('Login response:', loginData);

      if (loginData.success === 200 && loginData.data) {
        // Store auth token - extract the actual token string
        const tokenData = loginData.data;
        console.log('Login successful, full response:', tokenData);

        // The token might be in different formats:
        // 1. loginData.data itself is a string
        // 2. loginData.data.token is a string
        // 3. loginData.data.token is an object with access_token
        let authToken: string;

        if (typeof tokenData === 'string') {
          authToken = tokenData;
        } else if (tokenData.token) {
          if (typeof tokenData.token === 'string') {
            authToken = tokenData.token;
          } else if (tokenData.token.access_token) {
            authToken = tokenData.token.access_token;
          } else {
            // If it's an object, stringify it
            authToken = JSON.stringify(tokenData.token);
          }
        } else {
          // Fallback: stringify the entire object
          authToken = JSON.stringify(tokenData);
        }

        console.log('Extracted auth token:', authToken);

        // Save credentials for session (for pinning shares later)
        const savedUsername = username;
        const savedPassword = password;
        setSessionCredentials({ username: savedUsername, password: savedPassword });

        // Close login dialog first
        setShowLoginDialog(false);
        setUsername('');
        setPassword('');

        // Start automatic discovery WITH CREDENTIALS to get shares
        console.log('Starting discovery with credentials to get shares...');
        const discoveryResult = await window.electron.device.discoverSMB(
          pendingDeviceIP.substring(0, pendingDeviceIP.lastIndexOf('.')),
          { username: savedUsername, password: savedPassword }
        );

        let shares: any[] = [];
        if (discoveryResult.success && discoveryResult.data && discoveryResult.data.length > 0) {
          // Find the device matching our IP
          const discoveredDevice = discoveryResult.data.find((d: any) => d.ipAddress === pendingDeviceIP);
          if (discoveredDevice && discoveredDevice.shares) {
            shares = discoveredDevice.shares;
            console.log(`Discovered ${shares.length} shares:`, shares);
          }
        }

        // Create device with auth token and discovered shares
        const device = {
          id: pendingDeviceIP,
          name: `ZimaOS (${pendingDeviceIP})`,
          ipAddress: pendingDeviceIP,
          online: true,
          type: 'remote' as const,
          authToken: authToken,
          shares: shares,
        };

        setDevices([device]);
        setDiscoveredDevices([device]);  // Also update local state for UI rendering
        setSelectedDevice(device);

        // Save to recent connections if we have a network ID
        if (pendingNetworkId) {
          await window.electron.connection.saveRecent({
            networkId: pendingNetworkId,
            gatewayIP: pendingDeviceIP,
          });
          await loadRecentConnections();
        }

        // Clear pending state
        setPendingDeviceIP(null);
        setPendingNetworkId(null);

        // Stay on Connect page to show discovered devices
        // User can manually navigate to Apps page to see apps
      } else {
        addToast({ type: 'error', message: 'Login failed: ' + (loginData.message || 'Invalid credentials') });
      }
    } catch (error) {
      console.error('Login failed:', error);
      addToast({ type: 'error', message: 'Failed to login to ZimaOS' });
    }
  };

  const startAutoDiscovery = async (gatewayIP: string, credentials?: { username: string; password: string }) => {
    try {
      setDiscovering(true);
      setDiscoveryProgress(0);
      setDiscoveredDevices([]);

      // Extract subnet from gateway IP (e.g., "10.147.14.1" -> "10.147.14")
      const subnet = gatewayIP.substring(0, gatewayIP.lastIndexOf('.'));
      console.log('Starting automatic SMB discovery on subnet:', subnet, credentials ? `(as ${credentials.username})` : '(guest)');

      // Start SMB discovery WITH CREDENTIALS
      const result = await window.electron.device.discoverSMB(subnet, credentials);

      if (result.success && result.data) {
        console.log(`Discovery complete: ${result.data.length} devices found`);

        // Log shares for each device
        result.data.forEach((device: any, idx: number) => {
          console.log(`Device ${idx + 1}: ${device.name} (${device.ipAddress})`);
          console.log(`  Shares: ${device.shares ? device.shares.length : 0}`);
          if (device.shares) {
            device.shares.forEach((share: any) => {
              console.log(`    - ${share.name} (${share.displayName})`);
            });
          }
        });

        setDiscoveredDevices(result.data);

        // IMPORTANT: Also update global devices store so shares are available everywhere
        setDevices(result.data);
        console.log('Updated global devices store with discovered devices');
      } else {
        console.error('Discovery failed:', result.error);
      }
    } catch (error) {
      console.error('Auto discovery failed:', error);
    } finally {
      setDiscovering(false);
      setDiscoveryProgress(100);
      // console.log('Discovery finished - discovering flag set to false');
    }
  };

  const handleConnectRemote = async () => {
    if (!remoteId.trim()) {
      addToast({ type: 'warning', message: 'Please enter a Remote ID' });
      return;
    }

    try {
      // Join ZeroTier network and get gateway IP
      const result = await window.electron.zerotier.join(remoteId);

      if (result.success && result.data?.gatewayIP) {
        setShowRemoteDialog(false);

        const gatewayIP = result.data.gatewayIP;
        console.log('Connecting directly to ZimaOS at:', gatewayIP);

        // Store network ID and gateway IP for later saving
        setPendingNetworkId(remoteId);
        setPendingDeviceIP(gatewayIP);
        setRemoteId('');

        // Show login dialog to get credentials for ZimaOS
        // Discovery will start AFTER login with credentials
        setShowLoginDialog(true);
      } else {
        addToast({ type: 'error', message: 'Failed to connect to remote network' });
      }
    } catch (error) {
      console.error('Remote connect failed:', error);
      addToast({ type: 'error', message: 'Failed to connect remotely' });
    }
  };

  const handleQuickReconnect = async (connection: RecentConnection) => {
    try {
      // Join ZeroTier network
      const result = await window.electron.zerotier.join(connection.networkId);

      if (result.success && result.data?.gatewayIP) {
        const gatewayIP = result.data.gatewayIP;
        console.log('Quick reconnecting to:', gatewayIP);

        // Store network ID and gateway IP for later saving
        setPendingNetworkId(connection.networkId);
        setPendingDeviceIP(gatewayIP);

        // Show login dialog
        // Discovery will start AFTER login with credentials
        setShowLoginDialog(true);
      } else {
        addToast({ type: 'error', message: 'Failed to reconnect to network' });
      }
    } catch (error) {
      console.error('Quick reconnect failed:', error);
      addToast({ type: 'error', message: 'Failed to reconnect' });
    }
  };

  const handleRemoveRecent = async (networkId: string, event: React.MouseEvent) => {
    event.stopPropagation(); // Prevent triggering reconnect
    try {
      await window.electron.connection.removeRecent(networkId);
      await loadRecentConnections();
    } catch (error) {
      console.error('Failed to remove recent connection:', error);
    }
  };

  const formatTimestamp = (timestamp: number): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const handleScanLocalNetwork = async () => {
    try {
      setDiscovering(true);
      setDiscoveryProgress(0);
      setDiscoveredDevices([]);

      console.log('Starting local network scan...');

      // Use the device:scan API which automatically scans all local interfaces
      const result = await window.electron.device.scan();

      if (result.success && result.data) {
        console.log(`Local network scan complete: ${result.data.length} devices found`);

        // Log devices found
        result.data.forEach((device: any, idx: number) => {
          console.log(`Device ${idx + 1}: ${device.name} (${device.ipAddress})`);
          console.log(`  Type: ${device.type}`);
          console.log(`  Shares: ${device.shares ? device.shares.length : 0}`);
          if (device.shares) {
            device.shares.forEach((share: any) => {
              console.log(`    - ${share.name}`);
            });
          }
        });

        setDiscoveredDevices(result.data);

        // Also update global devices store
        setDevices(result.data);
        console.log('Updated global devices store with local network scan results');
      } else {
        console.error('Local network scan failed:', result.error);
        addToast({ type: 'error', message: 'Failed to scan local network: ' + (result.error || 'Unknown error') });
      }
    } catch (error) {
      console.error('Local network scan failed:', error);
      addToast({ type: 'error', message: 'Failed to scan local network' });
    } finally {
      setDiscovering(false);
      setDiscoveryProgress(100);
    }
  };

  return (
    <div className="px-4 py-8 pb-32">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <p className="text-xs font-semibold text-zima-text-secondary tracking-wider mb-2">CONNECTOR</p>
          <h1 className="text-3xl font-bold text-zima-blue mb-1">
            Remote access
          </h1>
          <p className="text-3xl font-bold text-zima-blue">
            anytime, anywhere.
          </p>
        </div>

        {/* Main Card */}
        <div className="bg-white rounded-3xl shadow-lg p-6 mb-6">
          {/* Scanning Status */}
          {scanning && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <p className="text-base font-medium text-zima-text-primary">Scanning..</p>
                <button className="p-1">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-zima-blue h-2 rounded-full animate-pulse" style={{width: '60%'}}></div>
              </div>
            </div>
          )}

          {/* Recent Connections */}
          {!scanning && !loadingRecent && recentConnections.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-zima-text-secondary tracking-wider mb-3">RECENT CONNECTIONS</p>
              {recentConnections.map((connection) => (
                <div
                  key={connection.networkId}
                  onClick={() => handleQuickReconnect(connection)}
                  className="flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 rounded-xl cursor-pointer transition-colors group"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-10 h-10 bg-zima-blue rounded-full flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-zima-text-primary truncate">
                        {connection.name || connection.networkId.substring(0, 16)}
                      </p>
                      <p className="text-xs text-zima-text-secondary">
                        {formatTimestamp(connection.timestamp)}
                        {connection.gatewayIP && ` • ${connection.gatewayIP}`}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleRemoveRecent(connection.networkId, e)}
                    className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                    title="Remove connection"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Discovery Progress */}
          {discovering && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-zima-text-secondary tracking-wider">DISCOVERING SMB SHARES</p>
                <span className="text-xs text-zima-blue font-medium">{discoveryProgress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-zima-blue h-2 rounded-full transition-all duration-300"
                  style={{ width: `${discoveryProgress}%` }}
                ></div>
              </div>
              <p className="text-xs text-zima-text-secondary">Scanning network for devices...</p>
            </div>
          )}

          {/* Discovered Devices */}
          {!discovering && discoveredDevices.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-zima-text-secondary tracking-wider">
                  DISCOVERED DEVICES ({discoveredDevices.length})
                </p>
                <button
                  onClick={handleScanLocalNetwork}
                  className="text-xs text-zima-blue hover:underline font-medium"
                  title="Scan again"
                >
                  Scan again
                </button>
              </div>
              {discoveredDevices.map((device) => (
                <div
                  key={device.id}
                  className="p-4 bg-green-50 rounded-xl border border-green-200"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-zima-text-primary">
                        {device.name}
                      </p>
                      <p className="text-xs text-zima-text-secondary">
                        {device.ipAddress}
                        {device.shares && ` • ${device.shares.length} share(s)`}
                      </p>
                    </div>
                  </div>
                  {/* Show shares if available */}
                  {device.shares && device.shares.length > 0 && (
                    <div className="mt-3 pl-12 space-y-2">
                      {device.shares.map((share: any, idx: number) => {
                        // Build URL without password to match the pinned format
                        const shareUrl = sessionCredentials
                          ? `smb://${encodeURIComponent(sessionCredentials.username)}@${share.host}/${share.name}`
                          : `smb://${share.host}/${share.name}`;

                        // Normalize URLs for comparison (remove trailing slashes, lowercase)
                        const normalizeUrl = (url: string) => url.toLowerCase().replace(/\/$/, '');
                        const isPinned = pinnedShareUrls.some(pinnedUrl =>
                          normalizeUrl(pinnedUrl) === normalizeUrl(shareUrl)
                        );

                        return (
                          <div key={idx} className="flex items-center justify-between">
                            <span className="text-xs text-zima-text-primary">📁 {share.name}</span>
                            <button
                              onClick={async () => {
                                try {
                                  // Use the saved session credentials
                                  await window.electron.smb.pinShare(share, sessionCredentials || undefined);

                                  addToast({
                                    type: 'success',
                                    message: `Pinned: ${share.name}${sessionCredentials ? ' (Credentials saved to keyring)' : ' (Guest access)'}`
                                  });

                                  // Reload pinned shares to update UI
                                  await loadPinnedShares();
                                } catch (error) {
                                  console.error('Failed to pin share:', error);
                                  addToast({ type: 'error', message: `Failed to pin share: ${error}` });
                                }
                              }}
                              className={`text-xs ${isPinned ? 'text-red-600' : 'text-zima-blue'} hover:underline`}
                              title={isPinned ? 'Already pinned' : 'Pin this share'}
                            >
                              {isPinned ? '📌 Pinned' : 'Pin'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Button to view apps */}
                  <div className="mt-4 pt-3 border-t border-green-200">
                    <button
                      onClick={() => {
                        setDevices([device]);
                        setSelectedDevice(device);
                        setCurrentView('apps');
                      }}
                      className="w-full bg-blue-500 hover:bg-blue-600 text-white rounded-full py-2 px-4 text-sm font-medium transition-colors shadow-sm"
                    >
                      View Apps
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* No devices found */}
          {!scanning && !loadingRecent && !discovering && recentConnections.length === 0 && discoveredDevices.length === 0 && (
            <div className="space-y-4">
              <p className="text-sm text-zima-text-secondary">No recent connections</p>
            </div>
          )}
        </div>

        {/* Action Buttons - only show when no devices are connected */}
        {discoveredDevices.length === 0 && (
          <div className="space-y-3">
            {/* Scan Local Network Button */}
            <button
              onClick={handleScanLocalNetwork}
              disabled={discovering}
              className="w-full bg-zima-blue hover:bg-blue-600 text-white rounded-full py-4 px-6 font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              {discovering ? 'Scanning...' : 'Scan Local Network'}
            </button>

            {/* Connect via Remote ID Button */}
            <button
              onClick={() => setShowRemoteDialog(true)}
              className="w-full bg-zima-nav-bg hover:bg-gray-800 text-white rounded-full py-4 px-6 font-medium flex items-center justify-center gap-2 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
              </svg>
              Connect via Remote ID
            </button>
          </div>
        )}

        {/* Remote ID Dialog */}
        {showRemoteDialog && (
          <div className="modal-backdrop fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="modal-content bg-white rounded-3xl p-6 max-w-md w-full shadow-xl">
              <h2 className="text-2xl font-bold mb-2 text-zima-text-primary">Connect Remotely</h2>

              <p className="text-sm text-zima-text-secondary mb-6">
                Enter your ZimaOS ZeroTier Network ID
              </p>

              <input
                type="text"
                value={remoteId}
                onChange={(e) => setRemoteId(e.target.value)}
                placeholder="a0cbf4b62a1234567"
                className="w-full px-4 py-3 bg-gray-100 rounded-xl text-zima-text-primary border-0 focus:ring-2 focus:ring-zima-blue focus:outline-none mb-6"
              />

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowRemoteDialog(false);
                    setRemoteId('');
                  }}
                  className="flex-1 px-4 py-3 bg-gray-100 hover:bg-gray-200 text-zima-text-primary rounded-xl font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConnectRemote}
                  disabled={ztLoading || !remoteId.trim()}
                  className="flex-1 px-4 py-3 bg-zima-blue hover:bg-blue-600 text-white rounded-xl font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {ztLoading ? 'Connecting...' : 'Connect'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Login Dialog */}
        {showLoginDialog && (
          <div className="modal-backdrop fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="modal-content bg-white rounded-3xl p-6 max-w-md w-full shadow-xl">
              <h2 className="text-2xl font-bold mb-2 text-zima-text-primary">Login to ZimaOS</h2>

              <p className="text-sm text-zima-text-secondary mb-6">
                Enter your ZimaOS credentials to access apps
              </p>

              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-sm font-medium mb-2 text-zima-text-primary">Username</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="admin"
                    className="w-full px-4 py-3 bg-gray-100 rounded-xl text-zima-text-primary border-0 focus:ring-2 focus:ring-zima-blue focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2 text-zima-text-primary">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-4 py-3 bg-gray-100 rounded-xl text-zima-text-primary border-0 focus:ring-2 focus:ring-zima-blue focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowLoginDialog(false);
                    setUsername('');
                    setPassword('');
                    setPendingDeviceIP(null);
                  }}
                  className="flex-1 px-4 py-3 bg-gray-100 hover:bg-gray-200 text-zima-text-primary rounded-xl font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleLogin}
                  className="flex-1 px-4 py-3 bg-zima-blue hover:bg-blue-600 text-white rounded-xl font-medium transition-colors"
                >
                  Login
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
