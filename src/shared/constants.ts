// ZeroTier Constants
export const ZEROTIER_NETWORK_ID = process.env.ZEROTIER_NETWORK_ID || '';
export const ZEROTIER_API_PORT = 9993;

// SMB Constants
export const SMB_PORT = 445;
export const SMB_DISCOVERY_TIMEOUT = 5000;

// Network Discovery
export const DEVICE_SCAN_TIMEOUT = 10000;
export const MDNS_SERVICE_TYPE = '_zima._tcp.local';

// UI Constants
export const APP_NAME = 'ZimaOS Client';
export const APP_VERSION = '1.0.0';

// File Paths
export const GTK_BOOKMARKS_PATH = '.config/gtk-3.0/bookmarks';
export const KDE_PLACES_PATH = '.local/share/user-places.xbel';

// Default Settings
export const DEFAULT_SETTINGS: import('./types').AppSettings = {
  autoStart: false,
  autoConnect: false,
  theme: 'system',
};
