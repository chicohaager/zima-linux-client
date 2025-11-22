import { execFile, exec, spawn, ChildProcess } from 'child_process';
import { logger } from '../utils/logger';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { ZeroTierNetwork } from '@shared/types';
import { sanitizeNetworkId } from '../utils/sanitize';
import { ZeroTierBundler } from './bundler';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

/**
 * ZeroTier Manager - System Service Integration
 * Uses bundled binaries in development or system service in production
 */
export class ZeroTierManager {
  private ztCli: string;
  private ztBinary: string = '';
  private ztHomeDir: string;
  private bundler?: ZeroTierBundler;
  private useBundled: boolean = false;
  private daemonProcess?: ChildProcess;
  private serviceName: string = 'zima-zerotier';
  private customPort: string = '9995'; // Use custom port to avoid conflict with system ZeroTier (9993) and system service (9994)
  private startLock: Promise<void> | null = null; // Prevent concurrent start operations

  constructor() {
    // Determine architecture
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

    // Try bundled binaries first
    const isDev = !app.isPackaged;
    let bundledCliPath = '';
    let bundledBinaryPath = '';

    if (isDev) {
      // Development: check bin/zerotier/x64/ in project root
      const devCliPath = path.join(__dirname, '../../bin/zerotier', arch, 'zerotier-cli');
      const devBinaryPath = path.join(__dirname, '../../bin/zerotier', arch, 'zerotier-one');
      if (fs.existsSync(devCliPath) && fs.existsSync(devBinaryPath)) {
        bundledCliPath = devCliPath;
        bundledBinaryPath = devBinaryPath;
        logger.info('Found development bundled binaries:', { devCliPath, devBinaryPath });
      }
    } else {
      // Production: check bundled resources
      const prodCliPath = path.join(process.resourcesPath, 'bin/zerotier', arch, 'zerotier-cli');
      const prodBinaryPath = path.join(process.resourcesPath, 'bin/zerotier', arch, 'zerotier-one');
      if (fs.existsSync(prodCliPath) && fs.existsSync(prodBinaryPath)) {
        bundledCliPath = prodCliPath;
        bundledBinaryPath = prodBinaryPath;
        logger.info('Found production bundled binaries:', { prodCliPath, prodBinaryPath });
      }
    }

    // User service paths (installed by setupBundledDaemon)
    const userServiceCliPath = path.join(app.getPath('home'), '.local/lib/zima-remote/zerotier/zerotier-cli');
    const userServiceBinaryPath = path.join(app.getPath('home'), '.local/lib/zima-remote/zerotier/zerotier-one');

    // Try paths in order of preference
    // Prioritize user service over system service for more control
    const possibleCliPaths = [
      bundledCliPath,                       // Bundled binaries (for dev/AppImage)
      userServiceCliPath,                   // User service (installed by this app)
      '/opt/zima-client/bin/zerotier-cli',  // Installed via .deb
      '/usr/sbin/zerotier-cli',             // System ZeroTier
      'zerotier-cli',                       // PATH
    ];

    // Find available CLI
    this.ztCli = '';
    this.ztBinary = '';
    for (const cliPath of possibleCliPaths) {
      if (cliPath && (fs.existsSync(cliPath) || cliPath === 'zerotier-cli')) {
        this.ztCli = cliPath;
        // Mark as bundled if using our bundled binaries or user service
        this.useBundled = (cliPath === bundledCliPath || cliPath === userServiceCliPath);
        if (cliPath === bundledCliPath) {
          this.ztBinary = bundledBinaryPath;
        } else if (cliPath === userServiceCliPath) {
          this.ztBinary = userServiceBinaryPath;
        }
        break;
      }
    }

    // Home directory - use user config for bundled, system for service
    if (this.useBundled) {
      this.ztHomeDir = path.join(app.getPath('home'), '.zima-zerotier');
      // Ensure directory exists
      if (!fs.existsSync(this.ztHomeDir)) {
        fs.mkdirSync(this.ztHomeDir, { recursive: true });
      }
    } else {
      this.ztHomeDir = '/var/lib/zima-zerotier';
    }

    logger.info('ZeroTier Manager initialized');
    logger.info('CLI path:', this.ztCli);
    logger.info('Home directory:', this.ztHomeDir);
    logger.info('Using bundled binaries:', this.useBundled);

    // Install systemd user service if using bundled binaries
    if (this.useBundled) {
      this.setupBundledDaemon().catch(err => {
        logger.warn('Failed to setup bundled daemon:', err.message);
      });
    }
  }

