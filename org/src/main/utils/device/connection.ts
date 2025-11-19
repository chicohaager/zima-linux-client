import type { DriveInfo as DeviceInfo } from '@icewhale/icewhale-drive-openapi'
import type { User } from '@icewhale/zimaos-userservice-openapi/dist/v1'
import http from 'node:http'
import https from 'node:https'
import { Config } from '@main/config'
import { $t } from '@main/i18n'
import { ZimaTray } from '@main/tray'
import { PeerDropWindow, zimaBackupWindow } from '@main/windows'
import { showNotification } from '@utils/notification'
import { clearIntervalTask, setIntervalTask } from '@utils/timers'
import { getZtNetworkLocalIPv4, ZeroTier } from '@utils/zerotier'
import { ZimaOSAPI } from '@utils/zimaos-api'
import log from 'electron-log'
import { isEqual } from 'lodash-es'
import { ZimaBackup } from '../zima-backup'
import { getConnectedNetworkInterfaces } from './ifaces'
import { getDeviceByIP } from './ipGet'

// Constants
const CONNECTION_MONITOR_INTERVAL = 10 * 1000 // 10 seconds

const TOKEN_REFRESH_THRESHOLD = 5 * 60 * 1000 // 5 minutes
const AUTH_MONITOR_INTERVAL = 1 * 60 * 1000 // 1 minutes

const ZTNETWORK_MONITOR_INTERVAL = 30 * 1000 // 30 seconds

const USER_INFOS_MONITOR_INTERVAL = 5 * 1000 // 5 seconds
export interface ConnectionZtNetwork {
  networkId: string
  remote_ipv4: string
}

export class ConnectionManager {
  // Static instance
  private static instance: ConnectionManager
  public static httpAgent: http.Agent = new http.Agent()
  public static httpsAgent: https.Agent = new https.Agent()

  // Connection
  private _device?: DeviceInfo
  private _ztNetwork?: ConnectionZtNetwork
  private _authentication?: ConnectionAuthentication
  private _lastConnectionPath?: ConnectionPath
  private _availableConnectionPaths: ConnectionPath[] = []
  private _currentConnectionPath?: ConnectionPath

  // Connection User
  private _user?: User
  private _userCustom: UserCustom = {}

  // Connection Monitoring
  private connectionMonitorTimer?: NodeJS.Timeout
  private connectionMonitorChecking: boolean = false
  private connectionMonitorInterval: number = CONNECTION_MONITOR_INTERVAL

  // Auth Monitoring
  private isRefreshingToken: boolean = false
  private authMonitorTimer?: NodeJS.Timeout
  private authMonitorChecking: boolean = false
  private authMonitorInterval: number = AUTH_MONITOR_INTERVAL

  // ZtNetwork Monitoring
  private ztNetworkMonitorTimer?: NodeJS.Timeout
  private ztNetworkMonitorChecking: boolean = false
  private ztNetworkMonitorInterval: number = ZTNETWORK_MONITOR_INTERVAL

  // User Infos Monitoring
  private userInfosMonitorTimer?: NodeJS.Timeout
  private userInfosMonitorChecking: boolean = false
  private userInfosMonitorInterval: number = USER_INFOS_MONITOR_INTERVAL

  // State
  get authorized(): boolean {
    return this.authentication !== undefined
  }

  get initialized(): boolean | undefined {
    return this.device?.initialized
  }

  // Getters and setters
  get device() {
    return this._device
  }

  set device(device: typeof this._device) {
    if (device) {
      // Check if the device info is valid
      if (
        !this._device
        || this._device.device_model !== device.device_model
        || this._device.device_name !== device.device_name
        || this._device.initialized !== device.initialized
        || this._device.port !== device.port
        || this._device.min_client_version !== device.min_client_version
        || this._device.os_version !== device.os_version
        || !isEqual(this._device.lan_ipv4, device.lan_ipv4)
        || !isEqual(this._device.tb_ipv4, device.tb_ipv4)
      ) {
        this.onConnectDevice()

        // Update device
        this._device = device

        // Save device to config
        Config.set('connection.device', device)

        // Start connection monitor
        this.startConnectionMonitor()

        // Update Tray icon
        if (this.currentConnectionPath) {
          ZimaTray.updateIcon('zima')
        }
        else {
          ZimaTray.updateIcon('retry')
        }
      }
    }
    else {
      this.onDisconnectDevice()

      // Update device
      this._device = device

      // Stop connection monitor
      this.stopConnectionMonitor()

      // Delele device related data
      this.ztNetwork = undefined
      this.authentication = undefined
      this.currentConnectionPath = undefined
      this._availableConnectionPaths = []

      // Delete all device related data
      Config.delete('connection')

      // Update Tray icon
      ZimaTray.updateIcon('unconfigured')
    }
  }

  get ztNetwork() {
    return this._ztNetwork
  }

