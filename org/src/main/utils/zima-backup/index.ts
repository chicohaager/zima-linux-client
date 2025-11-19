import type { BrowserWindow } from 'electron'
import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import net from 'node:net'
import process from 'node:process'
import { mainWindow, zimaBackupWindow } from '@main/windows'
import zima_backup_darwin_arm64 from '@resources/deps/zima-backup/darwin/arm64/zima-backup-v2?asset&asarUnpack'

import zima_backup_darwin_x64 from '@resources/deps/zima-backup/darwin/x64/zima-backup-v2?asset&asarUnpack'
import zima_backup_win32_x64 from '@resources/deps/zima-backup/win32/x64/zima-backup-v2.exe?asset&asarUnpack'
import { ipcMain } from 'electron'

import log from 'electron-log'

const DEBUG_MESSAGES = false

const ZIMA_BACKUP_BINARY = {
  darwin: {
    arm64: zima_backup_darwin_arm64,
    x64: zima_backup_darwin_x64,
  },
  win32: {
    x64: zima_backup_win32_x64,
  },
}

const ZIMA_BACKUP_SOCKET_XPIPE_PATH = '/tmp/zimaos_backupv2_pipe'

function winWebContentsSend(
  window: BrowserWindow | undefined,
  channel: string,
  ...args: any[]
): void {
  window && !window.isDestroyed() && window.webContents.send(channel, ...args)
}

export class ZimaBackup {
  private static instance: ZimaBackup
  private process: ChildProcess | null = null
  private socket: net.Socket | null = null
  private buffer: string = ''
  private eventEmitter = new EventEmitter()

  private constructor() {
    this.eventEmitter.on('error', (message) => {
      log.error('[ZimaBackup] Error:', message)
    })
  }

  public static getInstance(): ZimaBackup {
    if (!ZimaBackup.instance) {
      ZimaBackup.instance = new ZimaBackup()
    }
    return ZimaBackup.instance
  }

  public isRunning(): boolean {
    return !!this.process && !!this.socket
  }

  private getBinaryPath(): string {
    const platform = process.platform
    const arch = process.arch

    if (platform in ZIMA_BACKUP_BINARY) {
      if (arch in ZIMA_BACKUP_BINARY[platform]) {
        return ZIMA_BACKUP_BINARY[platform][arch]
      }
    }

    throw new Error(`Unsupported platform: ${platform} ${arch}`)
  }

  private getSocketPath(): string {
    const platform = process.platform

    if (platform === 'darwin') {
      return ZIMA_BACKUP_SOCKET_XPIPE_PATH
    }
    else if (platform === 'win32') {
      return `//./pipe/${ZIMA_BACKUP_SOCKET_XPIPE_PATH}`
    }

    throw new Error(`Unsupported platform for socket: ${platform}`)
  }

  private setupSocket({
    onConnected,
  }: {
    onConnected?: () => void
  }): void {
    if (this.socket) {
      log.warn('[ZimaBackup] Socket is already setup')
      return
    }

    const socketPath = this.getSocketPath()

    log.info('[ZimaBackup] Setting up socket:', socketPath)

    this.socket = net.createConnection(socketPath, () => {
      log.info('[ZimaBackup] Connected to ZimaBackup socket')
    })

    this.socket.on('connect', () => {
      log.info('[ZimaBackup] Socket connected')
      onConnected?.()
    })

    this.socket.on('data', (data) => {
      this.buffer += data.toString()

      let boundaryIndex: number
      boundaryIndex = this.buffer.indexOf('\n')
      while (boundaryIndex !== -1) {
        const message = this.buffer.slice(0, boundaryIndex)
        this.buffer = this.buffer.slice(boundaryIndex + 1)

        DEBUG_MESSAGES && log.info('[ZimaBackup] Received message:', message)

        try {
          const parsedMessage: ZimaBackupMessage = JSON.parse(message)
          this.handleSocketMessage(parsedMessage)
        }
        catch (error) {
          log.error('[ZimaBackup] Failed to parse message:', error)
        }

        boundaryIndex = this.buffer.indexOf('\n')
      }
    })

    this.socket.on('error', (error) => {
      log.error('[ZimaBackup] Socket error:', error)
      this.socket = null
    })

    this.socket.on('close', () => {
      log.warn('[ZimaBackup] Socket connection closed')
      this.socket = null
    })
  }

