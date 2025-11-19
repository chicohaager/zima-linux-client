import type { BrowserWindowConstructorOptions } from 'electron'

import { join } from 'node:path'

import process from 'node:process'
import { is, optimizer } from '@electron-toolkit/utils'
import { BrowserWindow, screen, shell } from 'electron'
import Positioner from 'electron-positioner'

import icon from '../../../resources/icons/zima.png?asset&asarUnpack'

const route: string = 'Dev'
const bwOptions: BrowserWindowConstructorOptions = {
  width: 520,
  height: 800,
  show: false,
  alwaysOnTop: false,
  autoHideMenuBar: true,
  ...(process.platform === 'linux' ? { icon } : {}),
  webPreferences: {
    preload: join(__dirname, '../preload/index.js'),
    sandbox: false,
  },
}

class DevWindow {
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

    // Create the positioner.
    this._position = new Positioner(this._window)
    this.resetPosition()

    // Handle external links.
    this._window.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    // Show the window when ready.
    if (showWhenReady) {
      this._window.once('ready-to-show', () => {
        this._window?.show()
      })
    }

    // Load the remote URL for development or the local html file for production.
    if (is.dev && process.env.ELECTRON_RENDERER_URL) {
      this._window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/#${route}`)
    }
    else {
      this._window.loadFile(join(__dirname, `../renderer/index.html`), { hash: route })
    }

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    optimizer.watchWindowShortcuts(this._window)

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

  get window() {
    !this._window && this.init()
    return this._window!
  }

  get position() {
    !this._position && this.init()
    return this._position!
  }
}

const devWindow = new DevWindow()

export { devWindow }
