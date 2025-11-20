import { ipcMain, BrowserWindow, shell } from 'electron';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { ZeroTierManager } from '../zerotier/manager';
import { NetworkManager } from '../zerotier/network';
import { SMBManager } from '../smb/manager';
import { PlacesManager } from '../smb/places';
import { RecentConnectionsStorage } from '../storage/recentConnections';
import { BackupManager } from '../backup/manager';
import { ZimaDevice, SMBShare, BackupJob } from '@shared/types';

const execAsync = promisify(exec);

export class IPCHandlers {
  private zerotierManager: ZeroTierManager;
  private networkManager: NetworkManager;
  private smbManager: SMBManager;
  private placesManager: PlacesManager;
  private recentConnectionsStorage: RecentConnectionsStorage;
  private backupManager: BackupManager;

  constructor() {
    this.zerotierManager = new ZeroTierManager();
    this.networkManager = new NetworkManager();
    this.smbManager = new SMBManager();
    this.placesManager = new PlacesManager();
    this.recentConnectionsStorage = new RecentConnectionsStorage();
    this.backupManager = new BackupManager();

    // Forward backup progress events to renderer
    this.backupManager.on('progress', (progress) => {
      // Send to all windows
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(win => {
        win.webContents.send('backup:progress', progress);
      });
    });

    this.registerHandlers();
  }

