import { ipcMain, BrowserWindow, shell } from 'electron';
import { logger } from '../utils/logger';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { ZeroTierManager } from '../zerotier/manager';
import { NetworkManager } from '../zerotier/network';
import { SMBManager } from '../smb/manager';
import { PlacesManager } from '../smb/places';
import { RecentConnectionsStorage } from '../storage/recentConnections';
import { BackupManager } from '../backup/manager';
import { updateManager } from '../updater';
import { ZimaDevice, SMBShare, BackupJob, ZimaApp } from '@shared/types';
import { runZeroTierDiagnostics } from '../zerotierDiagnostics';

const execAsync = promisify(exec);

// Type definitions for API responses
interface ZimaOSAppResponse {
  data?: Array<{
    id?: string;
    name?: string;
    title?: string;
    icon?: string;
    image?: string;
    web_ui?: string;
    port_map?: Array<{ host?: number }>;
    description?: string;
  }>;
  success?: number;
  message?: string;
}

/**
 * Enhanced fetch with better error handling and timeout
 */
async function safeFetch(url: string, options: RequestInit & { timeout?: number } = {}): Promise<Response> {
  const { timeout = 5000, ...fetchOptions } = options;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error(`Request to ${url} timed out after ${timeout}ms`);
      }
      throw new Error(`Network request failed: ${error.message}`);
    }
    throw new Error('Unknown network error occurred');
  }
}

export class IPCHandlers {
  private zerotierManager: ZeroTierManager;
  private networkManager: NetworkManager;
  private smbManager: SMBManager;
  private placesManager: PlacesManager;
  private recentConnectionsStorage: RecentConnectionsStorage;
  private backupManager: BackupManager;

  // Device discovery cache
  private deviceCache: Map<string, { devices: ZimaDevice[]; timestamp: number }> = new Map();
  private readonly DEVICE_CACHE_DURATION = 60000; // 60 seconds

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

  /**
   * Check device cache and return cached devices if still valid
   */
  private getCachedDevices(cacheKey: string): ZimaDevice[] | null {
    const cached = this.deviceCache.get(cacheKey);
    if (!cached) return null;

    const now = Date.now();
    if (now - cached.timestamp > this.DEVICE_CACHE_DURATION) {
      // Cache expired
      this.deviceCache.delete(cacheKey);
      return null;
    }

    logger.info(`[Cache] Returning ${cached.devices.length} cached devices for key: ${cacheKey}`);
    return cached.devices;
  }