  set ztNetwork(ztNetwork: typeof this._ztNetwork) {
    const oldZtNetwork = this._ztNetwork

    if (ztNetwork) {
      this._ztNetwork = ztNetwork
      Config.set('connection.ztNetwork', ztNetwork)
    }
    else {
      // @ts-expect-error This will work.
      Config.delete('connection.ztNetwork')
    }

    if (oldZtNetwork && oldZtNetwork.networkId !== ztNetwork?.networkId) {
      // Leave the old network
      ZeroTier.getInstance().network.deleteNetwork(oldZtNetwork.networkId)
      log.info(`[Connection] Leave old ZeroTier network: ${oldZtNetwork.networkId}`)
      // Join the new network if available
      if (ztNetwork) {
        log.info(`[Connection] Join new ZeroTier network: ${ztNetwork.networkId}`)
        ZeroTier.getInstance().network.updateNetwork(ztNetwork.networkId, {})
      }
    }
  }

  get authentication() {
    return this._authentication
  }

  set authentication(tokens: typeof this._authentication) {
    const oldAuth = this._authentication

    if (!isEqual(oldAuth, tokens)) {
      this._authentication = tokens

      this.onTokenUpdated()

      // Set PeerDrop window
      this.setPeerDropWindow()

      if (tokens) {
        Config.set('connection.authentication', tokens)
        this.startAuthMonitor()
        this.startZtNetworkMonitor()
        this.startUserInfosMonitor()

        // Update Tray icon
        if (this.currentConnectionPath) {
          ZimaTray.updateIcon('zima')

          this.onHasConnectionPathAndAuthed()
        }
        else {
          ZimaTray.updateIcon('retry')
        }
      }
      else {
        // @ts-expect-error This will work.
        Config.delete('connection.authentication')
        this.stopAuthMonitor()

        // Delete all user related data
        this.user = undefined
        this.userCustom = {}

        // Update Tray icon
        ZimaTray.updateIcon('unconfigured')

        this.onLostConnectionPathOrUnauthed()
      }
    }
  }

  get availableConnectionPaths() {
    return this._availableConnectionPaths
  }

  get lastConnectionPath() {
    return this._lastConnectionPath
  }

  private set lastConnectionPath(lastConnection: typeof this._lastConnectionPath) {
    this._lastConnectionPath = lastConnection
    Config.set('connection.lastConnection', lastConnection)
  }

  get currentConnectionPath() {
    return this._currentConnectionPath
  }

  private set currentConnectionPath(currentConnection: typeof this._currentConnectionPath) {
    const oldConnectionPath = this._currentConnectionPath

    if (!isEqual(oldConnectionPath, currentConnection)) {
      // Update current connection path
      this._currentConnectionPath = currentConnection

      // Update agents
      this.updateAgents()

      // Update ZimaOS APIs
      this.updateZimaOSAPIs({
        loacalIpv4: currentConnection?.local_ipv4,
        remoteIpv4: currentConnection?.remote_ipv4,
        port: this.device?.port,
      })

      // Connection path changes
      if (oldConnectionPath === undefined && currentConnection) {
        log.info(`[Connection Path Change] Connected using ${currentConnection.method}, ${currentConnection.remote_ipv4}`)
      }
      else if (oldConnectionPath && currentConnection === undefined) {
        log.info(`[Connection Path Change] Disconnected from ${oldConnectionPath.method}, ${oldConnectionPath.remote_ipv4}`)
      }
      else if (oldConnectionPath && currentConnection) {
        log.info(`[Connection Path Change] Connection path changed from ${oldConnectionPath.method} to ${currentConnection.method}, remote: ${currentConnection.remote_ipv4}`)
      }

      this.onConnectionPathChangedTo(currentConnection)

      // If the connection path is changed to a available path
      if (currentConnection) {
        // Connected via Thunderbolt
        if (currentConnection.method === 'thunderbolt') {
          log.info('[Notification] Connected via Thunderbolt')
          showNotification(
            {
              title: $t('intoThunderboltConnection'),
              body: $t('connectedViaThunderbolt'),
            },
          )
        }

        // Remember the last connection path
        this.lastConnectionPath = currentConnection

        // Update Tray icon
        if (this.authentication) {
          ZimaTray.updateIcon('zima')

          this.onHasConnectionPathAndAuthed()
        }
        else {
          ZimaTray.updateIcon('unconfigured')
        }

        // Update user infos
        this.updateUserInfos()
      }
      else {
        // Update Tray icon
        if (this.device) {
          ZimaTray.updateIcon('retry')
        }

        this.onLostConnectionPathOrUnauthed()
      }

      // Set PeerDrop window
      this.setPeerDropWindow()
    }
  }

  get user() {
    return this._user
  }

  set user(user: typeof this._user) {
    const oldUser = this._user

    if (!isEqual(oldUser, user)) {
      this._user = user

      if (user) {
        Config.set('connection.user', user)
      }
      else {
        // @ts-expect-error This will work.
        Config.delete('connection.user')
      }
    }
  }

  get userCustom() {
    return this._userCustom
  }

  set userCustom(custom: typeof this._userCustom) {
    this._userCustom = custom
  }

