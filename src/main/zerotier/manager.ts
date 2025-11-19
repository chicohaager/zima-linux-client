import { execFile, exec, spawn, ChildProcess } from 'child_process';
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
        console.log('Found development bundled binaries:', devCliPath, devBinaryPath);
      }
    } else {
      // Production: check bundled resources
      const prodCliPath = path.join(process.resourcesPath, 'bin/zerotier', arch, 'zerotier-cli');
      const prodBinaryPath = path.join(process.resourcesPath, 'bin/zerotier', arch, 'zerotier-one');
      if (fs.existsSync(prodCliPath) && fs.existsSync(prodBinaryPath)) {
        bundledCliPath = prodCliPath;
        bundledBinaryPath = prodBinaryPath;
        console.log('Found production bundled binaries:', prodCliPath, prodBinaryPath);
      }
    }

    // Try system paths in order of preference
    const possibleCliPaths = [
      bundledCliPath,                       // Bundled binaries (preferred)
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
        this.useBundled = (cliPath === bundledCliPath);
        if (this.useBundled) {
          this.ztBinary = bundledBinaryPath;
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

    console.log('ZeroTier Manager initialized');
    console.log('CLI path:', this.ztCli);
    console.log('Home directory:', this.ztHomeDir);
    console.log('Using bundled binaries:', this.useBundled);

    // Install systemd user service if using bundled binaries
    if (this.useBundled) {
      this.setupBundledDaemon().catch(err => {
        console.warn('Failed to setup bundled daemon:', err.message);
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
        console.log('Created local binary directory:', localBinaryDir);
      }

      // Copy binaries if they don't exist or are outdated
      let binaryUpdated = false;
      if (!fs.existsSync(localBinaryPath) || !fs.existsSync(localCliPath)) {
        console.log('Copying ZeroTier binaries to local lib directory...');
        fs.copyFileSync(this.ztBinary, localBinaryPath);
        fs.copyFileSync(this.ztCli, localCliPath);
        fs.chmodSync(localBinaryPath, 0o755);
        fs.chmodSync(localCliPath, 0o755);
        binaryUpdated = true;
        console.log('✓ Binaries copied to:', localBinaryDir);
      }

      // Update paths to use local copies
      this.ztBinary = localBinaryPath;
      this.ztCli = localCliPath;

      // Check TUN device availability
      await this.checkTunDevice();

      // Check if capabilities are already set
      const needsSetup = await this.needsCapabilitySetup();

      if (needsSetup || binaryUpdated) {
        console.log('\n=== ZeroTier Setup Required ===');
        console.log('ZeroTier needs network capabilities for creating virtual interfaces.');
        console.log('This is a ONE-TIME setup.\n');
        console.log('Please run this command in a terminal:\n');
        console.log(`sudo setcap cap_net_admin,cap_net_raw=eip ${this.ztBinary}\n`);
        console.log('Then restart the application.');
        console.log('===============================\n');
      }

      await this.installUserService();
    } catch (error: any) {
      console.error('Failed to setup bundled daemon:', error.message);
    }
  }

  /**
   * Check if TUN device is available
   */
  private async checkTunDevice(): Promise<void> {
    try {
      const tunDeviceExists = fs.existsSync('/dev/net/tun');
      if (!tunDeviceExists) {
        console.log('TUN device not found. Loading tun kernel module...');
        await execAsync('sudo modprobe tun').catch(() => {
          console.warn('Could not load tun module. You may need to run: sudo modprobe tun');
        });
      }
    } catch (error) {
      console.warn('Could not check TUN device:', error);
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
ExecStop=${this.ztCli} -D ${this.ztHomeDir} shutdown
Restart=always
NoNewPrivileges=false

[Install]
WantedBy=default.target
`;

      // Check if service file already exists and is up to date
      if (fs.existsSync(serviceFilePath)) {
        const existingContent = fs.readFileSync(serviceFilePath, 'utf-8');
        if (existingContent === expectedServiceContent) {
          console.log('Systemd user service already installed and up to date');
          return;
        }
        console.log('Systemd user service needs update, reinstalling...');
      }

      // Ensure directory exists
      if (!fs.existsSync(userServiceDir)) {
        fs.mkdirSync(userServiceDir, { recursive: true });
      }

      // Write service file
      fs.writeFileSync(serviceFilePath, expectedServiceContent, 'utf-8');
      console.log('Installed systemd user service:', serviceFilePath);

      // Clean up old port file to ensure fresh start with custom port
      const portFile = path.join(this.ztHomeDir, 'zerotier-one.port');
      if (fs.existsSync(portFile)) {
        fs.unlinkSync(portFile);
        console.log('Removed old port file');
      }

      // Reload systemd --user daemon
      await execAsync('systemctl --user daemon-reload');
      console.log('Reloaded systemd user daemon');
    } catch (error: any) {
      console.error('Failed to install user service:', error.message);
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
    try {
      // First check if daemon is already ready (regardless of how it was started)
      if (await this.isReady()) {
        console.log('✓ ZeroTier daemon already running and ready');
        return;
      }

      if (this.useBundled) {
        // Check if service is running but daemon not ready yet
        if (await this.isUserServiceRunning()) {
          console.log('Service running, waiting for daemon to be ready...');
          // Wait a bit for daemon to initialize
          await new Promise((resolve) => setTimeout(resolve, 2000));

          if (await this.isReady()) {
            console.log('✓ ZeroTier daemon is now ready');
            return;
          }

          // Service running but daemon not responding, restart
          console.log('Service running but daemon not responding, restarting...');
          await execAsync(`systemctl --user restart ${this.serviceName}.service`);
        } else {
          // Service not running, start it
          console.log('Starting ZeroTier via systemd --user...');
          await execAsync(`systemctl --user start ${this.serviceName}.service`);
        }

        // Wait for service to start
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Verify daemon is ready
        if (await this.isReady()) {
          console.log('✓ ZeroTier daemon started and ready');
        } else {
          throw new Error('Daemon failed to become ready after service start');
        }
      } else {
        // System service
        const isRunning = await this.isServiceRunning();
        if (isRunning) {
          console.log('Service running, waiting for daemon to be ready...');
          await new Promise((resolve) => setTimeout(resolve, 2000));

          if (await this.isReady()) {
            console.log('✓ ZeroTier daemon is now ready');
            return;
          }

          console.log('Service running but daemon not responding, restarting...');
          await execAsync('systemctl restart zima-zerotier.service');
        } else {
          console.log('Starting zima-zerotier service...');
          await execAsync('systemctl start zima-zerotier.service');
        }

        // Wait for service to start
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Verify
        if (await this.isReady()) {
          console.log('✓ ZeroTier daemon started and ready');
        } else {
          throw new Error('Daemon failed to become ready after service start');
        }
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
        console.log('Stopping ZeroTier via systemd --user...');
        await execAsync(`systemctl --user stop ${this.serviceName}.service`);
        console.log('✓ ZeroTier service stopped');
      } else {
        // Stop system service
        await execAsync('systemctl stop zima-zerotier.service');
        console.log('✓ ZeroTier service stopped');
      }
    } catch (error: any) {
      console.warn('Failed to stop ZeroTier:', error.message);
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
        console.log('✓ ZeroTier restarted');
      } else {
        await this.stop();
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await this.start();
        console.log('✓ ZeroTier restarted');
      }
    } catch (error: any) {
      throw new Error(`Failed to restart ZeroTier: ${error.message}`);
    }
  }

  /**
   * Cleanup on app exit
   */
  async cleanup(): Promise<void> {
    // Systemd --user service will continue running after app exit
    // This is intentional for background connectivity
    console.log('ZeroTier service will continue running in background');
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
    console.log('Joining network:', sanitizedNetworkId);

    try {
      // Join using CLI (communicates with daemon via port and token)
      const args = await this.buildCliArgs(['join', sanitizedNetworkId]);
      await execFileAsync(this.ztCli, args);
      console.log('Join command sent');

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
            console.log('Gateway IP:', gatewayIP);
            return { gatewayIP };
          }
        }
      }

      return { gatewayIP: null };
    } catch (error: any) {
      console.error('Failed to join network:', error.message);
      throw error;
    }
  }

  /**
   * Leave a ZeroTier network
   */
  async leaveNetwork(networkId: string): Promise<void> {
    const sanitizedNetworkId = sanitizeNetworkId(networkId);
    console.log('Leaving network:', sanitizedNetworkId);

    try {
      const args = await this.buildCliArgs(['leave', sanitizedNetworkId]);
      await execFileAsync(this.ztCli, args);
      console.log('Leave command sent');
    } catch (error: any) {
      console.error('Failed to leave network:', error.message);
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
      console.error('Failed to get networks:', error.message);
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
        console.log('Successfully connected to network:', networkId);
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error('Failed to connect to network within timeout');
  }

  /**
   * Check if daemon is ready
   */
  async isReady(): Promise<boolean> {
    try {
      await this.getStatus();
      return true;
    } catch {
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
    return fs.readFileSync(portFile, 'utf-8').trim();
  }

  /**
   * Get ZeroTier auth token from auth file
   */
  private async getToken(): Promise<string> {
    const tokenFile = path.join(this.ztHomeDir, 'authtoken.secret');
    if (!fs.existsSync(tokenFile)) {
      throw new Error('ZeroTier auth token not found. Daemon may not be running.');
    }
    return fs.readFileSync(tokenFile, 'utf-8').trim();
  }

  /**
   * Build CLI arguments with port and token
   */
  private async buildCliArgs(command: string[]): Promise<string[]> {
    const port = await this.getPort();
    const token = await this.getToken();
    return [`-p${port}`, `-T${token}`, ...command];
  }
}