  /**
   * Update device cache
   */
  private updateDeviceCache(cacheKey: string, devices: ZimaDevice[]): void {
    this.deviceCache.set(cacheKey, {
      devices,
      timestamp: Date.now(),
    });
    logger.info(`[Cache] Cached ${devices.length} devices for key: ${cacheKey}`);
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
          logger.info('ZeroTier daemon not running, starting it first...');
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

    ipcMain.handle('zerotier:diagnostics', async () => {
      try {
        const diagnostics = await runZeroTierDiagnostics();
        return { success: true, data: diagnostics };
      } catch (error: any) {
        logger.error('Failed to run ZeroTier diagnostics:', error);
        return { success: false, error: error.message };
      }
    });

    // Device discovery handlers
    ipcMain.handle('device:scan', async (_event, forceRefresh: boolean = false) => {
      try {
        const cacheKey = 'local-network-scan';

        // Check cache first (unless force refresh requested)
        if (!forceRefresh) {
          const cachedDevices = this.getCachedDevices(cacheKey);
          if (cachedDevices) {
            return { success: true, data: cachedDevices };
          }
        }

        const devices: ZimaDevice[] = [];
        const ipAddresses = await this.networkManager.getLocalIPAddresses();

        logger.info('Starting local network scan for ZimaOS devices...');

        // Scan local network
        for (const ip of ipAddresses) {
          const subnet = ip.substring(0, ip.lastIndexOf('.'));
          logger.info(`Scanning subnet: ${subnet}.0/24`);

          const activeHosts = await this.networkManager.scanLocalNetwork(subnet);
          logger.info(`Found ${activeHosts.length} active hosts in ${subnet}.0/24`);

          for (const host of activeHosts) {
            // Check if this host is a ZimaOS device
            const isZimaOS = await this.networkManager.isZimaOSDevice(host);

            if (!isZimaOS) {
              logger.info(`Skipping ${host} - not a ZimaOS device`);
              continue;
            }

            // Get SMB shares (optional)
            const shares = await this.smbManager.discoverShares(host);

            // Determine if it's on a ZeroTier network using dynamic detection
            const isZeroTier = await this.networkManager.isZeroTierIP(host);

            logger.info(`Adding ZimaOS device: ${host} (${shares.length} shares, ${isZeroTier ? 'remote' : 'local'})`);

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

        logger.info(`Scan complete: ${devices.length} ZimaOS devices found`);

        // Update cache with results
        this.updateDeviceCache(cacheKey, devices);

        return { success: true, data: devices };
      } catch (error: any) {
        logger.error('Device scan failed:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('device:discoverSMB', async (_event, subnet: string, credentials?: { username: string; password: string }, forceRefresh: boolean = false) => {
      try {
        const cacheKey = `smb-discovery-${subnet}`;

        // Check cache first (unless force refresh requested)
        if (!forceRefresh) {
          const cachedDevices = this.getCachedDevices(cacheKey);
          if (cachedDevices) {
            return { success: true, data: cachedDevices };
          }
        }

        logger.info('Starting SMB discovery for subnet:', subnet);
        const devices: ZimaDevice[] = [];

        // Use robust TCP 445 scan
        const smbHosts = await this.networkManager.scanSubnetForSMB(subnet);
        logger.info(`Found ${smbHosts.length} SMB hosts in subnet ${subnet}.0/24`);

        if (smbHosts.length === 0) {
          logger.info('No SMB hosts found - possible reasons:');
          logger.info('  - No hosts have SMB/CIFS enabled');
          logger.info('  - Firewall blocking TCP port 445');
          logger.info('  - Wrong subnet');
          return { success: true, data: [] };
        }

        // Discover shares on EACH SMB host - but only add ZimaOS devices
        for (const host of smbHosts) {
          try {
            logger.info(`[${smbHosts.indexOf(host) + 1}/${smbHosts.length}] Checking if ${host} is ZimaOS...`);

            // Check if this host is a ZimaOS device
            const isZimaOS = await this.networkManager.isZimaOSDevice(host);

            if (!isZimaOS) {
              logger.info(`Skipping ${host} - not a ZimaOS device`);
              continue;
            }

            // Try with credentials if provided, otherwise guest
            const shares = await this.smbManager.discoverShares(
              host,
              credentials?.username,
              credentials?.password,
              false // Don't include admin shares by default
            );

            logger.info(`✓ Found ${shares.length} shares on ZimaOS ${host}`);

            // Determine if it's on a ZeroTier network using dynamic detection
            const isZeroTier = await this.networkManager.isZeroTierIP(host);

            devices.push({
              id: host,
              name: `ZimaOS (${host})`,
              ipAddress: host,
              online: true,
              type: isZeroTier ? 'remote' : 'local',
              shares: shares.length > 0 ? shares : undefined,
            });
          } catch (error: any) {
            logger.error(`✗ Failed to discover shares on ${host}:`, error.message);
          }
        }

        logger.info(`✓ SMB discovery complete: ${devices.length} devices found`);

        // Update cache with results
        this.updateDeviceCache(cacheKey, devices);

        return { success: true, data: devices };
      } catch (error: any) {
        logger.error('SMB discovery failed:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('device:scanSubnet', async (_event, subnet: string) => {
      try {
        logger.info(`Scanning subnet ${subnet}.0/24 for ZimaOS devices...`);
        const devices: ZimaDevice[] = [];
        const activeHosts = await this.networkManager.scanLocalNetwork(subnet);

        logger.info(`Found ${activeHosts.length} active hosts, filtering for ZimaOS...`);

        for (const host of activeHosts) {
          // Check if this host is a ZimaOS device
          const isZimaOS = await this.networkManager.isZimaOSDevice(host);

          if (!isZimaOS) {
            logger.info(`Skipping ${host} - not a ZimaOS device`);
            continue;
          }

          const shares = await this.smbManager.discoverShares(host);

          // Determine if it's on a ZeroTier network using dynamic detection
          const isZeroTier = await this.networkManager.isZeroTierIP(host);

          logger.info(`Adding ZimaOS device: ${host} (${shares.length} shares, ${isZeroTier ? 'remote' : 'local'})`);

          devices.push({
            id: host,
            name: `ZimaOS (${host})`,
            ipAddress: host,
            online: true,
            type: isZeroTier ? 'remote' : 'local',
            shares: shares.length > 0 ? shares : undefined,
          });
        }

        logger.info(`Scan complete: ${devices.length} ZimaOS devices found`);
        return { success: true, data: devices };
      } catch (error: any) {
        logger.error('Subnet scan failed:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('device:connect', async (_event, deviceId: string, networkId?: string) => {
      try {
        if (networkId) {
          // Ensure ZeroTier daemon is running before attempting to join
          if (!this.zerotierManager.isReady()) {
            logger.info('ZeroTier daemon not running, starting it first...');
            await this.zerotierManager.start();
          }

          await this.zerotierManager.joinNetwork(networkId);

          // After joining, get the IP address of the new network
          // This helps the scan focus on the right network
          logger.info('Successfully joined network:', networkId);
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
        const apps: ZimaApp[] = [];

        // Try ZimaOS/CasaOS API endpoints
        const apiEndpoints = [
          `http://${deviceIp}/v2/app_management/myapps`,
          `http://${deviceIp}/v1/app/list`,
          `http://${deviceIp}/api/container/list`,
        ];

        for (const endpoint of apiEndpoints) {
          try {
            logger.info('Trying ZimaOS API:', endpoint);
            const response = await safeFetch(endpoint, {
              method: 'GET',
              headers: { 'Accept': 'application/json' },
              timeout: 5000,
            });

            logger.info('API response status:', response.status);

            if (response.ok) {
              const data: ZimaOSAppResponse = await response.json();
              logger.info('ZimaOS API full response:', JSON.stringify(data, null, 2));

              // Parse response based on endpoint
              if (data.data && Array.isArray(data.data)) {
                // CasaOS format: { data: [...] }
                logger.info(`Found ${data.data.length} apps in API response`);
                for (const app of data.data) {
                  logger.info('Processing app:', app);
                  apps.push({
                    id: app.id || app.name || `app-${Date.now()}`,
                    name: app.name || app.title || 'Unknown',
                    icon: app.icon || app.image || '📦',
                    url: app.web_ui || `http://${deviceIp}:${app.port_map?.[0]?.host || ''}`,
                    description: app.description,
                    installed: true,
                  });
                }
                break; // Found working endpoint
              } else {
                logger.info('API response format not recognized:', data);
              }
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.info(`API endpoint ${endpoint} failed:`, errorMessage);
          }
        }

        logger.info(`Total apps found from API: ${apps.length}`);

        // Add discovered SMB shares as "apps"
        const discoveredShares = await this.smbManager.discoverShares(deviceIp);
        logger.info('Discovered SMB shares:', discoveredShares);

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
        logger.info('Opening URL:', appUrl);
        logger.info('Auth token:', authToken ? 'Present' : 'Missing');

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
                  logger.info(`Opening SMB with ${fm}: ${appUrl}`);
                  // Open in background, don't wait
                  exec(`${fm} "${appUrl}"`, (error: any) => {
                    if (error) {
                      logger.error(`Error opening with ${fm}:`, error);
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
            logger.error('Failed to open SMB URL:', error);
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

            logger.info(`✓ Set auth cookie for ${hostUrl}`);

            // Set request header for Authorization
            filesWindow.webContents.session.webRequest.onBeforeSendHeaders(
              (details, callback) => {
                details.requestHeaders['Authorization'] = authToken;
                callback({ requestHeaders: details.requestHeaders });
              }
            );

            logger.info('✓ Set Authorization header interceptor');
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
        logger.error('Failed to open URL:', { appUrl, error });
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
        const createdJob = await this.backupManager.createJob(job);
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
        await this.backupManager.deleteJob(jobId);
        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('backup:updateJob', async (_event, jobId: string, updates: Partial<Omit<BackupJob, 'id'>>) => {
      try {
        const updatedJob = await this.backupManager.updateJob(jobId, updates);
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

    // Update handlers
    ipcMain.handle('update:check', async () => {
      try {
        updateManager.checkForUpdates();
        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('update:download', async () => {
      try {
        updateManager.downloadUpdate();
        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('update:install', async () => {
      try {
        updateManager.quitAndInstall();
        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('update:getVersion', async () => {
      try {
        const version = updateManager.getCurrentVersion();
        return { success: true, data: version };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    // Shell handlers
    ipcMain.handle('shell:openExternal', async (_event, url: string) => {
      try {
        await shell.openExternal(url);
        return { success: true };
      } catch (error: any) {
        logger.error('Failed to open external URL:', error);
        return { success: false, error: error.message };
      }
    });
  }

  async cleanup(stopZeroTierService: boolean = false): Promise<void> {
    // Stop all scheduled backup tasks
    this.backupManager.stopAllSchedules();

    // Cleanup ZeroTier (optionally stop service)
    await this.zerotierManager.cleanup(stopZeroTierService);
  }
}
