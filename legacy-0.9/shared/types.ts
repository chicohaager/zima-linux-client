// ZeroTier Types
export interface ZeroTierNetwork {
  id: string;
  name: string;
  status: 'OK' | 'REQUESTING_CONFIGURATION' | 'ACCESS_DENIED' | 'NOT_FOUND';
  type: string;
  mac: string;
  bridge: boolean;
  allowManaged: boolean;
  allowGlobal: boolean;
  allowDefault: boolean;
  allowDNS: boolean;
  portDeviceName: string;
  assignedAddresses: string[];
  routes: Route[];
}

export interface Route {
  target: string;
  via: string | null;
  flags: number;
  metric: number;
}

// SMB Types
export interface SMBShare {
  host: string;
  name: string;
  displayName: string;
  type: 'disk' | 'printer' | 'device' | 'ipc';
  comment?: string;
  pinned?: boolean;
}

// Device Discovery Types
export interface ZimaDevice {
  id: string;
  name: string;
  ipAddress: string;
  zerotierAddress?: string;
  online: boolean;
  type: 'local' | 'remote';
  shares?: SMBShare[];
  authToken?: string; // ZimaOS API auth token
}

// App Types
export interface ZimaApp {
  id: string;
  name: string;
  icon: string;
  url: string;
  description?: string;
  installed: boolean;
}

// Connection Types
export interface ConnectionStatus {
  connected: boolean;
  device?: ZimaDevice;
  zerotierConnected: boolean;
  networkId?: string;
}

export interface RecentConnection {
  networkId: string;
  timestamp: number;
  name?: string;
  gatewayIP?: string;
}

// IPC Channel Types
export type IPCChannels =
  | 'zerotier:start'
  | 'zerotier:stop'
  | 'zerotier:join'
  | 'zerotier:leave'
  | 'zerotier:listNetworks'
  | 'zerotier:getStatus'
  | 'device:scan'
  | 'device:scanSubnet'
  | 'device:discoverSMB'
  | 'device:connect'
  | 'device:disconnect'
  | 'smb:discoverShares'
  | 'smb:pinShare'
  | 'smb:unpinShare'
  | 'smb:listPinned'
  | 'smb:getSpace'
  | 'app:list'
  | 'app:open'
  | 'connection:getRecent'
  | 'connection:saveRecent'
  | 'connection:removeRecent'
  | 'connection:clearRecent'
  | 'backup:selectFolder'
  | 'backup:createJob'
  | 'backup:listJobs'
  | 'backup:deleteJob'
  | 'backup:runJob'
  | 'backup:stopJob'
  | 'backup:getProgress';

// Settings Types
export interface AppSettings {
  autoStart: boolean;
  autoConnect: boolean;
  lastDeviceId?: string;
  zerotierNetworkId?: string;
  theme: 'light' | 'dark' | 'system';
}

// Backup Types
export interface BackupJob {
  id: string;
  name: string;
  sourcePath: string; // Local folder to backup
  targetShare: SMBShare; // ZimaOS share
  targetPath: string; // Path on the share (e.g., /media/ZimaOS-HD/Backup)
  enabled: boolean;
  credentials?: { username: string; password: string }; // SMB credentials for mounting
  schedule?: BackupSchedule;
  lastRun?: number;
  lastStatus?: 'success' | 'failed' | 'running';
  lastError?: string;
  stats?: BackupStats;
}

export interface BackupSchedule {
  frequency: 'manual' | 'daily' | 'weekly' | 'monthly';
  time?: string; // HH:MM format
  dayOfWeek?: number; // 0-6 for weekly
  dayOfMonth?: number; // 1-31 for monthly
}

export interface BackupStats {
  filesTransferred: number;
  bytesTransferred: number;
  duration: number; // seconds
  timestamp: number;
}

export interface BackupProgress {
  jobId: string;
  status: 'running' | 'completed' | 'failed';
  progress: number; // 0-100
  currentFile?: string;
  filesTransferred: number;
  bytesTransferred: number;
  speed?: number; // bytes per second
  elapsedTime?: number; // seconds
  estimatedTimeRemaining?: number; // seconds
  error?: string;
}

export interface ShareSpace {
  total: number; // bytes
  used: number; // bytes
  available: number; // bytes
}

// ZeroTier Diagnostics Types
export type StatusLevel = 'ok' | 'warn' | 'error';

export interface CheckResult {
  id: string;
  label: string;
  status: StatusLevel;
  message: string;
  details?: string;
}

export interface ZeroTierDiagnostics {
  timestamp: string;
  checks: CheckResult[];
}