  /**
   * Setup bundled ZeroTier daemon (copy binaries, set capabilities, install service)
   */
  private async setupBundledDaemon(): Promise<void> {
    try {
      // Copy binaries to user-writable location (needed for setcap on non-ext4 filesystems)
      const localBinaryDir = path.join(app.getPath('home'), '.local/lib/zima-remote/zerotier');
      const localBinaryPath = path.join(localBinaryDir, 'zerotier-one');
      const localCliPath = path.join(localBinaryDir, 'zerotier-cli');

      // Ensure directory exists
      if (!fs.existsSync(localBinaryDir)) {
        fs.mkdirSync(localBinaryDir, { recursive: true });
        logger.info('Created local binary directory:', localBinaryDir);
      }

      // Copy binaries if they don't exist or are outdated
      let binaryUpdated = false;
      if (!fs.existsSync(localBinaryPath) || !fs.existsSync(localCliPath)) {
        logger.info('Copying ZeroTier binaries to local lib directory...');
        fs.copyFileSync(this.ztBinary, localBinaryPath);
        fs.copyFileSync(this.ztCli, localCliPath);
        fs.chmodSync(localBinaryPath, 0o755);
        fs.chmodSync(localCliPath, 0o755);
        binaryUpdated = true;
        logger.info('✓ Binaries copied to:', localBinaryDir);
      }

      // Update paths to use local copies
      this.ztBinary = localBinaryPath;
      this.ztCli = localCliPath;

      // Check TUN device availability
      await this.checkTunDevice();

      // Check if capabilities are already set
      const needsSetup = await this.needsCapabilitySetup();

      if (needsSetup || binaryUpdated) {
        logger.info('\n=== ZeroTier Setup Required ===');
        logger.info('ZeroTier needs network capabilities for creating virtual interfaces.');
        logger.info('This is a ONE-TIME setup.\n');
        logger.info('Please run this command in a terminal:\n');
        logger.info(`sudo setcap cap_net_admin,cap_net_raw=eip ${this.ztBinary}\n`);
        logger.info('Then restart the application.');
        logger.info('===============================\n');
      }

      await this.installUserService();
    } catch (error: any) {
      logger.error('Failed to setup bundled daemon:', error.message);
    }
  }

  /**
   * Check if TUN device is available
   */
  private async checkTunDevice(): Promise<void> {
    try {
      const tunDeviceExists = fs.existsSync('/dev/net/tun');
      if (!tunDeviceExists) {
        logger.info('TUN device not found. Loading tun kernel module...');
        await execAsync('sudo modprobe tun').catch(() => {
          logger.warn('Could not load tun module. You may need to run: sudo modprobe tun');
        });
      }
    } catch (error) {
      logger.warn('Could not check TUN device:', error);
    }
  }

  /**
   * Check if binary needs capability setup
   */
  private async needsCapabilitySetup(): Promise<boolean> {
    try {
      const { stdout } = await execAsync(`getcap "${this.ztBinary}"`);
      const hasNetAdmin = stdout.includes('cap_net_admin');
      const hasNetRaw = stdout.includes('cap_net_raw');
      const hasEip = stdout.includes('eip') || stdout.includes('=eip');
      return !(hasNetAdmin && hasNetRaw && hasEip);
    } catch {
      return true; // If getcap fails, assume setup is needed
    }
  }

