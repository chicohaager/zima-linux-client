import type { BrowserWindowConstructorOptions } from 'electron'

import { join } from 'node:path'

import process from 'node:process'
import { is, optimizer } from '@electron-toolkit/utils'
import { BrowserWindow, nativeTheme, screen, shell } from 'electron'

import Positioner from 'electron-positioner'
import icon from '../../../resources/icons/zima.png?asset&asarUnpack'

const route = 'Device'
const bgColor = ['#0A0A0A', '#FFFFFFF']
const bwOptions: BrowserWindowConstructorOptions = {
  width: 798,
  height: 486,
  show: true,  // Always show on Linux where system tray might not be visible
  titleBarStyle: 'hidden',
  titleBarOverlay: true,
  maximizable: false,
  resizable: false,
  alwaysOnTop: false,
  autoHideMenuBar: true,
  ...(process.platform === 'linux' ? { icon } : {}),
  webPreferences: {
    preload: join(__dirname, '../preload/index.js'),
    sandbox: false,
  },
}

const pages = [
  'ConnectUsingLanDiscovery',
  'ConnectUsingNetworkID',
  'ConnectUsingIP',
  'Login',
  'LoginSuccess',
] as const

type Page = typeof pages[number]

class DeviceWindow {
  private _window?: BrowserWindow
  private _position?: Positioner

  private _page: Page = 'ConnectUsingLanDiscovery'

  constructor() {}

  private loadPage(page?: Page) {
    page && (this._page = page)

    // Load the remote URL for development or the local html file for production.
    if (is.dev && process.env.ELECTRON_RENDERER_URL) {
      this._window?.loadURL(`${process.env.ELECTRON_RENDERER_URL}/#${route}/${this._page}`)
    }
    else {
      this._window?.loadFile(join(__dirname, `../renderer/index.html`), { hash: `${route}/${this._page}` })
    }
  }

  init(page?: Page, showWhenReady: boolean = false) {
    if (this._window?.isDestroyed()) {
      this._window = undefined
    }
    else if (this._window) {
      page && this.loadPage(page)

      if (showWhenReady) {
        this._window.show()
      }
      return this._window
    }

    // Create the browser window.
    this._window = new BrowserWindow({
      ...bwOptions,
      backgroundColor: nativeTheme.shouldUseDarkColors ? bgColor[0] : bgColor[1],
    })

    // Create the positioner.
    this._position = new Positioner(this._window)
    this.resetPosition()

    // Handle external links.
    this._window.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    // Load the page.
    this.loadPage(page || this._page)

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    optimizer.watchWindowShortcuts(this._window)

    // Show the window when ready.
    if (showWhenReady) {
      this._window.once('ready-to-show', () => {
        this._window?.show()
      })
    }

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

  show(page?: Page) {
    if (page && !pages.includes(page)) {
      page = undefined
    }

    if (this._window?.isDestroyed() || !this._window) {
      this.init(page, true)
    }
    else {
      page && this.loadPage(page)
      this._window?.show()
    }
  }

  get window() {
    (this._window?.isDestroyed() || !this._window) && this.init()
    return this._window!
  }

  get position() {
    (this._window?.isDestroyed() || !this._position) && this.init()
    return this._position!
  }
}

const deviceWindow = new DeviceWindow()

export { deviceWindow }
