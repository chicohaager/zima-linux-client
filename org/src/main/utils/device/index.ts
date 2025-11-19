import type { DriveInfo as DeviceInfo } from '@icewhale/icewhale-drive-openapi'
import { ipcMain } from 'electron'
import { ConnectionManager } from './connection'
import { getDeviceByIP } from './ipGet'
import { discoverDevices } from './udpDiscover'
import { getDeviceByZeroTierNetworkId } from './ztGet'

export function deviceIpcHandlers() {
  // Device IPC handlers
  ipcMain.handle('device:discover', discoverDevices)
  ipcMain.handle('device:getByNetworkId', (_event, networkId: string) => getDeviceByZeroTierNetworkId(networkId))
  ipcMain.handle('device:getByIP', (_event, ip: string) => getDeviceByIP(ip))

  // Connection IPC handlers
  // getters
  ipcMain.handle('connection:hasDevice', (_event) => {
    return ConnectionManager.getInstance().device !== undefined
  })
  ipcMain.handle('connection:getDevice', (_event) => {
    return ConnectionManager.getInstance().device
  })
  ipcMain.handle('connection:isInitialized', (_event) => {
    return ConnectionManager.getInstance().initialized
  })
  ipcMain.handle('connection:hasZtNetwork', (_event) => {
    return ConnectionManager.getInstance().ztNetwork !== undefined
  })
  ipcMain.handle('connection:getZtNetwork', (_event) => {
    return ConnectionManager.getInstance().ztNetwork
  })
  ipcMain.handle('connection:isAuthorized', (_event) => {
    return ConnectionManager.getInstance().authentication !== undefined
  })
  ipcMain.handle('connection:getAuthentication', (_event) => {
    return ConnectionManager.getInstance().authentication
  })
  ipcMain.handle('connection:getAvailableConnectionPaths', (_event) => {
    return ConnectionManager.getInstance().availableConnectionPaths
  })
  ipcMain.handle('connection:getCurrentConnectionPath', (_event) => {
    return ConnectionManager.getInstance().currentConnectionPath
  })
  ipcMain.handle('connection:getUser', (_event) => {
    return ConnectionManager.getInstance().user
  })
  ipcMain.handle('connection:getUserCustom', (_event) => {
    return ConnectionManager.getInstance().userCustom
  })
  // setters
  ipcMain.handle('connection:device', (_event, device?: DeviceInfo) => {
    ConnectionManager.getInstance().device = device
  })
  ipcMain.handle('connection:ztNetwork', (_event, ztNetwork?: ConnectionZtNetwork) => {
    ConnectionManager.getInstance().ztNetwork = ztNetwork
  })
  // methods
  ipcMain.handle('connection:login', (_event, username: string, password: string) => {
    return ConnectionManager.getInstance().login(username, password)
  })
  ipcMain.handle('connection:logout', (_event) => {
    ConnectionManager.getInstance().logout()
  })
}

export * from './connection'
export * from './ifaces'
export * from './ipGet'
export * from './udpDiscover'
export * from './ztGet'
