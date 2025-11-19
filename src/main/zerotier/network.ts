import { exec } from 'child_process';
import { promisify } from 'util';
import * as net from 'net';
import * as http from 'http';
import { sanitizeIPAddress } from '../utils/sanitize';

const execAsync = promisify(exec);

export class NetworkManager {
  async getLocalIPAddresses(): Promise<string[]> {
    try {
      const { stdout } = await execAsync('hostname -I');
      // Filter out IPv6 and Docker networks, keep only real IPv4
      return stdout.trim().split(/\s+/).filter(ip =>
        ip.includes('.') &&
        !ip.startsWith('172.17.') && // Docker
        !ip.startsWith('172.18.') &&
        !ip.startsWith('172.19.') &&
        !ip.startsWith('172.20.')
      );
    } catch (error) {
      console.error('Failed to get IP addresses:', error);
      return [];
    }
  }

  async getZeroTierNetworks(): Promise<string[]> {
    try {
      // Get only IPs from ZeroTier interfaces (zt*)
      const allIPs = await execAsync('ip addr show | grep "inet.*zt"');
      const ztIPs: string[] = [];

      const matches = allIPs.stdout.matchAll(/inet\s+([\d.]+)\/\d+/g);
      for (const match of matches) {
        if (match[1]) {
          ztIPs.push(match[1]);
        }
      }

      return ztIPs;
    } catch (error) {
      console.error('Failed to get ZeroTier IPs:', error);
      return [];
    }
  }

  async getZeroTierIPAddress(_networkId: string): Promise<string | null> {
    try {
      const { stdout } = await execAsync('ip addr show');

      // Look for ZeroTier interface (usually zt*)
      const ztInterfaceMatch = stdout.match(/inet\s+([\d.]+)\/\d+.*zt\w+/);

      if (ztInterfaceMatch) {
        return ztInterfaceMatch[1];
      }

      return null;
    } catch (error) {
      console.error('Failed to get ZeroTier IP:', error);
      return null;
    }
  }

  async pingHost(host: string, timeout: number = 2000): Promise<boolean> {
    try {
      // Sanitize host to prevent command injection
      const sanitizedHost = sanitizeIPAddress(host);
      await execAsync(`ping -c 1 -W ${timeout / 1000} ${sanitizedHost}`);
      return true;
    } catch (error) {
      return false;
    }
  }

  async scanLocalNetwork(subnet: string = '192.168.1'): Promise<string[]> {
    console.log(`Scanning subnet: ${subnet}.0/24`);
    const activeHosts: string[] = [];

    // Parallel ping sweep with very fast timeout (100ms is enough for local network)
    const pingPromises: Promise<string | null>[] = [];

    for (let i = 1; i < 255; i++) {
      const host = `${subnet}.${i}`;
      pingPromises.push(
        this.pingHost(host, 100).then(isActive => isActive ? host : null)
      );
    }

    // Wait for all pings to complete
    const results = await Promise.all(pingPromises);

    // Filter out nulls
    for (const host of results) {
      if (host) {
        console.log(`Found active host: ${host}`);
        activeHosts.push(host);
      }
    }

    console.log(`Scan complete for ${subnet}.0/24: ${activeHosts.length} hosts found`);
    return activeHosts;
  }

  /**
   * Check if a TCP port is open on a host
   */
  private async checkTCPPort(host: string, port: number, timeout: number = 2000): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let isResolved = false;

      const cleanup = () => {
        if (!isResolved) {
          isResolved = true;
          socket.destroy();
        }
      };

      // Set timeout
      const timer = setTimeout(() => {
        cleanup();
        resolve(false);
      }, timeout);

      socket.on('connect', () => {
        clearTimeout(timer);
        cleanup();
        resolve(true);
      });

      socket.on('error', () => {
        clearTimeout(timer);
        cleanup();
        resolve(false);
      });

      socket.on('timeout', () => {
        clearTimeout(timer);
        cleanup();
        resolve(false);
      });

