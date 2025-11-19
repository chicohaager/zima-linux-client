import process from 'node:process'
import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge } from 'electron'

// Custom APIs for renderer
const api = {
  // ZeroTier API
  zerotier: {
    // Status
    installed: () => electronAPI.ipcRenderer.invoke('zts:installed'),
    running: () => electronAPI.ipcRenderer.invoke('zts:running'),
    authtoken: () => electronAPI.ipcRenderer.invoke('zts:authtoken'),
    monitoring: () => electronAPI.ipcRenderer.invoke('zts:monitoring'),

    // Actions
    checkInstallation: () => electronAPI.ipcRenderer.invoke('zts:checkInstallation'),
    checkRunning: () => electronAPI.ipcRenderer.invoke('zts:checkRunning'),
    getAuthToken: () => electronAPI.ipcRenderer.invoke('zts:getAuthToken'),
    checkCapabilities: () => electronAPI.ipcRenderer.invoke('zts:checkCapabilities'),
    getSetcapCommand: () => electronAPI.ipcRenderer.invoke('zts:getSetcapCommand'),

    // Sudo actions
    initAuthToken: () => electronAPI.ipcRenderer.invoke('zts:initAuthToken'),
    install: () => electronAPI.ipcRenderer.invoke('zts:install'),
    uninstall: () => electronAPI.ipcRenderer.invoke('zts:uninstall'),
    start: () => electronAPI.ipcRenderer.invoke('zts:start'),
    stop: () => electronAPI.ipcRenderer.invoke('zts:stop'),

    // Monitoring
    startMonitor: () => electronAPI.ipcRenderer.invoke('zts:startMonitor'),
    stopMonitor: () => electronAPI.ipcRenderer.invoke('zts:stopMonitor'),
  },
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('ipcRenderer', electronAPI.ipcRenderer)
    contextBridge.exposeInMainWorld('platform', process.platform)
    contextBridge.exposeInMainWorld('api', api)
  }
  catch (error) {
    console.error(error)
  }
}
else {
  // @ts-expect-error (define in dts)
  window.electron = electronAPI
  // @ts-expect-error (define in dts)
  window.ipcRenderer = electronAPI.ipcRenderer
  // @ts-expect-error (define in dts)
  window.platform = process.platform
  // @ts-expect-error (define in dts)
  window.api = api
}
