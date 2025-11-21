import { exec, execFile } from 'child_process';
import { logger } from '../utils/logger';
import { promisify } from 'util';
import { SMBShare } from '@shared/types';
import { sanitizeIPAddress, sanitizeHostname, sanitizeSMBShareName, escapeShellArg } from '../utils/sanitize';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export class SMBManager {
  /**
   * Discover SMB shares on a host
   * @param host IP address or hostname
   * @param username Optional username for authentication
   * @param password Optional password for authentication
   * @param includeAdminShares Include hidden/admin shares ending with $
   */
  async discoverShares(
    host: string,
    username?: string,
    password?: string,
    includeAdminShares: boolean = false
  ): Promise<SMBShare[]> {
    const shares: SMBShare[] = [];

    try {
      logger.info('Discovering shares on:', { host, user: username ? `(as ${username})` : '(guest)' });

      // Sanitize host to prevent command injection
      let sanitizedHost: string;
      try {
        sanitizedHost = sanitizeIPAddress(host);
      } catch {
        // If not an IP, try as hostname
        sanitizedHost = sanitizeHostname(host);
      }

      // Build command arguments array (safer than shell string)
      const args: string[] = ['-L', sanitizedHost];

      if (username && password) {
        // Pass credentials via -U flag
        args.push('-U', `${username}%${password}`);
      } else {
        args.push('-N'); // No password (guest)
      }

      // Use -g for grepable output (easier parsing)
      args.push('-g');

      // Use execFile instead of exec for better security
      const { stdout } = await execFileAsync('smbclient', args, {
        timeout: 10000,
      });

      // Parse grepable output format: "Disk|ShareName|Comment"
      const lines = stdout.split('\n');

      for (const line of lines) {
        if (!line.trim()) continue;

        // Grepable format: Type|Name|Comment
        const parts = line.split('|');
        if (parts.length < 2) continue;

        const type = parts[0]?.trim().toLowerCase();
        const name = parts[1]?.trim();
        const comment = parts[2]?.trim() || '';

        // Only process Disk shares (skip IPC$, ADMIN$, etc. unless requested)
        if (type === 'disk' && name) {
          // Skip administrative/hidden shares unless explicitly requested
          if (!includeAdminShares && name.endsWith('$')) {
            logger.info(`Skipping admin share: ${name}`);
            continue;
          }

          shares.push({
            host,
            name,
            displayName: `${host} - ${name}`,
            type: 'disk',
            comment: comment || undefined,
            pinned: false,
          });

          logger.info(`Found share: ${name} (${comment || 'no description'})`);
        }
      }

      logger.info(`Discovery complete: ${shares.length} shares found on ${host}`);
    } catch (error: any) {
      logger.error(`Failed to discover shares on ${host}:`, error.message);
      // Don't throw - return empty array so other hosts can still be processed
    }

    return shares;
  }

  async testConnection(host: string, share: string, username?: string, password?: string): Promise<boolean> {
    try {
      // Sanitize inputs
      let sanitizedHost: string;
      try {
        sanitizedHost = sanitizeIPAddress(host);
      } catch {
        sanitizedHost = sanitizeHostname(host);
      }
      const sanitizedShare = sanitizeSMBShareName(share);

      // Build arguments array for safer execution
      const args: string[] = [`//${sanitizedHost}/${sanitizedShare}`];

      if (username && password) {
        args.push('-U', `${username}%${password}`);
      } else {
        args.push('-N');
      }

      args.push('-c', 'ls');

      await execFileAsync('smbclient', args, { timeout: 5000 });
      return true;
    } catch (error) {
      logger.error('Failed to connect to share:', error);
      return false;
    }
  }

  async mountShare(
    share: SMBShare,
    mountPoint: string,
    credentials?: { username: string; password: string }
  ): Promise<void> {
    try {
      // Sanitize inputs
      let sanitizedHost: string;
      try {
        sanitizedHost = sanitizeIPAddress(share.host);
      } catch {
        sanitizedHost = sanitizeHostname(share.host);
      }
      const sanitizedShare = sanitizeSMBShareName(share.name);
      const sanitizedMountPoint = escapeShellArg(mountPoint);

      let cmd = `mount -t cifs //${sanitizedHost}/${sanitizedShare} ${sanitizedMountPoint}`;

      if (credentials) {
        // Escape credentials to prevent injection
        const escapedUser = escapeShellArg(credentials.username);
        const escapedPass = escapeShellArg(credentials.password);
        cmd += ` -o username=${escapedUser},password=${escapedPass}`;
      } else {
        cmd += ' -o guest';
      }

      await execAsync(cmd);
      logger.info('Share mounted successfully');
    } catch (error) {
      logger.error('Failed to mount share:', error);
      throw error;
    }
  }

  async unmountShare(mountPoint: string): Promise<void> {
    try {
      // Sanitize mount point to prevent injection
      const sanitizedMountPoint = escapeShellArg(mountPoint);
      await execAsync(`umount ${sanitizedMountPoint}`);
      logger.info('Share unmounted successfully');
    } catch (error) {
      logger.error('Failed to unmount share:', error);
      throw error;
    }
  }

  getSMBUrl(share: SMBShare): string {
    return `smb://${share.host}/${share.name}`;
  }
}