  // Constructor
  private constructor() {
    // Get configs
    this._device = Config.get('connection.device')
    this._ztNetwork = Config.get('connection.ztNetwork')
    this._authentication = Config.get('connection.authentication')
    this._user = Config.get('connection.user')
    this._lastConnectionPath = Config.get('connection.lastConnectionPath')

    if (this.device) {
      // Update Tray icon
      ZimaTray.updateIcon('retry')

      // Start connection monitor
      this.startConnectionMonitor()

      if (this.authentication) {
        this.onStartWithDeviceAndAuthed()
        // Start auth monitor
        this.startAuthMonitor()

        // Start ZtNetwork monitor
        this.startZtNetworkMonitor()

        // Start user infos monitor
        this.startUserInfosMonitor()
      }
      else {
        this.onStartWithDeviceAndNoAuth()
      }
    }
    else {
      this.onStartWithoutDevice()

      // Update Tray icon
      ZimaTray.updateIcon('unconfigured')
    }
  }

  // ==============================
  //
  //    Lifecycle Hooks
  //
  // ==============================

  private onStartWithDeviceAndAuthed() {
    // ZimaBackup
    ZimaBackup.getInstance().start({
      onSocketConnected: () => {
        ZimaBackup.getInstance().deviceChange({
          client_name: Config.get('hostname'),
          host: this.currentConnectionPath?.remote_ipv4 ?? this.lastConnectionPath?.remote_ipv4,
          port: this.device?.port,
          token: this.authentication?.access_token,
          refresh_token: this.authentication?.refresh_token,
          is_tb: this.currentConnectionPath?.method === 'thunderbolt',
        })
      },
    })
  }

  private onStartWithDeviceAndNoAuth() {
  }

  private onStartWithoutDevice() {
  }

  private onConnectDevice() {
    // ZimaBackup
    if (ZimaBackup.getInstance().isRunning()) {
      ZimaBackup.getInstance().deviceChange({
        client_name: Config.get('hostname'),
        host: this.currentConnectionPath?.remote_ipv4,
        port: this.device?.port,
        token: this.authentication?.access_token,
        refresh_token: this.authentication?.refresh_token,
        is_tb: this.currentConnectionPath?.method === 'thunderbolt',
      })
    }
    else {
      ZimaBackup.getInstance().start({
        onSocketConnected: () => {
          ZimaBackup.getInstance().deviceChange({
            client_name: Config.get('hostname'),
            host: this.currentConnectionPath?.remote_ipv4,
            port: this.device?.port,
            token: this.authentication?.access_token,
            refresh_token: this.authentication?.refresh_token,
            is_tb: this.currentConnectionPath?.method === 'thunderbolt',
          })
        },
      })
    }
  }

  private onDisconnectDevice() {
    // ZimaBackup
    ZimaBackup.getInstance().stop()
    zimaBackupWindow.close()
  }

  private onHasConnectionPathAndAuthed() {

  }

  private onLostConnectionPathOrUnauthed() {
  }

  private onTokenUpdated() {
    ZimaBackup.getInstance().deviceChange({
      token: this.authentication!.access_token,
      refresh_token: this.authentication!.refresh_token,
    })
  }

  private onConnectionPathChangedTo(connectionPath?: ConnectionPath) {
    // ZimaBackup device change
    ZimaBackup.getInstance().deviceChange({
      host: connectionPath?.remote_ipv4,
      port: this.device?.port,
      is_tb: connectionPath?.method === 'thunderbolt',
    })
  }

  // ==============================
  //
  //        Methods
  //
  // ==============================

  private updateZimaOSAPIs(options: {
    loacalIpv4?: string
    remoteIpv4?: string
    port?: number
  }) {
    log.info(`Update ZimaOS API with ${options.loacalIpv4 ? `${options.loacalIpv4} -> ` : ''}${options.remoteIpv4}${options.port ? `:${options.port}` : ''}`)

    ZimaOSAPI.getInstance().initAPIs({
      remoteIpv4: options.remoteIpv4,
      port: options.port,
      httpAgent: new http.Agent({ localAddress: options.loacalIpv4 }),
      httpsAgent: new https.Agent({ localAddress: options.loacalIpv4 }),
    })
  }

  private setPeerDropWindow() {
    const targetUrl = (this.currentConnectionPath && this.authentication) ? `http://${this.currentConnectionPath.remote_ipv4}:${this.device!.port}` : ''
    const currentUrl = PeerDropWindow.window.webContents.getURL()
    if (
      // Current is about:blank and have target url
      (currentUrl === 'about:blank' && targetUrl)
      // Current is not about:blank and target url is not the same as current url
      || (currentUrl !== 'about:blank' && !currentUrl.startsWith(targetUrl))
      // Current is not about:blank and target url is empty
      || (currentUrl !== 'about:blank' && targetUrl === '')
    ) {
      PeerDropWindow.loadUrl(targetUrl)
    }
  }

  // Static Methods
  public static getInstance() {
    if (!ConnectionManager.instance) {
      ConnectionManager.instance = new ConnectionManager()
    }
    return ConnectionManager.instance
  }

