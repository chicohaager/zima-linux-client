import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { registerIpc } from '@main/ipc/register'
import { logger, tightenExistingLogs } from '@main/logging/logger'
import {
  armVerificationWatchdog,
  isEnabled as verifyStartupEnabled,
  runStartupVerification,
} from '@main/app/startupVerification'
import { isEnabled as verifyLiveEnabled, runLiveVerification } from '@main/app/liveVerification'
import { decidePlatform, markStartupSurvived } from '@main/app/resilientPlatform'
import { registerMediaProtocol, registerMediaScheme } from '@main/media/protocol'
import { stopForWindowClose } from '@main/transfer/backupQueue'
import { stopDaemon } from '@main/zerotier/daemon'

/**
 * Main process entry point.
 *
 * Security posture is fixed here and nowhere else: the renderer runs sandboxed with
 * context isolation and no Node integration, and any attempt to navigate away or open
 * a window goes through an explicit decision instead of being allowed by default.
 */

const createWindow = (): BrowserWindow => {
  // The verifier drives the layout breakpoint and the theme from the outside, so the
  // narrow/wide and light/dark screenshots come from the real build rather than from a
  // resized screenshot or a hand-set CSS class.
  const forcedWidth = Number(process.env['ZIMA_VERIFY_WIDTH'] ?? '')
  const window = new BrowserWindow({
    width: Number.isFinite(forcedWidth) && forcedWidth > 0 ? forcedWidth : 1180,
    height: 820,
    minWidth: 420, // narrow layout keeps the mobile bottom-pill navigation
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f5f6f8',
    title: 'ZimaOS Client',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  })

  window.on('ready-to-show', () => {
    window.show()
    // First paint reached: clear the sentinel so the next launch keeps its normal
    // platform instead of staying on the X11 fallback forever.
    markStartupSurvived()
  })

  // A dead GPU or renderer process must be loud. Silence here is how "it just does
  // not start" reports come to exist with nothing in the log.
  app.on('child-process-gone', (_event, details) => {
    logger.error('process.gone', {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
    })
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    logger.error('renderer.gone', { reason: details.reason, exitCode: details.exitCode })
  })

  // Startup verification runs after the first paint, then writes its report and quits.
  // Wired here rather than in a test harness so the exact same binary a user installs
  // is the one that gets verified on each distro.
  if (verifyStartupEnabled()) {
    // Armed BEFORE the load event, because "did-finish-load never fires" is one of the
    // ways this can stall — and a verifier that stalls reports nothing at all, which
    // reads exactly like "the package does not start".
    armVerificationWatchdog()
    window.webContents.once('did-finish-load', () => {
      setTimeout(() => void runStartupVerification(window), 1_200)
    })
  }

  // Anything that wants a new window is opened in the user's browser instead, so a
  // link inside the app cannot silently become an uncontrolled Electron window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url)
    } else {
      logger.warn('window.open-blocked', { url })
    }
    return { action: 'deny' }
  })

  const devServer = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && devServer !== undefined) {
    void window.loadURL(devServer)
  } else {
    void window.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }

  return window
}

// One instance only: a second launch focuses the existing window rather than
// starting a second upload queue against the same device.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [existing] = BrowserWindow.getAllWindows()
    if (existing !== undefined) {
      if (existing.isMinimized()) existing.restore()
      existing.focus()
    }
  })

  // Privileged scheme registration has to happen before the app is ready, and before any
  // window exists — afterwards Chromium has already fixed its scheme table.
  registerMediaScheme()

  // First thing that happens: if the previous launch never painted, this call
  // relaunches the process with the X11 flag in argv and we must not continue.
  //
  // Skipped for the headless endpoint measurement: platform resilience is about getting a
  // window painted, and a relaunch there would detach the process from the runner that is
  // waiting for its report — measured as a run that "wrote no report" while it actually
  // succeeded a second later.
  const platform = verifyLiveEnabled()
    ? { forcedX11: false, sessionType: 'headless', relaunching: false }
    : decidePlatform()

  void (platform.relaunching ? Promise.resolve() : app.whenReady()).then(() => {
    if (platform.relaunching) return
    // Before anything else writes: earlier builds left their logs world-readable, and they
    // name hosts and LAN addresses. Placed ahead of the live-verification branch so a
    // headless run tightens them too.
    tightenExistingLogs()
    electronApp.setAppUserModelId('com.zimaos.client')
    app.on('browser-window-created', (_event, window) => optimizer.watchWindowShortcuts(window))

    // Endpoint measurement runs headless: it needs a session and a network, not a window.
    // Placed before createWindow so a measurement run can never be confused with, or
    // disturbed by, a rendering app.
    if (verifyLiveEnabled()) {
      void runLiveVerification()
      return
    }

    registerIpc()
    registerMediaProtocol()
    logger.info('app.ready', {
      version: app.getVersion(),
      electron: process.versions.electron,
      platform: `${process.platform}-${process.arch}`,
      locale: app.getLocale(),
      sessionType: platform.sessionType,
      forcedX11: platform.forcedX11,
      logFile: logger.filePath(),
    })

    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    // No background work by design: photo backup runs only while the window is open, so
    // closing the window really does mean nothing is left running. Enforced, not just
    // documented — the queue is cancelled and the ZeroTier daemon we started is stopped.
    stopForWindowClose()
    stopDaemon()
    if (process.platform !== 'darwin') app.quit()
  })

  // Covers the paths that do not go through window-all-closed: a quit from the menu, a
  // SIGTERM, a session logout. Without it a supervised daemon could outlive the app.
  app.on('will-quit', () => {
    stopForWindowClose()
    stopDaemon()
  })
}
