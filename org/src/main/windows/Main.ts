import type { BrowserWindowConstructorOptions } from 'electron'
import { join } from 'node:path'

import process from 'node:process'
import { is, optimizer, platform } from '@electron-toolkit/utils'
import { app, BrowserWindow, screen, shell } from 'electron'
import log from 'electron-log'

import Positioner from 'electron-positioner'
import icon from '../../../resources/icons/zima.png?asset&asarUnpack'
import { ConnectionManager } from '../utils/device'

const WINDOW_MARGIN = 16

const route = 'Main'
const bwOptions: BrowserWindowConstructorOptions = {
  useContentSize: true,
  width: 360,
  height: 0,
  show: false,
  frame: false,
  // titleBarStyle: 'hidden',
  // titleBarOverlay: false,
  maximizable: false,
  minimizable: true,
  resizable: false,
  closable: false,
  alwaysOnTop: true,
  skipTaskbar: platform.isMacOS,
  autoHideMenuBar: true,
  ...(process.platform === 'linux' ? { icon } : {}),
  webPreferences: {
    preload: join(__dirname, '../preload/index.js'),
    sandbox: false,
  },
}

class MainWindow {
  private _window?: BrowserWindow
  private _position?: Positioner

  constructor() {}

  init(showWhenReady: boolean = false) {
    if (this._window?.isDestroyed()) {
      this._window = undefined
    }
    else if (this._window) {
      if (showWhenReady) {
        this._window.show()
      }
      return this._window
    }

    // Create the browser window.
    this._window = new BrowserWindow(bwOptions)

    // Set the window as always on top.
    this._window.setAlwaysOnTop(true)

    // Set visibility on all workspaces.
    this._window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    app.dock?.show()

    // Create the positioner.
    this._position = new Positioner(this._window)
    this.resetPosition()

    // Hide the window when it loses focus.
    this._window.webContents.on('blur', () => {
      if (!this._window?.webContents.isDevToolsOpened() && !this._window?.webContents.isDevToolsFocused()) {
        if (platform.isMacOS) {
          this._window?.hide()
        }
        else {
          this._window?.minimize()
        }
      }
    })
    this._window.on('restore', () => {
      this.resetPosition()
    })
    this._window.on('resized', () => {
      const size = this._window?.getContentSize()
      const width = size?.[0]
      const height = size?.[1]

      // Unexpected window size warning.
      if (width !== 360) {
        log.warn(`[MainWindow] Unexpected window size, width: ${width}, height: ${height}.`)
        this._window?.setContentSize(360, height!)
        log.warn(`[MainWindow] Window size has been reset to 360x${height}.`)
      }
    })

    // Handle external links.
    this._window.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    // Load the remote URL for development or the local html file for production.
    if (is.dev && process.env.ELECTRON_RENDERER_URL) {
      this._window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/#${route}`)
    }
    else {
      this._window.loadFile(join(__dirname, `../renderer/index.html`), { hash: route })
    }

    this.window.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
      const cm = ConnectionManager.getInstance()
      const remote_ipv4 = cm.currentConnectionPath?.remote_ipv4
      const access_token = cm.authentication?.access_token
      if (details.url.startsWith(`http://${remote_ipv4}`) && access_token) {
        details.requestHeaders.Authorization = access_token
      }

      callback({ cancel: false, requestHeaders: details.requestHeaders })
    })

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    optimizer.watchWindowShortcuts(this._window)

    // Show the window when ready.
    if (showWhenReady) {
      this._window.once('ready-to-show', () => {
        this._window?.show()
        this._window?.focus()
      })
    }

    return this._window
  }

  resetPosition() {
    if (!this._window || this._window.isDestroyed()) {
      this.init()
    }
    if (!this._window) {
      return
    }

    const cursorPoint = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursorPoint)
    const workArea = display.workArea
    const width = this._window.getSize()[0]
    const height = this._window.getSize()[1]

    this._window.setPosition(
      // Right
      workArea.x + workArea.width - width - WINDOW_MARGIN,
      // Windows on the bottom, otherwise on the top
      platform.isWindows
        ? workArea.y + workArea.height - height - WINDOW_MARGIN
        : workArea.y + WINDOW_MARGIN,
    )
  }

  show() {
    if (!this._window || this._window.isDestroyed()) {
      this.init(true)
    }
    else {
      if (this._window.isMinimized()) {
        this._window.restore()
        this._window.focus()
      }
      else {
        this._window.show()
        this._window.focus()
      }
    }
  }

  get window() {
    (!this._window || this._window.isDestroyed()) && this.init()
    return this._window!
  }

  get position() {
    (!this._window || this._window.isDestroyed()) && this.init()
    return this._position!
  }
}

const mainWindow = new MainWindow()

export { mainWindow }