  // Methods
  public async login(username: string, password: string) {
    if (!this.device) {
      throw new Error ('No device connected')
    }

    const auth: ConnectionAuthentication = (await ZimaOSAPI.getInstance().userservice.user.loginUser({
      username,
      password,
    }))
      .data
      .data
      .token as ConnectionAuthentication

    this.authentication = auth
    this.updateUserInfos()

    return auth
  }

  public logout() {
    if (this.authentication) {
      this.authentication = undefined
    }
  }

  private updateUserInfos() {
    if (!this.device || !this.authentication || !this.currentConnectionPath) {
      return
    }

    // Get user info
    ZimaOSAPI.getInstance().userservice.user.getCurrentUser().then((res) => {
      this.user = res.data.data
    }).catch((err) => {
      log.error('[Connection] Failed to get user', err.message)
    })

    // Get user custom data
    // Get wallpaper
    ZimaOSAPI.getInstance().userservice.user.getCurrentUserCustom('wallpaper').then((res) => {
      this.userCustom.wallpaper = res.data.data
    }).catch((err) => {
      log.error('[Connection] Failed to get user custom data (wallpaper)', err.message)
    })
  }

  private updateAgents() {
    log.info(`[Connection] Update http/https agents with ${this._currentConnectionPath?.local_ipv4 ?? 'undefined'}`)

    // Re-create http agent
    ConnectionManager.httpAgent.destroy()
    ConnectionManager.httpAgent = new http.Agent({ localAddress: this._currentConnectionPath?.local_ipv4 })

    // Re-create https agent
    ConnectionManager.httpsAgent.destroy()
    ConnectionManager.httpsAgent = new https.Agent({ localAddress: this._currentConnectionPath?.local_ipv4 })
  }

  // ---------------------
  // Connection Monitor
  // ---------------------
  // The connection monitor is responsible for checking the available connection paths and selecting the best one.
  // The monitor will be started when a device is connected.
  // The monitor will be stopped when no device is connected.
  // The monitor will check the connection status every 5 seconds.
  // The monitor will select the best connection path based on the following priority:
  // 1. Thunderbolt
  // 2. Ethernet
  // 3. WiFi
  // 4. Remote
  // ---------------------
  // 1. Check for available connection paths
  // 2. Select the best connection path
  // ---------------------

  // @ts-expect-error No use for now.
  private async getAvailableConnectionPaths(): Promise<ConnectionPath[]> {
    if (!this.device) {
      throw new Error ('No device connected')
    }

    const ENABLE_CHECKING_LOG = true

    const availableConnPaths: ConnectionPath[] = []
    const connectedIfaces = await getConnectedNetworkInterfaces()

    // Check for available Ethernet and WiFi connections
    for (const [type, ifaces] of Object.entries(connectedIfaces).filter(([type]) => ['ethernet', 'wifi'].includes(type))) {
      for (const iface of ifaces) {
        for (const ipv4 of this.device?.lan_ipv4 ?? []) {
          try {
            ENABLE_CHECKING_LOG && log.info(`[Connection Monitor] Checking ${type} connection: ${iface.ip4} -> ${ipv4}`)
            const device = await getDeviceByIP(ipv4, new http.Agent({ localAddress: iface.ip4 }))
            if (device.hash === this.device.hash) {
              this.device = device
              availableConnPaths.push({
                method: type as ConnectionPath['method'],
                local_ipv4: iface.ip4,
                remote_ipv4: ipv4,
              })
            }
          }
          catch {
            continue
          }
        }
      }
    }

    // Check for available Thunderbolt connections
    for (const iface of connectedIfaces.thunderbolt) {
      for (const ipv4 of this.device?.tb_ipv4 ?? []) {
        try {
          ENABLE_CHECKING_LOG && log.info(`[Connection Monitor] Checking Thunderbolt connection: ${iface.ip4} -> ${ipv4}`)
          const device = await getDeviceByIP(ipv4, new http.Agent({ localAddress: iface.ip4 }))
          if (device.hash === this.device.hash) {
            this.device = device
            availableConnPaths.push({
              method: 'thunderbolt',
              local_ipv4: iface.ip4,
              remote_ipv4: ipv4,
            })
          }
        }
        catch {
          continue
        }
      }
    }

    // Check for available remote connections
    if (this.ztNetwork) {
      try {
        const network = (await ZeroTier.getInstance().network.getNetwork(this.ztNetwork.networkId)).data
        const local_ipv4 = getZtNetworkLocalIPv4(network)
        ENABLE_CHECKING_LOG && log.info(`[Connection Monitor] Checking remote connection: ${local_ipv4} -> ${this.ztNetwork.remote_ipv4}`)
        const device = await getDeviceByIP(this.ztNetwork.remote_ipv4, new http.Agent({ localAddress: local_ipv4 }))
        if (device.hash === this.device.hash) {
          this.device = device
          availableConnPaths.push({
            method: 'remote',
            local_ipv4,
            remote_ipv4: this.ztNetwork.remote_ipv4,
          })
        }
      }
      catch (err: any) {
        if (err?.response?.status === 404) {
          log.info(`[Connection Monitor] ZeroTier network(${this.ztNetwork.networkId}) not joined, join the network`)
          ZeroTier.getInstance().network.updateNetwork(this.ztNetwork.networkId, {})
          // Retry remote path in next check
        }
      }
    }

    if (!this.device) {
      throw new Error ('No device connected')
    }

    this._availableConnectionPaths = availableConnPaths
    return availableConnPaths
  }