  /**
   * Install systemd --user service for ZeroTier
   */
  private async installUserService(): Promise<void> {
    try {
      const userServiceDir = path.join(app.getPath('home'), '.config/systemd/user');
      const serviceFilePath = path.join(userServiceDir, `${this.serviceName}.service`);

      // Generate expected service content
      const expectedServiceContent = `[Unit]
Description=ZeroTier for Zima Remote Client (user)
After=network-online.target

[Service]
Type=forking
ExecStart=${this.ztBinary} -p${this.customPort} -d -U ${this.ztHomeDir}
ExecStop=/bin/sh -c '${this.ztCli} -D${this.ztHomeDir} -p\$(cat ${this.ztHomeDir}/zerotier-one.port) -T\$(cat ${this.ztHomeDir}/authtoken.secret) shutdown || true'
Restart=on-failure
RestartSec=5
NoNewPrivileges=false

[Install]
WantedBy=default.target
`;

      // Check if service file already exists and is up to date
      if (fs.existsSync(serviceFilePath)) {
        const existingContent = fs.readFileSync(serviceFilePath, 'utf-8');
        if (existingContent === expectedServiceContent) {
          logger.info('Systemd user service already installed and up to date');
          return;
        }
        logger.info('Systemd user service needs update, reinstalling...');
      }

      // Ensure directory exists
      if (!fs.existsSync(userServiceDir)) {
        fs.mkdirSync(userServiceDir, { recursive: true });
      }

      // Write service file
      fs.writeFileSync(serviceFilePath, expectedServiceContent, 'utf-8');
      logger.info('Installed systemd user service:', serviceFilePath);

      // Clean up old port file to ensure fresh start with custom port
      const portFile = path.join(this.ztHomeDir, 'zerotier-one.port');
      if (fs.existsSync(portFile)) {
        fs.unlinkSync(portFile);
        logger.info('Removed old port file');
      }

      // Reload systemd --user daemon to pick up changes
      await execAsync('systemctl --user daemon-reload');
      logger.info('Reloaded systemd user daemon');
    } catch (error: any) {
      logger.error('Failed to install user service:', error.message);
      throw error;
    }
  }

  /**
   * Check if systemd --user service is running
   */
  private async isUserServiceRunning(): Promise<boolean> {
    try {
      const { stdout } = await execAsync(`systemctl --user is-active ${this.serviceName}.service`);
      return stdout.trim() === 'active';
    } catch {
      return false;
    }
  }

  /**
   * Start ZeroTier (bundled daemon via systemd --user or system service)
   */
  async start(): Promise<void> {
    // If a start operation is already in progress, wait for it to complete
    if (this.startLock) {
      logger.info('Start operation already in progress, waiting...');
      await this.startLock;
      return;
    }

    // Create a new lock for this start operation
    this.startLock = this.performStart();

    try {
      await this.startLock;
    } finally {
      this.startLock = null;
    }
  }