      try {
        socket.connect(port, host);
      } catch (error) {
        clearTimeout(timer);
        cleanup();
        resolve(false);
      }
    });
  }

  /**
   * Scan subnet for SMB/CIFS servers (TCP 445)
   * This is more reliable than ping for finding SMB shares
   */
  async scanSubnetForSMB(subnet: string, progressCallback?: (progress: number) => void): Promise<string[]> {
    console.log(`Scanning subnet ${subnet}.0/24 for SMB servers (TCP 445)...`);
    const smbHosts: string[] = [];
    const scanPromises: Promise<{ host: string; hasSmb: boolean }>[] = [];

    // Scan in batches to avoid overwhelming the network
    const batchSize = 50;
    const totalHosts = 254;

    for (let i = 1; i < 255; i++) {
      const host = `${subnet}.${i}`;

      scanPromises.push(
        this.checkTCPPort(host, 445, 1500).then(hasSmb => {
          if (progressCallback) {
            const progress = Math.floor((i / totalHosts) * 100);
            progressCallback(progress);
          }
          return { host, hasSmb };
        })
      );

      // Process in batches
      if (scanPromises.length >= batchSize || i === 254) {
        const batchResults = await Promise.all(scanPromises);
        scanPromises.length = 0; // Clear array

        for (const result of batchResults) {
          if (result.hasSmb) {
            console.log(`Found SMB server: ${result.host}`);
            smbHosts.push(result.host);
          }
        }
      }
    }

    console.log(`SMB scan complete: ${smbHosts.length} servers found`);
    return smbHosts;
  }

  /**
   * Extract subnet from IP/CIDR (e.g., "10.147.14.5/24" -> "10.147.14")
   */
  extractSubnet(ipCidr: string): string | null {
    const match = ipCidr.match(/^(\d+\.\d+\.\d+)\.\d+/);
    return match ? match[1] : null;
  }

  /**
   * Check if a host is a ZimaOS device by probing ZimaOS-specific API endpoints
   * and validating the response format
   * Optimized: checks all endpoints in parallel and returns as soon as one matches
   */
  async isZimaOSDevice(host: string, timeout: number = 1500): Promise<boolean> {
    // Try multiple ZimaOS-specific endpoints with response validation
    const endpoints = [
      { path: '/v2/app_management/compose' },
      { path: '/v1/sys/info' },
      { path: '/v2/sys/info' },
      { path: '/v1/sys/version' },
    ];

    // Probe all endpoints in parallel for speed
    const probePromises = endpoints.map(endpoint =>
      this.httpProbeWithValidation(host, endpoint.path, timeout)
        .then(result => ({ ...result, path: endpoint.path }))
        .catch(() => ({ isValid: false, path: endpoint.path, server: undefined }))
    );

    try {
      // Check all probes in parallel
      const results = await Promise.all(probePromises);

      // Find first valid result
      const validResult = results.find(r => r.isValid);

      if (validResult) {
        console.log(`✓ ${host} is ZimaOS (validated ${validResult.path}, server: ${validResult.server || 'unknown'})`);
        return true;
      }
    } catch (error) {
      // All probes failed
    }

    console.log(`✗ ${host} is not ZimaOS`);
    return false;
  }

  /**
   * Make an HTTP GET request and validate if it's a ZimaOS API response
   */
  private async httpProbeWithValidation(
    host: string,
    path: string,
    timeout: number = 3000
  ): Promise<{ isValid: boolean; server?: string }> {
    return new Promise((resolve) => {
      const options = {
        hostname: host,
        port: 80,
        path: path,
        method: 'GET',
        timeout: timeout,
        headers: {
          'User-Agent': 'ZimaOS-Client/1.0',
        },
      };

      const req = http.request(options, (res) => {
        let data = '';
        const serverHeader = res.headers['server'] as string | undefined;

        // Collect response data
        res.on('data', (chunk) => {
          data += chunk.toString();
          // Limit data collection to 10KB to prevent memory issues
          if (data.length > 10240) {
            req.destroy();
          }
        });

        res.on('end', () => {
          // Check if this looks like a ZimaOS response
          const isValid = this.validateZimaOSResponse(res.statusCode || 0, data, serverHeader);
          resolve({ isValid, server: serverHeader });
        });
      });

      req.on('error', () => {
        resolve({ isValid: false });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ isValid: false });
      });

      req.end();
    });
  }

  /**
   * Validate if a response looks like it's from ZimaOS
   */
  private validateZimaOSResponse(statusCode: number, body: string, serverHeader?: string): boolean {
    // Reject obvious non-ZimaOS responses
    if (statusCode === 404 || statusCode === 502 || statusCode === 503) {
      return false;
    }

    // Check for ZimaOS-specific server headers
    if (serverHeader) {
      const serverLower = serverHeader.toLowerCase();

      // Caddy is the default web server for ZimaOS!
      if (serverLower.includes('caddy')) {
        return true;
      }

      // ZimaOS might also use these servers
      if (serverLower.includes('casaos') || serverLower.includes('zimaos')) {
        return true;
      }

      // Reject known non-ZimaOS servers
      if (serverLower.includes('unifi') || serverLower.includes('ubiquiti')) {
        return false;
      }
    }

    // Try to parse as JSON
    try {
      const json = JSON.parse(body);

      // ZimaOS APIs typically return objects with specific structure
      if (typeof json === 'object' && json !== null) {
        const hasDataField = 'data' in json;
        const hasSuccessField = 'success' in json;
        const hasMessageField = 'message' in json;

        // Check for ZimaOS-specific authentication responses
        if (hasMessageField && typeof json.message === 'string') {
          const messageLower = json.message.toLowerCase();
          // ZimaOS returns these specific auth errors
          if (messageLower.includes('jwt') ||
              (messageLower.includes('unauthorized') && statusCode === 401)) {
            return true;
          }
        }

        // ZimaOS typically has at least data or success field
        if (hasDataField || (hasSuccessField && typeof json.success === 'number')) {
          return true;
        }

        // Check if response contains ZimaOS-specific keywords
        const bodyLower = body.toLowerCase();
        if (bodyLower.includes('casaos') ||
            bodyLower.includes('zimaos') ||
            (bodyLower.includes('compose') && bodyLower.includes('store_info'))) {
          return true;
        }
      }
    } catch (e) {
      // Not JSON - likely not ZimaOS API
      return false;
    }

    return false;
  }
}
