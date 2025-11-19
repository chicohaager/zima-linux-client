import type { ElectronAPI, NodeProcess } from '@electron-toolkit/preload'

interface ZeroTierAPI {
  // Status
  installed: () => Promise<string | false>
  running: () => Promise<boolean>
  authtoken: () => Promise<string | null>
  monitoring: () => Promise<boolean>

  // Actions
  checkInstallation: () => Promise<string | false>
  checkRunning: () => Promise<boolean>
  getAuthToken: () => Promise<string | null>
  checkCapabilities: () => Promise<boolean>
  getSetcapCommand: () => Promise<string>

  // Sudo actions
  initAuthToken: () => Promise<string>
  install: () => Promise<void>
  uninstall: () => Promise<void>
  start: () => Promise<void>
  stop: () => Promise<void>

  // Monitoring
  startMonitor: () => Promise<void>
  stopMonitor: () => Promise<void>
}

interface API {
  zerotier: ZeroTierAPI
}

declare global {
  interface Window {
    electron: ElectronAPI
    ipcRenderer: ElectronAPI['ipcRenderer']
    platform: NodeProcess['platform']
    api: API
  }
}
