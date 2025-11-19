import { arch, platform, release } from 'node:os'
import process from 'node:process'
import { is, optimizer } from '@electron-toolkit/utils'
import zb2Version from '@resources/deps/zima-backup/version?raw'
import ztVersion from '@resources/installer/zerotier/version?raw'
import { app, BrowserWindow, ipcMain, webContents } from 'electron'
import contextMenu from 'electron-context-menu'
import log from 'electron-log/main'

import { autoUpdater } from 'electron-updater'
import { Config } from './config'
import { initI18n } from './i18n'
import { globalIpcHandlers } from './ipc'
import { ZimaTray } from './tray'
import { deviceIpcHandlers } from './utils/device'
import { registerSmbIpcHandlers } from './utils/samba'
import { clearAllTasks, setIntervalTask } from './utils/timers'
import { ZeroTierService } from './utils/zerotier'
import { ZimaBackup } from './utils/zima-backup'
import {
  devWindow,
  initializationWindow,
  mainWindow,
  windowsIpcHanders,
} from './windows'
import { deviceWindow } from './windows/Device'

let stage: 'start' | 'init' | 'main' = 'start'

// Set app user model id for windows
app.setAppUserModelId('com.zimaspace.zima')

// Single instance lock
if (app.requestSingleInstanceLock()) {
  app.on('second-instance', () => {
    if (stage === 'main') {
      // Show main window
      showMainWindow()
    }
  })
}
else {
  // Quit if another instance is already running
  app.quit()
}

// Initialize log
log.initialize()
log.info('App starting...')
log.info(`App version: ${arch()} ${app.getVersion()} `)
log.info(`Electron: ${process.versions.electron} Node: ${process.versions.node}`)
log.info(`Platform: ${platform()}`)
log.info(`OS release: ${release()}`)
log.info(`System version: ${process.getSystemVersion()}`)

// Set autoUpdater logger
autoUpdater.logger = log

// Initialize ZeroTier
const zts = ZeroTierService.getInstance()

// Common Context Menu
contextMenu({
  showInspectElement: is.dev,
  // Links
  showCopyLink: false,
  showSaveLinkAs: false,
  // Images
  showCopyImage: false,
  showSaveImage: false,
  showSaveImageAs: false,
  showCopyImageAddress: false,
  // Videos
  showSaveVideo: false,
  showSaveVideoAs: false,
  showCopyVideoAddress: false,
  // Text
  showServices: false,
  showSearchWithGoogle: false,
  showLookUpSelection: false,
  showLearnSpelling: false,
  showSelectAll: false,
})

// Set About Panel Options
app.setAboutPanelOptions({
  applicationName: app.name,
  applicationVersion: app.getVersion(),
  copyright: [
    `ZimaBackup2 v${zb2Version.trim()}`,
    `ZeroTier v${ztVersion.trim()}`,
    '',
    `IceWhale © ${new Date().getFullYear()}`,
  ].join('\n'),
})

async function checkInitialized() {
  if (stage === 'init') {
    return
  }
  ZimaTray.stage = 'init'
  stage = 'init'

  log.info('Checking ZeroTier installation...')
  await zts.checkInstallation()
  log.info('ZeroTier installed:', zts.installed)

  log.info('Checking ZeroTier running status...')
  await zts.checkRunning()
  log.info('ZeroTier running:', zts.running)

  log.info('Getting ZeroTier auth token...')
  await zts.getAuthToken()
  log.info('ZeroTier has authtoken:', !!zts.authtoken)

  const initialized = Config.get('initialized')
  log.info('App initialized status:', initialized)

  if (!initialized || !zts.installed || !zts.running || !zts.authtoken) {
    log.info('Showing initialization window...')
    initializationWindow.init(true)
  }
  else {
    log.info('App already initialized, showing main window...')
    main()
  }
}

function showMainWindow() {
  mainWindow.resetPosition()
  mainWindow.show()
}

export function main() {
  if (stage === 'main') {
    return
  }
  ZimaTray.stage = 'main'
  stage = 'main'

  // Check if the app was connected to a device
  if (Config.get('connection.device')) {
    // Show main window
    showMainWindow()
  }
  else {
    // Show Connect Device window
    deviceWindow.init(undefined, true)
  }

  // Handle app activation
  app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      showMainWindow()
    }
    else if (BrowserWindow.getAllWindows().length > 0) {
      BrowserWindow.getAllWindows().forEach((win) => {
        if (win.id === mainWindow.window.id) {
          showMainWindow()
        }
      })
    }
  })
}

app.whenReady().then(async () => {
  // Initial i18n
  await initI18n()

  // Init Tray
  ZimaTray.init()

  // Set update channel
  autoUpdater.channel = Config.get('updateChannel') || 'latest'
  autoUpdater.setFeedURL(`https://zima-client.r2.icewhale.io/v2/${
    platform() === 'darwin' ? 'mac' : platform() === 'win32' ? 'win' : 'linux'
  }/${
    (platform() === 'darwin' && app.runningUnderARM64Translation)
      ? 'arm64'
      : arch()
  }`)
  // Check for updates every 24 hours
  setIntervalTask(() => {
    autoUpdater.checkForUpdatesAndNotify()
  }, 1000 * 60 * 60 * 24) // 24 hours
  // Check for updates immediately
  autoUpdater.checkForUpdatesAndNotify()

  // Register IPC Handlers
  globalIpcHandlers()
  zts.registerIpcHandlers()
  windowsIpcHanders()
  deviceIpcHandlers()
  registerSmbIpcHandlers()
  ZimaBackup.getInstance().registerIpcHandlers()

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Initial windows
  mainWindow.init()
  is.dev && devWindow.init(true)

  // Check if the app is initialized
  await checkInitialized()
})

app.on('window-all-closed', () => {
  // Do nothing
})

app.on('before-quit', () => {
  log.info('Do some cleanup before quitting...')

  log.info('Clear All WebContents')
  webContents.getAllWebContents().forEach((wc) => {
    try {
      wc.devToolsWebContents?.close()
      wc.removeAllListeners()
      wc.close()
    }
    catch {}
  })

  log.info('Clear All BrowserWindows')
  BrowserWindow.getAllWindows().forEach((win) => {
    try {
      win.removeAllListeners()
      win.setClosable(true)
      win.close()
      win.destroy()
    }
    catch {}
  })

  log.info('Destroy Tray')
  ZimaTray.destroy()
})

app.on('will-quit', () => {
  log.info('Will quit...')

  log.info('Clear All Timers')
  clearAllTasks()

  log.info('Clear All IPC Listeners')
  ipcMain.removeAllListeners()

  log.info('App Quit.')

  app.exit()
})

process.on('SIGINT', () => {
  log.info('Ctrl+C detected. Call app.quit() for clean exit.')

  app.quit()
})
