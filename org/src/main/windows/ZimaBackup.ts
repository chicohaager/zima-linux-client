import type { BrowserWindowConstructorOptions } from 'electron'
import path from 'node:path'
import process from 'node:process'
import { is, optimizer, platform } from '@electron-toolkit/utils'
import { ZimaBackup } from '@main/utils/zima-backup'
import icon from '@resources/icons/zima.png?asset&asarUnpack'
import { BrowserWindow, screen, shell } from 'electron'
import Positioner from 'electron-positioner'

const route = 'Backup'
const bwOptions: BrowserWindowConstructorOptions = {
  width: 768,
  height: 486,
  show: false,
  titleBarStyle: 'hidden',
  titleBarOverlay: true,
  maximizable: false,
  resizable: false,
  alwaysOnTop: false,
  autoHideMenuBar: true,
  ...(platform.isLinux ? { icon } : {}),
  webPreferences: {
    preload: path.join(__dirname, '../preload/index.js'),
    sandbox: false,
  },
}

class ZimaBackupWindow {
  private _window?: BrowserWindow
  private _position?: Positioner

  constructor() {}

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

    // Create the positioner.
    this._position = new Positioner(this._window)
    this.resetPosition()

    // Handle external links.
    this._window.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    //
    this._window.once('ready-to-show', () => {
      if (showWhenReady) {
        this._window?.show()
      }

      ZimaBackup.getInstance().listenProgress(true)
    })

    this._window.on('close', () => {
      ZimaBackup.getInstance().listenProgress(false)
    })

    // Load the remote URL for development or the local html file for production.
    if (is.dev && process.env.ELECTRON_RENDERER_URL) {
      this._window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/#${route}`)
    }
    else {
      this._window.loadFile(path.join(__dirname, '../renderer/index.html'), { hash: route })
    }

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    optimizer.watchWindowShortcuts(this._window)

    return this._window
  }

  get window() {
    return this._window
  }

  get position() {
    return this._position
  }

  show() {
    this._window
      ? this._window.show()
      : this.init(true).show()
  }

  close() {
    this._window?.close()
    this._window = undefined
  }
}

const zimaBackupWindow = new ZimaBackupWindow()
export { zimaBackupWindow }
