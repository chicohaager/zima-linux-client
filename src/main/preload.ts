import { contextBridge, ipcRenderer } from 'electron';
import { ZimaDevice, SMBShare, ZeroTierNetwork, RecentConnection, BackupJob, ShareSpace, BackupProgress, ZeroTierDiagnostics } from '@shared/types';

// Expose protected methods to renderer process
contextBridge.exposeInMainWorld('electron', {
  // ZeroTier
  zerotier: {
    start: () => ipcRenderer.invoke('zerotier:start'),
    stop: () => ipcRenderer.invoke('zerotier:stop'),
    join: (networkId: string): Promise<{ success: boolean; data?: { gatewayIP: string | null }; error?: string }> =>
      ipcRenderer.invoke('zerotier:join', networkId),
    leave: (networkId: string) => ipcRenderer.invoke('zerotier:leave', networkId),
    listNetworks: () => ipcRenderer.invoke('zerotier:listNetworks'),
    getStatus: () => ipcRenderer.invoke('zerotier:getStatus'),
    diagnostics: (): Promise<{ success: boolean; data?: ZeroTierDiagnostics; error?: string }> =>
      ipcRenderer.invoke('zerotier:diagnostics'),
  },

  // Device discovery
  device: {
    scan: (): Promise<{ success: boolean; data?: ZimaDevice[]; error?: string }> =>
      ipcRenderer.invoke('device:scan'),
    scanSubnet: (subnet: string): Promise<{ success: boolean; data?: ZimaDevice[]; error?: string }> =>
      ipcRenderer.invoke('device:scanSubnet', subnet),
    discoverSMB: (subnet: string, credentials?: { username: string; password: string }): Promise<{ success: boolean; data?: ZimaDevice[]; error?: string }> =>
      ipcRenderer.invoke('device:discoverSMB', subnet, credentials),
    connect: (deviceId: string, networkId?: string) =>
      ipcRenderer.invoke('device:connect', deviceId, networkId),
    disconnect: () => ipcRenderer.invoke('device:disconnect'),
  },

  // SMB
  smb: {
    discoverShares: (host: string): Promise<{ success: boolean; data?: SMBShare[]; error?: string }> =>
      ipcRenderer.invoke('smb:discoverShares', host),
    pinShare: (share: SMBShare, credentials?: { username: string; password: string }) =>
      ipcRenderer.invoke('smb:pinShare', share, credentials),
    unpinShare: (shareUrl: string) => ipcRenderer.invoke('smb:unpinShare', shareUrl),
    listPinned: () => ipcRenderer.invoke('smb:listPinned'),
    getSpace: (share: SMBShare, credentials?: { username: string; password: string }): Promise<{ success: boolean; data?: ShareSpace; error?: string }> =>
      ipcRenderer.invoke('smb:getSpace', share, credentials),
  },

  // Apps
  app: {
    list: (deviceIp: string) => ipcRenderer.invoke('app:list', deviceIp),
    open: (appUrl: string, authToken?: string) => ipcRenderer.invoke('app:open', appUrl, authToken),
  },

  // Recent connections
  connection: {
    getRecent: (): Promise<{ success: boolean; data?: RecentConnection[]; error?: string }> =>
      ipcRenderer.invoke('connection:getRecent'),
    saveRecent: (connection: { networkId: string; name?: string; gatewayIP?: string }) =>
      ipcRenderer.invoke('connection:saveRecent', connection),
    removeRecent: (networkId: string) =>
      ipcRenderer.invoke('connection:removeRecent', networkId),
    clearRecent: () =>
      ipcRenderer.invoke('connection:clearRecent'),
  },

  // Backup
  backup: {
    selectFolder: (): Promise<{ success: boolean; data?: string | null; error?: string }> =>
      ipcRenderer.invoke('backup:selectFolder'),
    createJob: (job: Omit<BackupJob, 'id'>): Promise<{ success: boolean; data?: BackupJob; error?: string }> =>
      ipcRenderer.invoke('backup:createJob', job),
    listJobs: (): Promise<{ success: boolean; data?: BackupJob[]; error?: string }> =>
      ipcRenderer.invoke('backup:listJobs'),
    deleteJob: (jobId: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('backup:deleteJob', jobId),
    updateJob: (jobId: string, updates: Partial<Omit<BackupJob, 'id'>>): Promise<{ success: boolean; data?: BackupJob; error?: string }> =>
      ipcRenderer.invoke('backup:updateJob', jobId, updates),
    runJob: (jobId: string, credentials?: { username: string; password: string }): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('backup:runJob', jobId, credentials),
    stopJob: (jobId: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('backup:stopJob', jobId),
    onProgress: (callback: (progress: BackupProgress) => void) => {
      const listener = (_event: any, progress: BackupProgress) => callback(progress);
      ipcRenderer.on('backup:progress', listener);
      return () => ipcRenderer.removeListener('backup:progress', listener);
    },
  },

  // Update
  update: {
    check: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('update:check'),
    download: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('update:download'),
    install: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('update:install'),
    getVersion: (): Promise<{ success: boolean; data?: string; error?: string }> =>
      ipcRenderer.invoke('update:getVersion'),
    onUpdateAvailable: (callback: (info: any) => void) => {
      const listener = (_event: any, info: any) => callback(info);
      ipcRenderer.on('update-available', listener);
      return () => ipcRenderer.removeListener('update-available', listener);
    },
    onUpdateNotAvailable: (callback: (info: any) => void) => {
      const listener = (_event: any, info: any) => callback(info);
      ipcRenderer.on('update-not-available', listener);
      return () => ipcRenderer.removeListener('update-not-available', listener);
    },
    onDownloadProgress: (callback: (progress: any) => void) => {
      const listener = (_event: any, progress: any) => callback(progress);
      ipcRenderer.on('update-download-progress', listener);
      return () => ipcRenderer.removeListener('update-download-progress', listener);
    },
    onUpdateDownloaded: (callback: (info: any) => void) => {
      const listener = (_event: any, info: any) => callback(info);
      ipcRenderer.on('update-downloaded', listener);
      return () => ipcRenderer.removeListener('update-downloaded', listener);
    },
    onUpdateError: (callback: (error: string) => void) => {
      const listener = (_event: any, error: string) => callback(error);
      ipcRenderer.on('update-error', listener);
      return () => ipcRenderer.removeListener('update-error', listener);
    },
  },

  // Shell
  openExternal: (url: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('shell:openExternal', url),
});

// Type definitions for window.electron
declare global {
  interface Window {
    electron: {
      zerotier: {
        start: () => Promise<{ success: boolean; error?: string }>;
        stop: () => Promise<{ success: boolean; error?: string }>;
        join: (networkId: string) => Promise<{ success: boolean; data?: { gatewayIP: string | null }; error?: string }>;
        leave: (networkId: string) => Promise<{ success: boolean; error?: string }>;
        listNetworks: () => Promise<{ success: boolean; data?: ZeroTierNetwork[]; error?: string }>;
        getStatus: () => Promise<{ success: boolean; data?: any; error?: string }>;
        diagnostics: () => Promise<{ success: boolean; data?: ZeroTierDiagnostics; error?: string }>;
      };
      device: {
        scan: () => Promise<{ success: boolean; data?: ZimaDevice[]; error?: string }>;
        scanSubnet: (subnet: string) => Promise<{ success: boolean; data?: ZimaDevice[]; error?: string }>;
        discoverSMB: (subnet: string, credentials?: { username: string; password: string }) => Promise<{ success: boolean; data?: ZimaDevice[]; error?: string }>;
        connect: (deviceId: string, networkId?: string) => Promise<{ success: boolean; error?: string }>;
        disconnect: () => Promise<{ success: boolean; error?: string }>;
      };
      smb: {
        discoverShares: (host: string) => Promise<{ success: boolean; data?: SMBShare[]; error?: string }>;
        pinShare: (share: SMBShare, credentials?: { username: string; password: string }) => Promise<{ success: boolean; error?: string }>;
        unpinShare: (shareUrl: string) => Promise<{ success: boolean; error?: string }>;
        listPinned: () => Promise<{ success: boolean; data?: string[]; error?: string }>;
        getSpace: (share: SMBShare, credentials?: { username: string; password: string }) => Promise<{ success: boolean; data?: ShareSpace; error?: string }>;
      };
      app: {
        list: (deviceIp: string) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        open: (appUrl: string, authToken?: string) => Promise<{ success: boolean; error?: string }>;
      };
      connection: {
        getRecent: () => Promise<{ success: boolean; data?: RecentConnection[]; error?: string }>;
        saveRecent: (connection: { networkId: string; name?: string; gatewayIP?: string }) => Promise<{ success: boolean; error?: string }>;
        removeRecent: (networkId: string) => Promise<{ success: boolean; error?: string }>;
        clearRecent: () => Promise<{ success: boolean; error?: string }>;
      };
      backup: {
        selectFolder: () => Promise<{ success: boolean; data?: string | null; error?: string }>;
        createJob: (job: Omit<BackupJob, 'id'>) => Promise<{ success: boolean; data?: BackupJob; error?: string }>;
        listJobs: () => Promise<{ success: boolean; data?: BackupJob[]; error?: string }>;
        deleteJob: (jobId: string) => Promise<{ success: boolean; error?: string }>;
        updateJob: (jobId: string, updates: Partial<Omit<BackupJob, 'id'>>) => Promise<{ success: boolean; data?: BackupJob; error?: string }>;
        runJob: (jobId: string, credentials?: { username: string; password: string }) => Promise<{ success: boolean; error?: string }>;
        stopJob: (jobId: string) => Promise<{ success: boolean; error?: string }>;
        onProgress: (callback: (progress: BackupProgress) => void) => () => void;
      };
      update: {
        check: () => Promise<{ success: boolean; error?: string }>;
        download: () => Promise<{ success: boolean; error?: string }>;
        install: () => Promise<{ success: boolean; error?: string }>;
        getVersion: () => Promise<{ success: boolean; data?: string; error?: string }>;
        onUpdateAvailable: (callback: (info: any) => void) => () => void;
        onUpdateNotAvailable: (callback: (info: any) => void) => () => void;
        onDownloadProgress: (callback: (progress: any) => void) => () => void;
        onUpdateDownloaded: (callback: (info: any) => void) => () => void;
        onUpdateError: (callback: (error: string) => void) => () => void;
      };
      openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;
    };
  }
}
