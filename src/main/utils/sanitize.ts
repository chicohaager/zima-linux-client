/**
 * Utility functions for sanitizing user input to prevent command injection
 */

/**
 * Validates and sanitizes an IP address
 * @param ip - The IP address to validate
 * @returns The validated IP address
 * @throws Error if the IP address is invalid
 */
export function sanitizeIPAddress(ip: string): string {
  // IPv4 regex pattern
  const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = ip.match(ipv4Pattern);

  if (!match) {
    throw new Error('Invalid IP address format');
  }

  // Validate each octet is between 0-255
  for (let i = 1; i <= 4; i++) {
    const octet = parseInt(match[i], 10);
    if (octet < 0 || octet > 255) {
      throw new Error('Invalid IP address: octet out of range');
    }
  }

  return ip;
}

/**
 * Sanitizes a hostname to prevent command injection
 * @param hostname - The hostname to sanitize
 * @returns The sanitized hostname
 * @throws Error if the hostname is invalid
 */
export function sanitizeHostname(hostname: string): string {
  // Hostname can contain alphanumeric, dots, and hyphens
  const hostnamePattern = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

  if (!hostnamePattern.test(hostname)) {
    throw new Error('Invalid hostname format');
  }

  return hostname;
}

/**
 * Sanitizes an SMB share name to prevent command injection
 * @param shareName - The share name to sanitize
 * @returns The sanitized share name
 * @throws Error if the share name is invalid
 */
export function sanitizeSMBShareName(shareName: string): string {
  // Share names should only contain alphanumeric, underscores, hyphens, and spaces
  // No shell metacharacters allowed
  const sharePattern = /^[a-zA-Z0-9_\- ]+$/;

  if (!sharePattern.test(shareName)) {
    throw new Error('Invalid SMB share name: contains invalid characters');
  }

  // Additional check: no leading/trailing spaces
  if (shareName !== shareName.trim()) {
    throw new Error('Invalid SMB share name: leading/trailing spaces');
  }

  return shareName;
}

/**
 * Sanitizes a filesystem path to prevent command injection
 * @param filePath - The path to sanitize
 * @returns The sanitized path
 * @throws Error if the path is invalid
 */
export function sanitizePath(filePath: string): string {
  // Paths should not contain shell metacharacters
  const dangerousChars = /[;&|`$(){}[\]<>!*?'"\\]/;

  if (dangerousChars.test(filePath)) {
    throw new Error('Invalid path: contains dangerous characters');
  }

  return filePath;
}

/**
 * Sanitizes a network ID (ZeroTier network ID is 16 hex characters)
 * @param networkId - The network ID to sanitize
 * @returns The sanitized network ID
 * @throws Error if the network ID is invalid
 */
export function sanitizeNetworkId(networkId: string): string {
  const networkIdPattern = /^[a-fA-F0-9]{16}$/;

  if (!networkIdPattern.test(networkId)) {
    throw new Error('Invalid network ID format');
  }

  return networkId;
}

/**
 * Escapes a string for safe use in shell commands
 * This is a last resort - prefer validation over escaping
 * @param str - The string to escape
 * @returns The escaped string
 */
export function escapeShellArg(str: string): string {
  // Wrap in single quotes and escape any existing single quotes
  return "'" + str.replace(/'/g, "'\\''") + "'";
}