  // public start(deviceInfo?: Partial<ZimaBackupDeviceInfo>): void {
  public start({
    onSocketConnected,
  }: {
    onSocketConnected?: () => void
  },
  ): void {
    // Skip ZimaBackup on Linux (no binary available)
    if (process.platform === 'linux') {
      log.warn('[ZimaBackup] ZimaBackup is not supported on Linux - skipping')
      return
    }

    if (this.process) {
      log.warn('[ZimaBackup] Process is already running')
      return
    }

    log.info('[ZimaBackup] Starting ZimaBackup process')

    const binaryPath = this.getBinaryPath()

    // // Prepare arguments
    // const args
    //   = deviceInfo
    //     ? [
    //         `-client_name=${deviceInfo.client_name}`,
    //         deviceInfo.host ? `-host=${deviceInfo.host}` : '',
    //         deviceInfo.port ? `-port=${deviceInfo.port}` : '',
    //         deviceInfo.token ? `-token=${deviceInfo?.token}` : '',
    //         deviceInfo.refresh_token ? `-refresh_token=${deviceInfo.refresh_token}` : '',
    //         typeof deviceInfo.is_tb === 'boolean' ? `-is_tb=${deviceInfo.is_tb}` : '',
    //       ].filter(Boolean)
    //     : []

    // if (DEBUG_MESSAGES && args.length > 0) {
    //   log.info('[ZimaBackup] Starting ZimaBackup process with args:', args)
    // }

    // Start the ZimaBackup process
    this.process = spawn(
      binaryPath,
      // args,
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )

    this.process.stdout?.on('data', (data) => {
      DEBUG_MESSAGES && log.info('[ZimaBackup] stdout:', data.toString())
      if (data.toString().includes('listening')) {
        log.info('[ZimaBackup] ZimaBackup process is ready')
        this.setupSocket({
          onConnected: onSocketConnected,
        })
      }
    })

    this.process.stderr?.on('data', (data) => {
      log.info('[ZimaBackup] stderr:', data.toString())
    })

    this.process.on('error', (error) => {
      log.error('[ZimaBackup] Failed to start ZimaBackup process:', error)
      this.process = null
    })

    this.process.on('exit', (code) => {
      log.info(`[ZimaBackup] Process exited with code: ${code}`)
      this.process = null
    })
  }

  public stop(): void {
    if (this.process) {
      log.info('[ZimaBackup] Stopping ZimaBackup process')
      this.exit()
      this.process.kill()
      this.process = null
    }

    if (this.socket) {
      log.info('[ZimaBackup] Closing ZimaBackup socket')
      this.socket.end()
      this.socket = null
    }

    this.eventEmitter.removeAllListeners()

    log.info('[ZimaBackup] Stopped')
  }

  private handleSocketMessage(message: ZimaBackupMessage) {
    DEBUG_MESSAGES && log.info('[ZimaBackup] Handle message:', message)
    switch (message.op) {
      case 'progress':
        this.eventEmitter.emit('progress', message)
        winWebContentsSend(zimaBackupWindow.window, 'ZimaBackup:events:progress', message)
        break
      case 'complete':
        this.eventEmitter.emit('complete', message)
        winWebContentsSend(mainWindow.window, 'ZimaBackup:events:complete', message)
        winWebContentsSend(zimaBackupWindow.window, 'ZimaBackup:events:complete', message)
        break
      case 'error':
        this.eventEmitter.emit('error', message)
        winWebContentsSend(mainWindow.window, 'ZimaBackup:events:error', message)
        winWebContentsSend(zimaBackupWindow.window, 'ZimaBackup:events:error', message)
        break
      case 'list':
        this.eventEmitter.emit('list', message)
        winWebContentsSend(mainWindow.window, 'ZimaBackup:events:list', message)
        winWebContentsSend(zimaBackupWindow.window, 'ZimaBackup:events:list', message)
        break
      case 'status_change':
        this.eventEmitter.emit('status_change', message)
        winWebContentsSend(mainWindow.window, 'ZimaBackup:events:status_change', message)
        winWebContentsSend(zimaBackupWindow.window, 'ZimaBackup:events:status_change', message)
        break
      case 'keep_revision_change':
        this.eventEmitter.emit('keep_revision_change', message)
        winWebContentsSend(zimaBackupWindow.window, 'ZimaBackup:events:keep_revision_change', message)
        break
      default:
        log.warn('[ZimaBackup] Unknown message:', message)
    }
  }

  public on<K extends keyof ZimaBackupEventMap>(
    event: K,
    listener: (message: ZimaBackupEventMap[K]) => void,
  ): void {
    this.eventEmitter.on(event, listener)
  }

  public once<K extends keyof ZimaBackupEventMap>(
    event: K,
    listener: (message: ZimaBackupEventMap[K]) => void,
  ): void {
    this.eventEmitter.once(event, listener)
  }

  public off<K extends keyof ZimaBackupEventMap>(
    event: K,
    listener: (message: ZimaBackupEventMap[K]) => void,
  ): void {
    this.eventEmitter.off(event, listener)
  }