  private registerHandlers(): void {
    // ZeroTier handlers
    ipcMain.handle('zerotier:start', async () => {
      try {
        await this.zerotierManager.start();
        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('zerotier:stop', async () => {
      try {
        await this.zerotierManager.stop();
        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('zerotier:join', async (_event, networkId: string) => {
      try {
        // Ensure ZeroTier daemon is running before attempting to join
        const ready = await this.zerotierManager.isReady();
        if (!ready) {
          console.log('ZeroTier daemon not running, starting it first...');
          await this.zerotierManager.start();
        }

        const result = await this.zerotierManager.joinNetwork(networkId);
        return { success: true, data: result };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('zerotier:leave', async (_event, networkId: string) => {
      try {
        await this.zerotierManager.leaveNetwork(networkId);
        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('zerotier:listNetworks', async () => {
      try {
        // Return empty array if daemon not running (instead of error)
        const ready = await this.zerotierManager.isReady();
        if (!ready) {
          return { success: true, data: [] };
        }

        const networks = await this.zerotierManager.getNetworks();
        return { success: true, data: networks };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('zerotier:getStatus', async () => {
      try {
        // Return not-ready status if daemon not running
        const ready = await this.zerotierManager.isReady();
        if (!ready) {
          return { success: true, data: { online: false, address: null } };
        }

        const status = await this.zerotierManager.getStatus();
        return { success: true, data: status };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    // Device discovery handlers
    ipcMain.handle('device:scan', async () => {
      try {
        const devices: ZimaDevice[] = [];
        const ipAddresses = await this.networkManager.getLocalIPAddresses();

        console.log('Starting local network scan for ZimaOS devices...');

        // Scan local network
        for (const ip of ipAddresses) {
          const subnet = ip.substring(0, ip.lastIndexOf('.'));
          console.log(`Scanning subnet: ${subnet}.0/24`);

          const activeHosts = await this.networkManager.scanLocalNetwork(subnet);
          console.log(`Found ${activeHosts.length} active hosts in ${subnet}.0/24`);

          for (const host of activeHosts) {
            // Check if this host is a ZimaOS device
            const isZimaOS = await this.networkManager.isZimaOSDevice(host);

            if (!isZimaOS) {
              console.log(`Skipping ${host} - not a ZimaOS device`);
              continue;
            }

            // Get SMB shares (optional)
            const shares = await this.smbManager.discoverShares(host);

            // Determine if it's on a ZeroTier network
            const isZeroTier = host.startsWith('10.147.') ||
                               host.startsWith('172.25.') ||
                               host.startsWith('172.21.') ||
                               host.startsWith('172.23.');

            console.log(`Adding ZimaOS device: ${host} (${shares.length} shares)`);

            devices.push({
              id: host,
              name: `ZimaOS (${host})`,
              ipAddress: host,
              online: true,
              type: isZeroTier ? 'remote' : 'local',
              shares: shares.length > 0 ? shares : undefined,
            });
          }
        }

        console.log(`Scan complete: ${devices.length} ZimaOS devices found`);
        return { success: true, data: devices };
      } catch (error: any) {
        console.error('Device scan failed:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('device:discoverSMB', async (_event, subnet: string, credentials?: { username: string; password: string }) => {
      try {
        console.log('Starting SMB discovery for subnet:', subnet);
        const devices: ZimaDevice[] = [];

        // Use robust TCP 445 scan
        const smbHosts = await this.networkManager.scanSubnetForSMB(subnet);
        console.log(`Found ${smbHosts.length} SMB hosts in subnet ${subnet}.0/24`);

        if (smbHosts.length === 0) {
          console.log('No SMB hosts found - possible reasons:');
          console.log('  - No hosts have SMB/CIFS enabled');
          console.log('  - Firewall blocking TCP port 445');
          console.log('  - Wrong subnet');
          return { success: true, data: [] };
        }

        // Discover shares on EACH SMB host - but only add ZimaOS devices
        for (const host of smbHosts) {
          try {
            console.log(`[${smbHosts.indexOf(host) + 1}/${smbHosts.length}] Checking if ${host} is ZimaOS...`);

            // Check if this host is a ZimaOS device
            const isZimaOS = await this.networkManager.isZimaOSDevice(host);

            if (!isZimaOS) {
              console.log(`Skipping ${host} - not a ZimaOS device`);
              continue;
            }

            // Try with credentials if provided, otherwise guest
            const shares = await this.smbManager.discoverShares(
              host,
              credentials?.username,
              credentials?.password,
              false // Don't include admin shares by default
            );

            console.log(`✓ Found ${shares.length} shares on ZimaOS ${host}`);

            // Determine if it's on a ZeroTier network
            const isZeroTier = host.startsWith('10.147.') ||
                               host.startsWith('172.25.') ||
                               host.startsWith('172.21.') ||
                               host.startsWith('172.23.') ||
                               host.startsWith('172.22.') ||
                               host.startsWith('172.24.');

            devices.push({
              id: host,
              name: `ZimaOS (${host})`,
              ipAddress: host,
              online: true,
              type: isZeroTier ? 'remote' : 'local',
              shares: shares.length > 0 ? shares : undefined,
            });
          } catch (error: any) {
            console.error(`✗ Failed to discover shares on ${host}:`, error.message);
          }
        }

        console.log(`✓ SMB discovery complete: ${devices.length} devices found`);
        return { success: true, data: devices };
      } catch (error: any) {
        console.error('SMB discovery failed:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('device:scanSubnet', async (_event, subnet: string) => {
      try {
        console.log(`Scanning subnet ${subnet}.0/24 for ZimaOS devices...`);
        const devices: ZimaDevice[] = [];
        const activeHosts = await this.networkManager.scanLocalNetwork(subnet);

        console.log(`Found ${activeHosts.length} active hosts, filtering for ZimaOS...`);

        for (const host of activeHosts) {
          // Check if this host is a ZimaOS device
          const isZimaOS = await this.networkManager.isZimaOSDevice(host);

          if (!isZimaOS) {
            console.log(`Skipping ${host} - not a ZimaOS device`);
            continue;
          }

          const shares = await this.smbManager.discoverShares(host);

          const isZeroTier = host.startsWith('10.147.') ||
                             host.startsWith('172.25.') ||
                             host.startsWith('172.21.') ||
                             host.startsWith('172.23.');

          console.log(`Adding ZimaOS device: ${host} (${shares.length} shares)`);

          devices.push({
            id: host,
            name: `ZimaOS (${host})`,
            ipAddress: host,
            online: true,
            type: isZeroTier ? 'remote' : 'local',
            shares: shares.length > 0 ? shares : undefined,
          });
        }

        console.log(`Scan complete: ${devices.length} ZimaOS devices found`);
        return { success: true, data: devices };
      } catch (error: any) {
        console.error('Subnet scan failed:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('device:connect', async (_event, deviceId: string, networkId?: string) => {
      try {
        if (networkId) {
          // Ensure ZeroTier daemon is running before attempting to join
          if (!this.zerotierManager.isReady()) {
            console.log('ZeroTier daemon not running, starting it first...');
            await this.zerotierManager.start();
          }

          await this.zerotierManager.joinNetwork(networkId);

          // After joining, get the IP address of the new network
          // This helps the scan focus on the right network
          console.log('Successfully joined network:', networkId);
        }

        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('device:disconnect', async () => {
      try {
        const networks = await this.zerotierManager.getNetworks();

        for (const network of networks) {
          await this.zerotierManager.leaveNetwork(network.id);
        }

        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    // SMB handlers
    ipcMain.handle('smb:discoverShares', async (_event, host: string) => {
      try {
        const shares = await this.smbManager.discoverShares(host);
        return { success: true, data: shares };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('smb:pinShare', async (_event, share: SMBShare, credentials?: { username: string; password: string }) => {
      try {
        await this.placesManager.pinShare(
          share,
          credentials?.username,
          credentials?.password
        );
        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('smb:unpinShare', async (_event, shareUrl: string) => {
      try {
        await this.placesManager.unpinShare(shareUrl);
        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('smb:listPinned', async () => {
      try {
        const pinned = await this.placesManager.listPinnedShares();
        return { success: true, data: pinned };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    // App handlers
    ipcMain.handle('app:list', async (_event, deviceIp: string) => {
      try {
        const apps: any[] = [];

        // Try ZimaOS/CasaOS API endpoints
        const apiEndpoints = [
          `http://${deviceIp}/v2/app_management/myapps`,
          `http://${deviceIp}/v1/app/list`,
          `http://${deviceIp}/api/container/list`,
        ];

        for (const endpoint of apiEndpoints) {
          try {
            console.log('Trying ZimaOS API:', endpoint);
            const response = await fetch(endpoint, {
              method: 'GET',
              headers: { 'Accept': 'application/json' },
              signal: AbortSignal.timeout(5000)
            });

            console.log('API response status:', response.status);

            if (response.ok) {
              const data = await response.json();
              console.log('ZimaOS API full response:', JSON.stringify(data, null, 2));

              // Parse response based on endpoint
              if (data.data && Array.isArray(data.data)) {
                // CasaOS format: { data: [...] }
                console.log(`Found ${data.data.length} apps in API response`);
                for (const app of data.data) {
                  console.log('Processing app:', app);
                  apps.push({
                    id: app.id || app.name,
                    name: app.name || app.title,
                    icon: app.icon || app.image,
                    url: app.web_ui || `http://${deviceIp}:${app.port_map?.[0]?.host}`,
                    description: app.description,
                    installed: true,
                  });
                }
                break; // Found working endpoint
              } else {
                console.log('API response format not recognized:', data);
              }
            }
          } catch (error: any) {
            console.log(`API endpoint ${endpoint} failed:`, error.message);
          }
        }

        console.log(`Total apps found from API: ${apps.length}`);

        // Add discovered SMB shares as "apps"
        const discoveredShares = await this.smbManager.discoverShares(deviceIp);
        console.log('Discovered SMB shares:', discoveredShares);

        for (const share of discoveredShares) {
          apps.push({
            id: `smb-${share.name}`,
            name: share.name,
            icon: '📂', // Folder icon for shares
            url: `smb://${deviceIp}/${share.name}`,
            description: share.comment || 'SMB Share',
            installed: true,
          });
        }

        // Add Files app - opens ZimaOS web interface where all drives are visible
        apps.push({
          id: 'files-browser',
          name: 'Files',
          icon: '📁',
          url: `http://${deviceIp}/`,
          description: 'Browse all files and drives in ZimaOS',
          installed: true,
        });

        return { success: true, data: apps };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('app:open', async (_event, appUrl: string, authToken?: string) => {
      try {
        console.log('Opening URL:', appUrl);
        console.log('Auth token:', authToken ? 'Present' : 'Missing');

        // Handle SMB URLs - open with native file manager
        if (appUrl.startsWith('smb://')) {
          try {
            // Try common Linux file managers in order of preference
            const fileManagers = [
              'nautilus',  // GNOME Files
              'dolphin',   // KDE Dolphin
              'thunar',    // XFCE
              'nemo',      // Cinnamon
              'pcmanfm',   // LXDE
              'xdg-open'   // Fallback
            ];

            for (const fm of fileManagers) {
              try {
                const { stdout } = await execAsync(`which ${fm}`);
                if (stdout.trim()) {
                  console.log(`Opening SMB with ${fm}: ${appUrl}`);
                  // Open in background, don't wait
                  exec(`${fm} "${appUrl}"`, (error: any) => {
                    if (error) {
                      console.error(`Error opening with ${fm}:`, error);
                    }
                  });
                  return { success: true };
                }
              } catch (e) {
                // File manager not found, try next one
                continue;
              }
            }

            throw new Error('No file manager found');
          } catch (error: any) {
            console.error('Failed to open SMB URL:', error);
            return { success: false, error: 'Could not find a file manager to open SMB shares' };
          }
        }
        // Handle ZimaOS Files URLs - open in embedded window
        else if (appUrl.includes('/modules/icewhale_files') || appUrl.endsWith('/') || appUrl.match(/^https?:\/\/[^/]+$/)) {
          // Create a new window for ZimaOS Files
          const filesWindow = new BrowserWindow({
            width: 1400,
            height: 900,
            title: 'ZimaOS Files',
            icon: path.join(__dirname, '../../logo.png'),
            webPreferences: {
              nodeIntegration: false,
              contextIsolation: true,
              partition: 'persist:zimaos', // Persist session/cookies
              webSecurity: true, // Keep security enabled
              allowRunningInsecureContent: false, // Don't allow mixed content
            },
          });

          // If we have an auth token, set it as a cookie AND request header
          if (authToken) {
            const session = filesWindow.webContents.session;

            // Extract host from URL
            const urlObj = new URL(appUrl);
            const hostUrl = `${urlObj.protocol}//${urlObj.host}`;

            // Set cookie for persistent auth
            await session.cookies.set({
              url: hostUrl,
              name: 'Authorization',
              value: authToken,
              expirationDate: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hours
            });

            console.log(`✓ Set auth cookie for ${hostUrl}`);

            // Set request header for Authorization
            filesWindow.webContents.session.webRequest.onBeforeSendHeaders(
              (details, callback) => {
                details.requestHeaders['Authorization'] = authToken;
                callback({ requestHeaders: details.requestHeaders });
              }
            );

            console.log('✓ Set Authorization header interceptor');
          }

          // Load ZimaOS URL
          filesWindow.loadURL(appUrl);

          // Show window when ready
          filesWindow.once('ready-to-show', () => {
            filesWindow.show();
          });

          return { success: true };
        }
        // For other HTTP/HTTPS URLs, use shell.openExternal
        else {
          await shell.openExternal(appUrl);
          return { success: true };
        }
      } catch (error: any) {
        console.error('Failed to open URL:', appUrl, error);
        return { success: false, error: error.message };
      }
    });

    // Recent connections handlers
    ipcMain.handle('connection:getRecent', async () => {
      try {
        const connections = this.recentConnectionsStorage.getRecent();
        return { success: true, data: connections };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('connection:saveRecent', async (_event, connection: { networkId: string; name?: string; gatewayIP?: string }) => {
      try {
        this.recentConnectionsStorage.saveConnection(connection);
        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('connection:removeRecent', async (_event, networkId: string) => {
      try {
        this.recentConnectionsStorage.removeConnection(networkId);
        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('connection:clearRecent', async () => {
      try {
        this.recentConnectionsStorage.clearAll();
        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    // Backup handlers
    ipcMain.handle('backup:selectFolder', async () => {
      try {
        const folder = await this.backupManager.selectFolder();
        return { success: true, data: folder };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('smb:getSpace', async (_event, share: SMBShare, credentials?: { username: string; password: string }) => {
      try {
        const space = await this.backupManager.getShareSpace(share, credentials);
        return { success: true, data: space };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('backup:createJob', async (_event, job: Omit<BackupJob, 'id'>) => {
      try {
        const createdJob = this.backupManager.createJob(job);
        return { success: true, data: createdJob };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('backup:listJobs', async () => {
      try {
        const jobs = this.backupManager.listJobs();
        return { success: true, data: jobs };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('backup:deleteJob', async (_event, jobId: string) => {
      try {
        this.backupManager.deleteJob(jobId);
        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('backup:updateJob', async (_event, jobId: string, updates: Partial<Omit<BackupJob, 'id'>>) => {
      try {
        const updatedJob = this.backupManager.updateJob(jobId, updates);
        return { success: true, data: updatedJob };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('backup:runJob', async (_event, jobId: string, credentials?: { username: string; password: string }) => {
      try {
        await this.backupManager.runJob(jobId, credentials);
        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('backup:stopJob', async (_event, jobId: string) => {
      try {
        this.backupManager.stopJob(jobId);
        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });
  }

  async cleanup(): Promise<void> {
    // Stop all scheduled backup tasks
    this.backupManager.stopAllSchedules();

    // Stop ZeroTier daemon
    await this.zerotierManager.stop();
  }
}