  // Concurrently check for available connection paths
  // If this function works correctly, delete the above function.
  private async detectAvailableConnectionPaths(): Promise<ConnectionPath[]> {
    if (!this.device) {
      throw new Error ('No device connected')
    }

    const ENABLE_IFACES_LOG = false
    const ENABLE_CHECKING_LOG = false
    const ENABLE_GET_DEVICE_LOG = false

    const GET_DEVICE_TIMEOUT = 2 * 1000

    // Get connected network interfaces
    // const ifaceTimeout = setTimeoutTask(() => {
    //   throw new Error('[Connection Monitor] Timeout while getting connected network interfaces.')
    // }, 3 * 1000)
    // const connectedIfaces = await getConnectedNetworkInterfaces()
    // clearTimeoutTask(ifaceTimeout)
    const connectedIfaces = await Promise.race([
      getConnectedNetworkInterfaces(),
      // Timeout
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('[Connection Monitor] Timeout while getting connected network interfaces.'))
        }, 3 * 1000)
      }),
    ])
    log.info(
      '[Connection Monitor] Connected network interfaces:',
      ENABLE_IFACES_LOG
        // Print all connected interfaces
        ? connectedIfaces // Print all
        // Print summary of connected interfaces
        : connectedIfaces
          && Object.entries(connectedIfaces)
            .map(([type, ifaces]) => {
              return `${type}: ${ifaces.length}`
            })
            .join(', '),
    )

    const promises: Promise<ConnectionPath | null>[] = []
    const checkedPaths: ConnectionPath[] = []

    // Check for available Ethernet and WiFi connections
    for (const [type, ifaces] of Object.entries(connectedIfaces).filter(([type]) => ['ethernet', 'wifi'].includes(type))) {
      for (const iface of ifaces) {
        for (const ipv4 of this.device?.lan_ipv4 ?? []) {
          const path = {
            method: type as ConnectionPath['method'],
            local_ipv4: iface.ip4,
            remote_ipv4: ipv4,
          } as ConnectionPath
          checkedPaths.push(path)
          promises.push((async () => {
            try {
              if (!this.device) {
                return null
              }
              const device = await getDeviceByIP(
                ipv4,
                new http.Agent({ localAddress: iface.ip4 }),
                GET_DEVICE_TIMEOUT,
              )
              if (device.hash === this.device.hash) {
                this.device = device
                return path
              }
              else {
                return null
              }
            }
            catch (err: any) {
              if (ENABLE_GET_DEVICE_LOG) {
                log.error(`[Connection Monitor] Failed to get device by IP ${iface.ip4} -> ${ipv4}`, err)
              }
              return null
            }
          })())
        }
      }
    }

    // Check for available Thunderbolt connections
    for (const iface of connectedIfaces.thunderbolt) {
      for (const ipv4 of this.device?.tb_ipv4 ?? []) {
        const path = {
          method: 'thunderbolt',
          local_ipv4: iface.ip4,
          remote_ipv4: ipv4,
        } as ConnectionPath
        checkedPaths.push(path)
        promises.push((async () => {
          try {
            if (!this.device) {
              return null
            }
            const device = await getDeviceByIP(
              ipv4,
              new http.Agent({ localAddress: iface.ip4 }),
              GET_DEVICE_TIMEOUT,
            )
            if (device.hash === this.device.hash) {
              this.device = device
              return path
            }
            else {
              return null
            }
          }
          catch (err: any) {
            if (ENABLE_GET_DEVICE_LOG) {
              log.error(`[Connection Monitor] Failed to get device by IP ${iface.ip4} -> ${ipv4}`, err)
            }
            return null
          }
        })())
      }
    }

    // Check for available remote connections
    if (this.ztNetwork) {
      try {
        const network = (await Promise.race([
          ZeroTier.getInstance().network.getNetwork(this.ztNetwork.networkId),
          // Timeout
          new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(new Error('Timeout while getting ZeroTier network info.'))
            }, 1 * 1000)
          }),
        ])).data
        const local_ipv4 = getZtNetworkLocalIPv4(network)
        const path = {
          method: 'remote',
          local_ipv4,
          remote_ipv4: this.ztNetwork.remote_ipv4,
        } as ConnectionPath
        checkedPaths.push(path)
        promises.push((async () => {
          if (!this.device || !this.ztNetwork) {
            return null
          }
          try {
            const device = await getDeviceByIP(
              this.ztNetwork.remote_ipv4,
              new http.Agent({ localAddress: local_ipv4 }),
              GET_DEVICE_TIMEOUT,
            )
            if (device.hash === this.device.hash) {
              this.device = device
              return path
            }
            else {
              return null
            }
          }
          catch (err: any) {
            if (ENABLE_GET_DEVICE_LOG) {
              log.error(`[Connection Monitor] Failed to get device by IP ${local_ipv4} -> ${this.ztNetwork.remote_ipv4}`, err)
            }
            return null
          }
        })())
      }
      catch (err: any) {
        if (err?.response?.status === 404) {
          log.info(`[Connection Monitor] ZeroTier network(${this.ztNetwork.networkId}) not joined, join the network`)
          ZeroTier.getInstance().network.updateNetwork(this.ztNetwork.networkId, {})
          // Retry remote path in next check
        }
        else {
          log.error('[Connection Monitor] Failed to get ZeroTier network', err.message)
        }
      }
    }

    // Wait for all promises to resolve
    // const checkPathTimeout = setTimeoutTask(() => {
    //   throw new Error('[Connection Monitor] Timeout while checking connection paths.')
    // }, 5 * 1000)
    // const results = await Promise.all(promises)
    // clearTimeoutTask(checkPathTimeout)
    const results = await Promise.race([
      Promise.all(promises),
      // Timeout
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('[Connection Monitor] Timeout while checking connection paths.'))
        }, 5 * 1000)
      }),
    ])

    // Filter out null results
    const availableConnPaths = results.filter(result => result !== null) as ConnectionPath[]
    log.info(
      '[Connection Monitor] Checked connection paths:',
      ENABLE_CHECKING_LOG
      // Print all checked paths
        ? checkedPaths.map(cp => `${
            availableConnPaths.find(
              ap => ap.method === cp.method && ap.local_ipv4 === cp.local_ipv4 && ap.remote_ipv4 === cp.remote_ipv4,
            )
              ? 'OK'
              : '--'
          } | ${cp.method.padEnd(11)} | ${cp.local_ipv4.padStart(15)} -> ${cp.remote_ipv4}`)
      // Print summary of checked paths
        : `${checkedPaths.length}, available: ${availableConnPaths.length}.`,
    )
    this._availableConnectionPaths = availableConnPaths
    return availableConnPaths
  }

  // Connection Monitor
  private async checkConnection() {
    if (!this.device) {
      log.info('[Connection Monitor] No device connected, stop connection monitor.')
      this.stopConnectionMonitor()
      return
    }
    if (this.connectionMonitorChecking) {
      log.info('[Connection Monitor] There is a checking task running, skip this time.')
      return
    }

    this.connectionMonitorChecking = true

    const availableConnPaths: ConnectionPath[] = []
    try {
      // availableConnPaths.push(...await this.getAvailableConnectionPaths())
      availableConnPaths.push(...(await this.detectAvailableConnectionPaths()))
    }
    catch (err: any) {
      if (this.device) {
        log.error('[Connection Monitor] Failed to get available connection paths', err)
      }
      else {
        log.info('[Connection Monitor] No device connected, stop connection monitor.')
        this.stopConnectionMonitor()
      }
      return
    }
    finally {
      this.connectionMonitorChecking = false
    }

    // Figrue out the current connection path
    if (availableConnPaths.length === 0) {
      if (this.currentConnectionPath) {
        this.currentConnectionPath = undefined
        log.info('[Connection Monitor] No available connection path.')
      }
    }
    else {
      // Filter available connection paths
      const thunderboltConnPath = availableConnPaths.filter(connPath => connPath.method === 'thunderbolt')
      const ethernetConnPath = availableConnPaths.filter(connPath => connPath.method === 'ethernet')
      const wifiConnPath = availableConnPaths.filter(connPath => connPath.method === 'wifi')
      const remoteConnPath = availableConnPaths.filter(connPath => connPath.method === 'remote')

      // Select the best connection path
      if (thunderboltConnPath.length > 0) {
        this.currentConnectionPath = thunderboltConnPath[0]
      }
      else if (ethernetConnPath.length > 0) {
        // Check if the last connection path is still available
        if (
          this.lastConnectionPath
          && this.lastConnectionPath?.method === 'ethernet'
          && ethernetConnPath.some(connPath => (
            connPath.local_ipv4 === this.lastConnectionPath?.local_ipv4
            && connPath.remote_ipv4 === this.lastConnectionPath?.remote_ipv4
          ))
        ) {
          this.currentConnectionPath = this.lastConnectionPath
        }
        else {
          this.currentConnectionPath = ethernetConnPath[0]
        }
      }
      else if (wifiConnPath.length > 0) {
      // Check if the last connection path is still available
        if (
          this.lastConnectionPath
          && this.lastConnectionPath?.method === 'wifi'
          && wifiConnPath.some(connPath => (
            connPath.local_ipv4 === this.lastConnectionPath?.local_ipv4
            && connPath.remote_ipv4 === this.lastConnectionPath?.remote_ipv4
          ))
        ) {
          this.currentConnectionPath = this.lastConnectionPath
        }
        else {
          this.currentConnectionPath = wifiConnPath[0]
        }
      }
      else if (remoteConnPath.length > 0) {
        this.currentConnectionPath = remoteConnPath[0]
      }
    }
  }

  private startConnectionMonitor() {
    if (!this.device) {
      log.error('[Connection Monitor] No device selected, cannot start connection monitor')
      return
    }
    // Stop connection monitor if already started
    if (this.connectionMonitorTimer) {
      this.stopConnectionMonitor()
    }
    // Start connection monitor
    this.connectionMonitorTimer = setIntervalTask(() => {
      this.checkConnection()
    }, this.connectionMonitorInterval)

    log.info('[Connection Monitor] Started')

    // Check connection immediately
    this.checkConnection()
  }

  private stopConnectionMonitor() {
    if (this.connectionMonitorTimer) {
      clearIntervalTask(this.connectionMonitorTimer)
      this.connectionMonitorTimer = undefined
    }
    this.connectionMonitorChecking = false

    log.info('[Connection Monitor] Stopped')
  }

  // ---------------------
  // Auth Monitor
  // ---------------------
  // The auth monitor is responsible for checking the authentication status and refreshing the token if it's expired.
  // The monitor will be started when a device is connected and an authentication is available.
  // The monitor will be stopped when no device is connected or no authentication is available.
  // The monitor will check the authentication status every 1 minute.
  // The monitor will refresh the token if it's expired (5 minutes before the expiration).
  // ---------------------
  // 1. Check if the token is expired
  // 2. Refresh the token if it's expired
  // 3. Stop the monitor if no device is connected
  // 4. Stop the monitor if no authentication is available
  // ---------------------

  private async checkAuth() {
    if (!this.device) {
      log.info('[Connection] No device connected, stop auth monitor.')
      this.stopAuthMonitor()
      return
    }
    if (!this.authentication) {
      log.info('[Connection] No authentication available')
      return
    }
    if (this.authMonitorChecking) {
      return
    }

    this.authMonitorChecking = true

    const now = Date.now()
    if (this.authentication.expires_at * 1000 - now < TOKEN_REFRESH_THRESHOLD) {
      await this.refreshToken()
    }

    this.authMonitorChecking = false
  }

  public async refreshToken() {
    if (!this.authentication) {
      log.error('[Connection] No authentication available')
      return
    }
    if (this.isRefreshingToken) {
      return
    }

    this.isRefreshingToken = true

    try {
      log.info('[Connection] Tring to refresh token.')

      const newAuth: ConnectionAuthentication = (
        await ZimaOSAPI
          .getInstance()
          .userservice
          .user
          .refreshUserToken({
            refresh_token: this.authentication?.refresh_token,
          })
      ).data.data

      log.info('[Connection] Token refreshed. Expires at:', newAuth.expires_at)

      this.authentication = newAuth
    }
    catch (err: any) {
      log.error('[Connection] Refresh token failed', err.message)
      if (
        this.currentConnectionPath
        && err.response?.status === 401
      ) {
        log.info('[Connection] Token expired, logout.')
        this.authentication = undefined
      }
    }

    this.isRefreshingToken = false
  }

  private startAuthMonitor() {
    if (!this.device) {
      log.error('[Connection] No device selected, cannot start auth monitor')
      return
    }

    // Stop auth monitor if already started
    if (this.authMonitorTimer) {
      this.stopAuthMonitor()
    }
    // Start auth monitor
    this.authMonitorTimer = setIntervalTask(() => {
      this.checkAuth()
    }, this.authMonitorInterval)

    log.info('[Connection Auth Monitor] Started')

    // Check auth immediately
    this.checkAuth()
  }

  private stopAuthMonitor() {
    if (this.authMonitorTimer) {
      clearIntervalTask(this.authMonitorTimer)
      this.authMonitorTimer = undefined
    }
    this.authMonitorChecking = false
    log.info('[Connection Auth Monitor] Stopped')
  }

  // ---------------------
  // ZtNetwork Monitor
  // ---------------------
  // The ZtNetwork monitor is responsible for checking the ZeroTier network status and joining the network if not joined.
  // The monitor will be started when a device is connected and an authentication is available.
  // The monitor will be stopped when no device is connected or no authentication is available.
  // The monitor will check the ZeroTier network status every 30 seconds.
  // ---------------------
  private async checkZtNetwork() {
    if (!this.device) {
      log.info('[Connection ZtNetwork Monitor] No device connected, stop ZtNetwork monitor.')
      this.stopZtNetworkMonitor()
      return
    }
    if (!this.authentication) {
      log.info('[Connection ZtNetwork Monitor] No authentication available, stop ZtNetwork monitor.')
      this.stopZtNetworkMonitor()
      return
    }
    if (!this.currentConnectionPath) {
      log.info('[Connection ZtNetwork Monitor] No connection path available, skip to check ZtNetwork this time.')
      return
    }

    if (this.ztNetworkMonitorChecking) {
      return
    }

    this.ztNetworkMonitorChecking = true

    // Get the ZeroTier network from the device
    try {
      const ztinfo = (await ZimaOSAPI.getInstance().zimaos.zerotier.getZerotierInfo()).data

      if (ztinfo.id && ztinfo.ip) {
        // Check if the ZeroTier network changed
        if (this._ztNetwork && this._ztNetwork.networkId !== ztinfo.id) {
          log.info(`[Connection ZtNetwork Monitor] ZeroTier network changed from ${this._ztNetwork.networkId} to ${ztinfo.id}`)
        }

        // Update ZeroTier network if changed
        if (
          ztinfo.ip !== this._ztNetwork?.remote_ipv4
          || ztinfo.id !== this._ztNetwork?.networkId
        ) {
          this.ztNetwork = {
            networkId: ztinfo.id,
            remote_ipv4: ztinfo.ip,
          }
        }
      }
      else {
        throw new Error('ZeroTier network may not enabled')
      }
    }
    catch (err: any) {
      if (err?.status === 500 || err?.message === 'ZeroTier network may not enabled') {
        // ZeroTier network may not enabled on the device
        log.info('[Connection ZtNetwork Monitor] ZeroTier network may not enabled on the device')
        this.ztNetwork = undefined
      }
      else {
        // Failed to get ZeroTier network
        log.error('[Connection ZtNetwork Monitor] Failed to get ZeroTier network', err)
      }
    }

    // Check if the ZeroTier network is joined
    if (this.ztNetwork) {
      try {
        // Get the network
        await ZeroTier.getInstance().network.getNetwork(this.ztNetwork.networkId)
      }
      catch (err: any) {
        if (err?.response?.status === 404) {
        // Join the network if not joined
          log.info(`[Connection ZtNetwork Monitor] ZeroTier network(${this.ztNetwork.networkId}) not joined`)
          ZeroTier.getInstance().network.updateNetwork(this.ztNetwork.networkId, {})
        }
      }
    }

    this.ztNetworkMonitorChecking = false
  }

  private startZtNetworkMonitor() {
    if (!this.device) {
      log.error('[Connection] No device selected, cannot start ZtNetwork monitor')
      return
    }
    if (!this.authentication) {
      log.error('[Connection] No authentication available, cannot start ZtNetwork monitor')
      return
    }

    // Stop ZtNetwork monitor if already started
    if (this.ztNetworkMonitorTimer) {
      this.stopZtNetworkMonitor()
    }
    // Start ZtNetwork monitor
    this.ztNetworkMonitorTimer = setIntervalTask(() => {
      this.checkZtNetwork()
    }, this.ztNetworkMonitorInterval)

    log.info('[Connection ZtNetwork Monitor] Started')

    // Check ZtNetwork immediately
    this.checkZtNetwork()
  }

  private stopZtNetworkMonitor() {
    if (this.ztNetworkMonitorTimer) {
      clearIntervalTask(this.ztNetworkMonitorTimer)
      this.ztNetworkMonitorTimer = undefined
    }
    this.ztNetworkMonitorChecking = false

    log.info('[Connection ZtNetwork Monitor] Stopped')
  }

  // ---------------------
  // User Infos Monitor
  // ---------------------
  // The user infos monitor is responsible for checking the user information and custom data.
  // The monitor will be started when a device is connected and an authentication is available.
  // The monitor will be stopped when no device is connected or no authentication is available.
  // The monitor will check the user information and custom data every 30 seconds.
  // ---------------------
  private async checkUserInfos() {
    if (!this.device) {
      log.info('[Connection User Infos Monitor] No device connected, stop user infos monitor.')
      this.stopUserInfosMonitor()
      return
    }
    if (!this.authentication) {
      log.info('[Connection User Infos Monitor] No authentication available, stop user infos monitor.')
      this.stopUserInfosMonitor()
      return
    }
    if (!this.currentConnectionPath) {
      log.info('[Connection User Infos Monitor] No connection path available, skip to check user infos this time.')
      return
    }

    if (this.userInfosMonitorChecking) {
      return
    }

    this.userInfosMonitorChecking = true

    this.updateUserInfos()

    this.userInfosMonitorChecking = false
  }

  private startUserInfosMonitor() {
    if (!this.device) {
      log.error('[Connection] No device selected, cannot start user infos monitor')
      return
    }
    if (!this.authentication) {
      log.error('[Connection] No authentication available, cannot start user infos monitor')
      return
    }

    // Stop user infos monitor if already started
    if (this.userInfosMonitorTimer) {
      this.stopUserInfosMonitor()
    }
    // Start user infos monitor
    this.userInfosMonitorTimer = setIntervalTask(() => {
      this.checkUserInfos()
    }, this.userInfosMonitorInterval)

    log.info('[Connection User Infos Monitor] Started')

    // Check user infos immediately
    this.checkUserInfos()
  }

  private stopUserInfosMonitor() {
    if (this.userInfosMonitorTimer) {
      clearIntervalTask(this.userInfosMonitorTimer)
      this.userInfosMonitorTimer = undefined
    }
    this.userInfosMonitorChecking = false

    log.info('[Connection User Infos Monitor] Stopped')
  }
}