  public removeAllListeners(event?: ZimaBackupEvent): void {
    this.eventEmitter.removeAllListeners(event)
  }

  public sendMessage(message: ZimaBackupMessage): void {
    if (!this.socket) {
      log.error('[ZimaBackup] Socket is not connected')
      return
    }

    try {
      const data = JSON.stringify(message)
      DEBUG_MESSAGES && log.info('[ZimaBackup] Sending message:', message)
      this.socket.write(`${data}\n`)
    }
    catch (error) {
      log.error('[ZimaBackup] Failed to send message:', error)
    }
  }

  public deviceChange(deviceInfo: Partial<ZimaBackupDeviceInfo>): void {
    const message: ZimaBackupDeviceChangeMessage = {
      op: 'dev_change',
      ...deviceInfo,
    }
    this.sendMessage(message)
  }

  public listBackups(): void {
    const message: ZimaBackupListBackupsMessage = {
      op: 'list',
    }
    this.sendMessage(message)
  }

  public createBackup(sourcePath: string, destPath: string, filters?: string): void {
    const message: ZimaBackupCreateBackupMessage = {
      op: 'create',
      source_path: sourcePath,
      dest_path: destPath,
      filters,
    }
    this.sendMessage(message)
  }

  public deleteBackup(task_id: ZimaBackupTask['task_id']): void {
    const message: ZimaBackupDeleteBackupMessage = {
      op: 'delete',
      task_id,
    }
    this.sendMessage(message)
  }

  public pasueBackup(task_id: ZimaBackupTask['task_id']): void {
    const message: ZimaBackupPauseMessage = {
      op: 'pause',
      task_id,
    }
    this.sendMessage(message)
  }

  public resumeBackup(task_id: ZimaBackupTask['task_id']): void {
    const message: ZimaBackupResumeMessage = {
      op: 'resume',
      task_id,
    }
    this.sendMessage(message)
  }

  public keepRevision(task_id: ZimaBackupTask['task_id'], action: boolean): void {
    const message: ZimaBackupKeepRevisionMessage = {
      op: 'keep_revision',
      action,
      task_id,
    }
    this.sendMessage(message)
  }

  public listenStatusChange(action: boolean): void {
    const message: ZimaBackupListenStatusChangeMessage = {
      op: 'status_change',
      action,
    }
    this.sendMessage(message)
  }

  public listenProgress(action: boolean): void {
    const message: ZimaBackupListenProgressMessage = {
      op: 'progress',
      action,
    }
    this.sendMessage(message)
  }

  private exit(): void {
    const message: ZimaBackupExitMessage = {
      op: 'exit',
    }
    this.sendMessage(message)
  }

  public registerIpcHandlers(): void {
    ipcMain.handle('ZimaBackup:deviceChange', (_event, deviceInfo) => {
      this.deviceChange(deviceInfo)
    })
    ipcMain.handle('ZimaBackup:listBackups', () => {
      this.listBackups()
    })
    ipcMain.handle('ZimaBackup:createBackup', (_event, sourcePath, destPath, filters) => {
      this.createBackup(sourcePath, destPath, filters)
    })
    ipcMain.handle('ZimaBackup:deleteBackup', (_event, task_id) => {
      this.deleteBackup(task_id)
    })
    ipcMain.handle('ZimaBackup:pasueBackup', (_event, task_id) => {
      this.pasueBackup(task_id)
    })
    ipcMain.handle('ZimaBackup:resumeBackup', (_event, task_id) => {
      this.resumeBackup(task_id)
    })
    ipcMain.handle('ZimaBackup:keepRevision', (_event, task_id, action) => {
      this.keepRevision(task_id, action)
    })
    ipcMain.handle('ZimaBackup:listenStatusChange', (_event, action) => {
      this.listenStatusChange(action)
    })
    ipcMain.handle('ZimaBackup:listenProgress', (_event, action) => {
      this.listenProgress(action)
    })
  }

  public unregisterIpcHandlers(): void {
    ipcMain.removeHandler('ZimaBackup:deviceChange')
    ipcMain.removeHandler('ZimaBackup:listBackups')
    ipcMain.removeHandler('ZimaBackup:createBackup')
    ipcMain.removeHandler('ZimaBackup:deleteBackup')
    ipcMain.removeHandler('ZimaBackup:pasueBackup')
    ipcMain.removeHandler('ZimaBackup:resumeBackup')
    ipcMain.removeHandler('ZimaBackup:keepRevision')
    ipcMain.removeHandler('ZimaBackup:listenStatusChange')
    ipcMain.removeHandler('ZimaBackup:listenProgress')
  }
}