  /**
   * Internal method to perform the actual start operation
   */
  private async performStart(): Promise<void> {
    try {
      // First check if daemon is already ready (regardless of how it was started)
      if (await this.isReady()) {
        logger.info('✓ ZeroTier daemon already running and ready');
        return;
      }

      if (this.useBundled) {
        // Check if service is running but daemon not ready yet
        const serviceRunning = await this.isUserServiceRunning();

        if (serviceRunning) {
          logger.info('Service already running, waiting for daemon to initialize...');

          // Wait up to 10 seconds for daemon to become ready
          const maxWaitTime = 10000; // 10 seconds
          const checkInterval = 500; // check every 500ms
          let waited = 0;

          while (waited < maxWaitTime) {
            if (await this.isReady()) {
              logger.info('✓ ZeroTier daemon is now ready');
              return;
            }
            await new Promise((resolve) => setTimeout(resolve, checkInterval));
            waited += checkInterval;
          }

          // Service running but daemon still not responding after 10s, try restart
          logger.info('Daemon not responding after 10s, restarting service...');
          await execAsync(`systemctl --user restart ${this.serviceName}.service`);
        } else {
          // Service not running, start it
          logger.info('Starting ZeroTier via systemd --user...');
          await execAsync(`systemctl --user start ${this.serviceName}.service`);
        }

        // Wait for daemon to become ready (up to 10 seconds)
        const maxWaitTime = 10000;
        const checkInterval = 500;
        let waited = 0;

        while (waited < maxWaitTime) {
          if (await this.isReady()) {
            logger.info('✓ ZeroTier daemon started and ready');
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, checkInterval));
          waited += checkInterval;
        }

        throw new Error('Daemon failed to become ready within 10 seconds. Check logs with: journalctl --user -u zima-zerotier.service');
      } else {
        // System service
        const isRunning = await this.isServiceRunning();

        if (isRunning) {
          logger.info('System service already running, waiting for daemon to initialize...');

          // Wait up to 10 seconds for daemon to become ready
          const maxWaitTime = 10000;
          const checkInterval = 500;
          let waited = 0;

          while (waited < maxWaitTime) {
            if (await this.isReady()) {
              logger.info('✓ ZeroTier daemon is now ready');
              return;
            }
            await new Promise((resolve) => setTimeout(resolve, checkInterval));
            waited += checkInterval;
          }

          // Service running but daemon still not responding, try restart
          logger.info('Daemon not responding after 10s, restarting service...');
          await execAsync('systemctl restart zima-zerotier.service');
        } else {
          logger.info('Starting zima-zerotier system service...');
          await execAsync('systemctl start zima-zerotier.service');
        }

        // Wait for daemon to become ready (up to 10 seconds)
        const maxWaitTime = 10000;
        const checkInterval = 500;
        let waited = 0;

        while (waited < maxWaitTime) {
          if (await this.isReady()) {
            logger.info('✓ ZeroTier daemon started and ready');
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, checkInterval));
          waited += checkInterval;
        }

        throw new Error('Daemon failed to become ready within 10 seconds. Check logs with: journalctl -u zima-zerotier.service');
      }
    } catch (error: any) {
      throw new Error(`Failed to start ZeroTier: ${error.message}`);
    }
  }

  /**
   * Stop ZeroTier (systemd --user service or system service)
   */
  async stop(): Promise<void> {
    try {
      if (this.useBundled) {
        // Stop bundled daemon via systemd --user service
        logger.info('Stopping ZeroTier via systemd --user...');
        await execAsync(`systemctl --user stop ${this.serviceName}.service`);
        logger.info('✓ ZeroTier service stopped');
      } else {
        // Stop system service
        await execAsync('systemctl stop zima-zerotier.service');
        logger.info('✓ ZeroTier service stopped');
      }
    } catch (error: any) {
      logger.warn('Failed to stop ZeroTier:', error.message);
    }
  }

  /**
   * Restart ZeroTier (systemd --user service or system service)
   */
  async restart(): Promise<void> {
    try {
      if (this.useBundled) {
        await execAsync(`systemctl --user restart ${this.serviceName}.service`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
        logger.info('✓ ZeroTier restarted');
      } else {
        await this.stop();
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await this.start();
        logger.info('✓ ZeroTier restarted');
      }
    } catch (error: any) {
      throw new Error(`Failed to restart ZeroTier: ${error.message}`);
    }
  }

  /**
   * Cleanup on app exit
   * Optionally stop the ZeroTier service based on user preference
   */
  async cleanup(stopService: boolean = false): Promise<void> {
    if (stopService) {
      logger.info('Stopping ZeroTier service as requested...');
      try {
        await this.stop();
        logger.info('✓ ZeroTier service stopped');
      } catch (error) {
        logger.error('Failed to stop ZeroTier service:', error);
      }
    } else {
      // Default behavior: service continues running for background connectivity
      logger.info('ZeroTier service will continue running in background');
      logger.info('To stop the service on exit, configure the app settings or run:');
      if (this.useBundled) {
        logger.info(`  systemctl --user stop ${this.serviceName}.service`);
      } else {
        logger.info('  systemctl stop zima-zerotier.service');
      }
    }
  }

  /**
   * Check if zima-zerotier service is running
   */
  private async isServiceRunning(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('systemctl is-active zima-zerotier.service');
      return stdout.trim() === 'active';
    } catch {
      return false;
    }
  }

  /**
   * Join a ZeroTier network via CLI
   */
  async joinNetwork(networkId: string): Promise<{ gatewayIP: string | null }> {
    const sanitizedNetworkId = sanitizeNetworkId(networkId);
    logger.info('Joining network:', sanitizedNetworkId);

    try {
      // Join using CLI (communicates with daemon via port and token)
      const args = await this.buildCliArgs(['join', sanitizedNetworkId]);
      await execFileAsync(this.ztCli, args);
      logger.info('Join command sent');

      // Wait for connection
      await this.waitForConnection(sanitizedNetworkId);

      // Get gateway IP from routes
      const networks = await this.getNetworks();
      const network = networks.find((n) => n.id === sanitizedNetworkId);

      if (network && network.routes && network.routes.length > 0) {
        const route = network.routes[0];
        if (route && route.target) {
          // Extract gateway IP (e.g., "10.147.14.0/24" -> "10.147.14.1")
          const match = route.target.match(/^(\d+\.\d+\.\d+)\.\d+\/\d+$/);
          if (match) {
            const gatewayIP = `${match[1]}.1`;
            logger.info('Gateway IP:', gatewayIP);
            return { gatewayIP };
          }
        }
      }

      return { gatewayIP: null };
    } catch (error: any) {
      logger.error('Failed to join network:', error.message);
      throw error;
    }
  }

  /**
   * Leave a ZeroTier network
   */
  async leaveNetwork(networkId: string): Promise<void> {
    const sanitizedNetworkId = sanitizeNetworkId(networkId);
    logger.info('Leaving network:', sanitizedNetworkId);

    try {
      const args = await this.buildCliArgs(['leave', sanitizedNetworkId]);
      await execFileAsync(this.ztCli, args);
      logger.info('Leave command sent');
    } catch (error: any) {
      logger.error('Failed to leave network:', error.message);
      throw error;
    }
  }

  /**
   * Get list of joined networks
   */
  async getNetworks(): Promise<ZeroTierNetwork[]> {
    try {
      const args = await this.buildCliArgs(['listnetworks', '-j']);
      const { stdout } = await execFileAsync(this.ztCli, args);
      const networks = JSON.parse(stdout);

      return networks.map((net: any) => ({
        id: net.id,
        name: net.name || net.id,
        status: net.status,
        type: net.type,
        mac: net.mac,
        bridge: net.bridge,
        allowManaged: net.allowManaged,
        allowGlobal: net.allowGlobal,
        allowDefault: net.allowDefault,
        allowDNS: net.allowDNS,
        portDeviceName: net.portDeviceName,
        assignedAddresses: net.assignedAddresses || [],
        routes: net.routes || [],
      }));
    } catch (error: any) {
      logger.error('Failed to get networks:', error.message);
      return [];
    }
  }

  /**
   * Get ZeroTier service status
   */
  async getStatus(): Promise<any> {
    try {
      const args = await this.buildCliArgs(['info', '-j']);
      const { stdout } = await execFileAsync(this.ztCli, args);
      return JSON.parse(stdout);
    } catch (error: any) {
      throw new Error(`ZeroTier not responding: ${error.message}`);
    }
  }

  /**
   * Wait for network connection to establish
   */
  private async waitForConnection(networkId: string, timeout: number = 30000): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const networks = await this.getNetworks();
      const network = networks.find((n) => n.id === networkId);

      if (network && network.status === 'OK') {
        logger.info('Successfully connected to network:', networkId);
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error('Failed to connect to network within timeout');
  }

  /**
   * Check if daemon is ready
   * Returns true if daemon is running and responding to API calls
   */
  async isReady(): Promise<boolean> {
    try {
      // First check if port and token files exist
      const portFile = path.join(this.ztHomeDir, 'zerotier-one.port');
      const tokenFile = path.join(this.ztHomeDir, 'authtoken.secret');

      if (!fs.existsSync(portFile) || !fs.existsSync(tokenFile)) {
        logger.info('[isReady] Port or token file missing, daemon not ready');
        return false;
      }

      await this.getStatus();
      return true;
    } catch (error) {
      // Silently fail - this is just a status check
      return false;
    }
  }

  /**
   * Get ZeroTier daemon port from port file
   */
  private async getPort(): Promise<string> {
    const portFile = path.join(this.ztHomeDir, 'zerotier-one.port');
    if (!fs.existsSync(portFile)) {
      throw new Error('ZeroTier port file not found. Daemon may not be running.');
    }
    try {
      return fs.readFileSync(portFile, 'utf-8').trim();
    } catch (error: any) {
      if (error.code === 'EACCES') {
        throw new Error(`Permission denied reading ${portFile}. If you just installed, try logging out and back in, or run: sudo chmod 644 ${portFile}`);
      }
      throw error;
    }
  }

  /**
   * Get ZeroTier auth token from auth file
   */
  private async getToken(): Promise<string> {
    const tokenFile = path.join(this.ztHomeDir, 'authtoken.secret');
    if (!fs.existsSync(tokenFile)) {
      throw new Error('ZeroTier auth token not found. Daemon may not be running.');
    }
    try {
      return fs.readFileSync(tokenFile, 'utf-8').trim();
    } catch (error: any) {
      if (error.code === 'EACCES') {
        throw new Error(`Permission denied reading ${tokenFile}. If you just installed, try logging out and back in, or run: sudo chmod 644 ${tokenFile}`);
      }
      throw error;
    }
  }

  /**
   * Build CLI arguments with port and token
   */
  private async buildCliArgs(command: string[]): Promise<string[]> {
    const port = await this.getPort();
    const token = await this.getToken();
    return [`-D${this.ztHomeDir}`, `-p${port}`, `-T${token}`, ...command];
  }
}
