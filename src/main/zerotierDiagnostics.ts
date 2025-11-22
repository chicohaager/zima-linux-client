import { exec } from 'child_process';
import { promisify } from 'util';
import { access, stat, constants } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { ZeroTierDiagnostics, CheckResult, StatusLevel } from '@shared/types';

const execAsync = promisify(exec);

/**
 * Get paths for ZeroTier binaries and data directory
 */
function getZeroTierPaths() {
  const home = homedir();
  return {
    zerotierOne: join(home, '.local/lib/zima-remote/zerotier/zerotier-one'),
    zerotierCli: join(home, '.local/lib/zima-remote/zerotier/zerotier-cli'),
    dataDir: join(home, '.zima-zerotier'),
  };
}

/**
 * Check if zerotier-one binary exists and is executable
 */
async function checkZeroTierOneBinary(): Promise<CheckResult> {
  const { zerotierOne } = getZeroTierPaths();

  try {
    await access(zerotierOne, constants.X_OK);

    // Try to get version
    try {
      const { stdout } = await execAsync(`"${zerotierOne}" -v`, { timeout: 5000 });
      const version = stdout.trim();
      return {
        id: 'zerotier-one-binary',
        label: 'ZeroTier One Binary',
        status: 'ok',
        message: `Binary is executable (version ${version})`,
        details: `Path: ${zerotierOne}\nVersion: ${version}`,
      };
    } catch (versionError) {
      return {
        id: 'zerotier-one-binary',
        label: 'ZeroTier One Binary',
        status: 'warn',
        message: 'Binary exists but version check failed',
        details: `Path: ${zerotierOne}\nError: ${versionError instanceof Error ? versionError.message : String(versionError)}`,
      };
    }
  } catch (error) {
    return {
      id: 'zerotier-one-binary',
      label: 'ZeroTier One Binary',
      status: 'error',
      message: 'Binary not found or not executable',
      details: `Expected path: ${zerotierOne}\nError: ${error instanceof Error ? error.message : String(error)}\n\nPlease reinstall the application.`,
    };
  }
}

/**
 * Check if zerotier-cli binary exists and is executable
 */
async function checkZeroTierCliBinary(): Promise<CheckResult> {
  const { zerotierCli } = getZeroTierPaths();

  try {
    await access(zerotierCli, constants.X_OK);
    return {
      id: 'zerotier-cli-binary',
      label: 'ZeroTier CLI Binary',
      status: 'ok',
      message: 'CLI binary is executable',
      details: `Path: ${zerotierCli}`,
    };
  } catch (error) {
    return {
      id: 'zerotier-cli-binary',
      label: 'ZeroTier CLI Binary',
      status: 'error',
      message: 'CLI binary not found or not executable',
      details: `Expected path: ${zerotierCli}\nError: ${error instanceof Error ? error.message : String(error)}\n\nPlease reinstall the application.`,
    };
  }
}

/**
 * Check systemd user service status
 */
