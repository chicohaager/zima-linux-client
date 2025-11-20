/**
 * API utilities for secure HTTP/HTTPS handling
 */

/**
 * Determine if an IP address is from a ZeroTier network (remote)
 * ZeroTier typically uses specific private IP ranges
 */
function isZeroTierIP(ip: string): boolean {
  return (
    ip.startsWith('10.147.') ||
    ip.startsWith('172.21.') ||
    ip.startsWith('172.22.') ||
    ip.startsWith('172.23.') ||
    ip.startsWith('172.24.') ||
    ip.startsWith('172.25.')
  );
}

/**
 * Determine if an IP is a local network address
 */
function isLocalIP(ip: string): boolean {
  return (
    ip.startsWith('192.168.') ||
    ip.startsWith('10.0.') ||
    ip.startsWith('172.16.') ||
    ip.startsWith('127.') ||
    ip === 'localhost'
  );
}

/**
 * Build API URL with automatic HTTPS enforcement for remote connections
 *
 * @param ip - Device IP address
 * @param path - API path (e.g., '/v1/users/login')
 * @param forceHTTP - Force HTTP even for remote (for local development)
 * @returns Full API URL
 *
 * @example
 * buildAPIUrl('192.168.1.100', '/api/status')  // → http://192.168.1.100/api/status
 * buildAPIUrl('172.23.45.67', '/api/status')   // → https://172.23.45.67/api/status
 */
export function buildAPIUrl(ip: string, path: string, forceHTTP?: boolean): string {
  // For remote ZeroTier connections, use HTTPS for security
  const useHTTPS = !forceHTTP && isZeroTierIP(ip) && !isLocalIP(ip);
  const protocol = useHTTPS ? 'https' : 'http';

  // Ensure path starts with /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  return `${protocol}://${ip}${normalizedPath}`;
}

/**
 * Fetch wrapper with automatic HTTPS enforcement for remote connections
 *
 * @param ip - Device IP address
 * @param path - API path
 * @param options - Fetch options
 * @returns Fetch response
 *
 * @example
 * const response = await secureFetch('172.23.45.67', '/v1/users/login', {
 *   method: 'POST',
 *   body: JSON.stringify({ username, password })
 * });
 */
export async function secureFetch(
  ip: string,
  path: string,
  options?: RequestInit
): Promise<Response> {
  const url = buildAPIUrl(ip, path);

  console.log(`[API] ${options?.method || 'GET'} ${url}`);

  // For HTTPS, disable certificate validation in development
  // (ZimaOS devices often use self-signed certificates)
  const fetchOptions: RequestInit = {
    ...options,
    // Note: In Electron, you may need to handle certificate validation
    // via app.on('certificate-error') in main process
  };

  return fetch(url, fetchOptions);
}

/**
 * Check if device should use HTTPS
 */
export function shouldUseHTTPS(ip: string): boolean {
  return isZeroTierIP(ip) && !isLocalIP(ip);
}
