import type { BrowserWindowConstructorOptions } from 'electron'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'

import { optimizer, platform } from '@electron-toolkit/utils'
import { app, BrowserWindow, ipcMain, screen, session, shell } from 'electron'
import log from 'electron-log'

import Positioner from 'electron-positioner'
import icon from '../../../resources/icons/zima.png?asset&asarUnpack'
import { Config } from '../config'
import { $t } from '../i18n'
import { ConnectionManager } from '../utils/device'
import { showNotification } from '../utils/notification'

const bwOptions: BrowserWindowConstructorOptions = {
  width: 1024,
  height: 768,
  show: false,
  // titleBarStyle: 'hidden',
  // titleBarOverlay: true,
  alwaysOnTop: false,
  autoHideMenuBar: true,
  ...(platform.isLinux ? { icon } : {}),
  webPreferences: {
    preload: path.join(__dirname, '../preload/index.js'),
    sandbox: false,
  },
}

const PEERDROP_URL = '/modules/icewhale_peerdrop'

export class PeerDropWindow {
  private static _instance: PeerDropWindow
  private _window?: BrowserWindow
  private _position?: Positioner

  private constructor() {}

  init() {
    if (this._window?.isDestroyed()) {
      this._window = undefined
    }
    else if (this._window) {
      return this._window
    }

    // Create the browser window.
    this._window = new BrowserWindow(bwOptions)

    // Create the positioner.
    this._position = new Positioner(this._window)
    this.resetPosition()

    // Handle external links.
    this._window.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    // Hide the window when user tries to close it.
    this._window.on('close', (event) => {
      if (this._window?.isVisible()) {
        event.preventDefault()
        this._window?.hide()
      }
    })

    // Handle window requestHeaders.
    this._window.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
      const cm = ConnectionManager.getInstance()
      const remote_ipv4 = cm.currentConnectionPath?.remote_ipv4
      const access_token = cm.authentication?.access_token
      if (details.url.startsWith(`http://${remote_ipv4}`) && access_token) {
        details.requestHeaders.Authorization = access_token
      }

      callback({ cancel: false, requestHeaders: details.requestHeaders })
    })

    PeerDropWindow.window.webContents.on('did-finish-load', () => {
      PeerDropWindow.checkWebConentsUrl()
      // PeerDropWindow.loadToken(ConnectionManager.getInstance().authentication)
    })

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    optimizer.watchWindowShortcuts(this._window)

    this.registerSaveFileIpcHandler()

    return this._window
  }

  resetPosition() {
    if (!this._window) {
      return
    }

    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const workArea = display.workArea
    const width = this._window.getSize()[0]
    const height = this._window.getSize()[1]

    // Set the window position to center of the work area.
    this._window.setPosition(
      Math.round(workArea.x + (workArea.width - width) / 2),
      Math.round(workArea.y + (workArea.height - height) / 2),
    )
  }

  private registerSaveFileIpcHandler() {
    ipcMain.handle(
      'device.fileDrop.saveFile',
      async (_event, name, arrayBuffer) => {
        const downloadPath = app.getPath('downloads')
        let filePath = path.join(downloadPath, name)

        let counter = 0
        const fileExtension = path.extname(name)
        const baseName = path.basename(name, fileExtension)
        while (fs.existsSync(filePath)) {
          counter++
          const newBaseName = `${baseName} (${counter})`
          filePath = path.join(downloadPath, `${newBaseName}${fileExtension}`)
        }

        const buffer = Buffer.from(arrayBuffer)

        fs.writeFile(filePath, buffer, (err) => {
          if (err) {
            console.error(err)
            return
          }
          shell.showItemInFolder(filePath)
          showNotification({
            title: $t('peerDrop') ?? 'PeerDrop',
            body:
            $t('fileSaved', {
              filename: path.basename(filePath),
            }) ?? '',
            slient: false,
          })
        })
      },
    )
  }

  static loadToken(authentication?: ConnectionAuthentication) {
    if (!authentication) {
      return
    }

    // const { access_token, refresh_token } = authentication
    // PeerDropWindow.window.webContents
    //   .executeJavaScript(
    //     `
    //       if (window.localStorage.getItem('access_token') !== '${access_token}' || window.localStorage.getItem('refresh_token') !== '${refresh_token}') {
    //         window.localStorage.setItem('access_token', '${access_token}');
    //         window.localStorage.setItem('refresh_token', '${refresh_token}');
    //       }
    //       if (location.href.includes("#/login")) location.href=(new URL("${PEERDROP_URL}", location.origin)).toString();
    //     `,
    //   )
    //   .catch((error) => {
    //     console.error('Error loading token:', error)
    //   })

    PeerDropWindow.checkWebConentsUrl()
  }

  static loadUrl(baseUrl: string) {
    const targetUrl = baseUrl ? new URL(PEERDROP_URL, baseUrl).toString() : 'about:blank'
    PeerDropWindow.window.loadURL(
      targetUrl,
      {
        userAgent: `${session.defaultSession.getUserAgent()} ${Config.get('hostname')}`,
      },
    )
    log.info(`Loading PeerDrop URL: ${targetUrl}`)
  }

  static checkWebConentsUrl() {
    if (PeerDropWindow.window.webContents.getURL() === 'about:blank') {
      PeerDropWindow.hide()
    }
    else if (PeerDropWindow.window.webContents.getURL().includes('#/login')) {
      ConnectionManager.getInstance().refreshToken()
    }
  }

  static show() {
    PeerDropWindow.window.show()
  }

  static hide() {
    PeerDropWindow.window.hide()
  }

  private static get instance() {
    if (!this._instance) {
      this._instance = new PeerDropWindow()
    }
    return this._instance
  }

  static get window() {
    if (
      !PeerDropWindow.instance._window
      || PeerDropWindow.instance._window.isDestroyed()
    ) {
      return PeerDropWindow.instance.init()
    }
    return PeerDropWindow.instance._window
  }

  static get position() {
    return PeerDropWindow.instance._position || new Positioner(PeerDropWindow.window)
  }
}
