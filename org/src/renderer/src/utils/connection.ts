import type { DriveInfo as DeviceInfo } from '@icewhale/icewhale-drive-openapi'
import type { User } from '@icewhale/zimaos-userservice-openapi/dist/v1'
import { useI18n } from 'vue-i18n'

const ipcRenderer = window.electron.ipcRenderer

export class Connection {
  // Device related methods
  public static async discover(): Promise<void> {
    return await ipcRenderer.invoke('device:discover')
  }

  public static async getDeviceByNetworkId(networkId: string): Promise<ZtNetworkDeviceInfo> {
    return await ipcRenderer.invoke('device:getByNetworkId', networkId)
  }

  public static async getDeviceByIP(ip: string): Promise<DeviceInfo> {
    return await ipcRenderer.invoke('device:getByIP', ip)
  }

  // Connection state getters
  public static async hasDevice(): Promise<boolean> {
    return await ipcRenderer.invoke('connection:hasDevice')
  }

  public static async getDevice(): Promise<DeviceInfo | undefined> {
    return await ipcRenderer.invoke('connection:getDevice')
  }

  public static async isInitialized(): Promise<boolean> {
    return await ipcRenderer.invoke('connection:isInitialized')
  }

  public static async hasZtNetwork(): Promise<boolean> {
    return await ipcRenderer.invoke('connection:hasZtNetwork')
  }

  public static async getZtNetwork(): Promise<ConnectionZtNetwork | undefined> {
    return await ipcRenderer.invoke('connection:getZtNetwork')
  }

  public static async isAuthorized(): Promise<boolean> {
    return await ipcRenderer.invoke('connection:isAuthorized')
  }

  public static async getAuthentication(): Promise<ConnectionAuthentication | undefined> {
    return await ipcRenderer.invoke('connection:getAuthentication')
  }

  public static async getAvailableConnectionPaths(): Promise<ConnectionPath[]> {
    return await ipcRenderer.invoke('connection:getAvailableConnectionPaths')
  }

  public static async getCurrentConnectionPath(): Promise<ConnectionPath | undefined> {
    return await ipcRenderer.invoke('connection:getCurrentConnectionPath')
  }

  public static async getUser(): Promise<User> {
    return await ipcRenderer.invoke('connection:getUser')
  }

  public static async getUserCustom(): Promise<any> {
    return await ipcRenderer.invoke('connection:getUserCustom')
  }

  // Connection state setters
  public static async setDevice(device?: DeviceInfo): Promise<void> {
    return await ipcRenderer.invoke('connection:device', device)
  }

  public static async setZtNetwork(ztNetwork?: ConnectionZtNetwork): Promise<void> {
    return await ipcRenderer.invoke('connection:ztNetwork', ztNetwork)
  }

  // Connection methods
  public static async login(username: string, password: string): Promise<ConnectionAuthentication> {
    return await ipcRenderer.invoke('connection:login', username, password)
  }

  public static async logout(): Promise<void> {
    return await ipcRenderer.invoke('connection:logout')
  }

  // Helpers
  public static waitForDeviceConnectionPathReady(options: {
    timeout?: number
    interval?: number
    onReady: (path: ConnectionPath) => void
    onFailed: (err: Error) => void
  }) {
    const timeout = options.timeout || 30 * 1000
    const interval = options.interval || 1000
    const startTime = Date.now()

    function check() {
      if (Date.now() - startTime > timeout) {
        options.onFailed(new Error('Timeout waiting for device connection path ready'))
      }
      Connection.getCurrentConnectionPath()
        .then((path) => {
          if (path) {
            options.onReady(path)
          }
          else {
            setTimeout(check, interval)
          }
        })
        .catch((err) => {
          options.onFailed(err)
        })
    }

    check()
  }

  // UI related methods
  public static IconClass(method?: ConnectionMethod): string {
    switch (method) {
      case 'wifi':
        return 'i-ant-design:wifi-outlined'
      case 'ethernet':
        return 'i-ant-design:swap-outlined'
      case 'thunderbolt':
        return 'i-ant-design:thunderbolt-filled'
      case 'remote':
        return 'i-ant-design:global-outlined'
      default:
        return ''
    }
  }

  public static MethodName(method?: ConnectionMethod): string {
    const { t } = useI18n()
    switch (method) {
      case 'wifi':
        return t('wifi')
      case 'ethernet':
        return t('ethernet')
      case 'thunderbolt':
        return t('thunderbolt')
      case 'remote':
        return t('remote')
      default:
        return ''
    }
  }
}
