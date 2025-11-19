import { create } from 'zustand';
import { ZimaDevice, ConnectionStatus, SMBShare } from '@shared/types';

interface AppState {
  // Connection
  connectionStatus: ConnectionStatus;
  setConnectionStatus: (status: ConnectionStatus) => void;

  // Devices
  devices: ZimaDevice[];
  setDevices: (devices: ZimaDevice[]) => void;
  selectedDevice: ZimaDevice | null;
  setSelectedDevice: (device: ZimaDevice | null) => void;

  // Shares
  pinnedShares: SMBShare[];
  setPinnedShares: (shares: SMBShare[]) => void;

  // Session credentials for SMB access
  sessionCredentials: { username: string; password: string } | null;
  setSessionCredentials: (credentials: { username: string; password: string } | null) => void;

  // UI State
  scanning: boolean;
  setScanning: (scanning: boolean) => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  error: string | null;
  setError: (error: string | null) => void;

  // Current view
  currentView: 'connect' | 'devices' | 'apps' | 'backup';
  setCurrentView: (view: 'connect' | 'devices' | 'apps' | 'backup') => void;
}

export const useAppStore = create<AppState>((set) => ({
  // Connection
  connectionStatus: {
    connected: false,
    zerotierConnected: false,
  },
  setConnectionStatus: (status) => set({ connectionStatus: status }),

  // Devices
  devices: [],
  setDevices: (devices) => set({ devices }),
  selectedDevice: null,
  setSelectedDevice: (device) => set({ selectedDevice: device }),

  // Shares
  pinnedShares: [],
  setPinnedShares: (shares) => set({ pinnedShares: shares }),

  // Session credentials
  sessionCredentials: null,
  setSessionCredentials: (credentials) => set({ sessionCredentials: credentials }),

  // UI State
  scanning: false,
  setScanning: (scanning) => set({ scanning }),
  loading: false,
  setLoading: (loading) => set({ loading }),
  error: null,
  setError: (error) => set({ error }),

  // Current view
  currentView: 'connect',
  setCurrentView: (view) => set({ currentView: view }),
}));