async function checkSystemdService(): Promise<CheckResult> {
  try {
    const { stdout } = await execAsync('systemctl --user is-active zima-zerotier.service', { timeout: 5000 });
    const status = stdout.trim();

    if (status === 'active') {
      return {
        id: 'systemd-service',
        label: 'Systemd Service',
        status: 'ok',
        message: 'Service is active and running',
        details: 'Status: active\n\nCheck full status: systemctl --user status zima-zerotier.service',
      };
    } else {
      return {
        id: 'systemd-service',
        label: 'Systemd Service',
        status: 'error',
        message: `Service is not active (status: ${status})`,
        details: `Status: ${status}\n\nTry restarting the service:\n  systemctl --user restart zima-zerotier.service\n\nCheck logs:\n  journalctl --user -u zima-zerotier.service -n 50`,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      id: 'systemd-service',
      label: 'Systemd Service',
      status: 'error',
      message: 'Service check failed',
      details: `Error: ${errorMessage}\n\nThe service may not be installed or enabled.\n\nTry:\n  systemctl --user enable --now zima-zerotier.service\n\nIf that fails, reinstall the application.`,
    };
  }
}

/**
 * Check if data directory exists
 */
async function checkDataDirectory(): Promise<CheckResult> {
  const { dataDir } = getZeroTierPaths();

  try {
    const stats = await stat(dataDir);

    if (stats.isDirectory()) {
      return {
        id: 'data-directory',
        label: 'Data Directory',
        status: 'ok',
        message: 'Data directory exists',
        details: `Path: ${dataDir}`,
      };
    } else {
      return {
        id: 'data-directory',
        label: 'Data Directory',
        status: 'error',
        message: 'Path exists but is not a directory',
        details: `Path: ${dataDir}\n\nPlease remove the file and restart the service.`,
      };
    }
  } catch (error) {
    return {
      id: 'data-directory',
      label: 'Data Directory',
      status: 'warn',
      message: 'Data directory does not exist',
      details: `Expected path: ${dataDir}\n\nThis is normal on first run. The directory will be created when the service starts.`,
    };
  }
}

/**
 * Check if TUN device exists
 */
async function checkTunDevice(): Promise<CheckResult> {
  const tunPath = '/dev/net/tun';

  try {
    const stats = await stat(tunPath);

    if (stats.isCharacterDevice()) {
      return {
        id: 'tun-device',
        label: 'TUN Device',
        status: 'ok',
        message: 'TUN device is available',
        details: `Path: ${tunPath}`,
      };
    } else {
      return {
        id: 'tun-device',
        label: 'TUN Device',
        status: 'error',
        message: 'TUN path exists but is not a character device',
        details: `Path: ${tunPath}\n\nThis should not happen. Please check your system configuration.`,
      };
    }
  } catch (error) {
    return {
      id: 'tun-device',
      label: 'TUN Device',
      status: 'error',
      message: 'TUN device not found',
      details: `Expected path: ${tunPath}\n\nThe TUN kernel module may not be loaded.\n\nTry:\n  sudo modprobe tun\n\nTo load it automatically on boot, add 'tun' to /etc/modules`,
    };
  }
}

/**
 * Get ZeroTier node info
 */
async function checkNodeInfo(): Promise<CheckResult> {
  const { zerotierCli, dataDir } = getZeroTierPaths();

  try {
    const { stdout, stderr } = await execAsync(
      `"${zerotierCli}" -D "${dataDir}" info`,
      { timeout: 10000 }
    );

    if (stdout && stdout.trim()) {
      return {
        id: 'node-info',
        label: 'ZeroTier Node Info',
        status: 'ok',
        message: 'Node is responding',
        details: stdout.trim(),
      };
    } else {
      return {
        id: 'node-info',
        label: 'ZeroTier Node Info',
        status: 'error',
        message: 'Command succeeded but returned no data',
        details: stderr || 'No output received',
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const stderr = (error as any).stderr || '';

    return {
      id: 'node-info',
      label: 'ZeroTier Node Info',
      status: 'error',
      message: 'Failed to get node info',
      details: `Error: ${errorMessage}\n${stderr}\n\nThe ZeroTier daemon may not be running or may not have initialized yet.\n\nCheck service status:\n  systemctl --user status zima-zerotier.service\n\nCheck logs:\n  journalctl --user -u zima-zerotier.service -n 50`,
    };
  }
}

/**
 * List joined networks
 */
async function checkJoinedNetworks(): Promise<CheckResult> {
  const { zerotierCli, dataDir } = getZeroTierPaths();

  try {
    const { stdout, stderr } = await execAsync(
      `"${zerotierCli}" -D "${dataDir}" listnetworks`,
      { timeout: 10000 }
    );

    if (!stdout || !stdout.trim()) {
      return {
        id: 'joined-networks',
        label: 'Joined Networks',
        status: 'error',
        message: 'Failed to list networks',
        details: stderr || 'No output received',
      };
    }

    const lines = stdout.trim().split('\n');

    // First line is usually the header (200 listnetworks <header>)
    // If there are more lines, networks are joined
    if (lines.length > 1) {
      const networkCount = lines.length - 1;
      return {
        id: 'joined-networks',
        label: 'Joined Networks',
        status: 'ok',
        message: `${networkCount} network(s) joined`,
        details: stdout.trim(),
      };
    } else {
      return {
        id: 'joined-networks',
        label: 'Joined Networks',
        status: 'warn',
        message: 'ZeroTier is running, but no network is joined',
        details: `${stdout.trim()}\n\nPlease join a network in the main UI to connect to your ZimaOS server.`,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const stderr = (error as any).stderr || '';

    return {
      id: 'joined-networks',
      label: 'Joined Networks',
      status: 'error',
      message: 'Failed to list networks',
      details: `Error: ${errorMessage}\n${stderr}\n\nThe ZeroTier daemon may not be running.\n\nCheck service status:\n  systemctl --user status zima-zerotier.service`,
    };
  }
}

/**
 * Run all ZeroTier diagnostics
 */
export async function runZeroTierDiagnostics(): Promise<ZeroTierDiagnostics> {
  const checks: CheckResult[] = [];

  // Run all checks in parallel for speed
  const results = await Promise.all([
    checkZeroTierOneBinary(),
    checkZeroTierCliBinary(),
    checkSystemdService(),
    checkDataDirectory(),
    checkTunDevice(),
    checkNodeInfo(),
    checkJoinedNetworks(),
  ]);

  checks.push(...results);

  return {
    timestamp: new Date().toISOString(),
    checks,
  };
}
