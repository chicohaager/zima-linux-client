import { BrowserWindow, shell } from 'electron'
import { logger } from '@main/logging/logger'

/**
 * Opens an app's own web UI — Plan § 7.4, mobile Screen 4.
 *
 * Two ways, both explicit:
 *
 *  - **In a window of its own**, with a separate session partition. The partition is the
 *    point: an app's cookies must not sit in the same jar as the client's device session,
 *    or a compromised app could ride along on it.
 *  - **In the system browser**, when the user prefers that.
 *
 * The window carries no preload and no bridge. It renders a third-party page, so it gets
 * nothing: no `window.zima`, no Node, sandboxed, and navigation is confined to the app's
 * own origin — a redirect to somewhere else opens in the system browser instead of quietly
 * loading inside a window that looks like part of this client.
 */

export const openInBrowser = async (url: string): Promise<void> => {
  await shell.openExternal(url)
}

export const openInWindow = (params: {
  readonly url: string
  readonly title: string
}): BrowserWindow => {
  const origin = new URL(params.url).origin
  const window = new BrowserWindow({
    width: 1_100,
    height: 780,
    title: params.title,
    autoHideMenuBar: true,
    webPreferences: {
      // A per-app partition, not the default session: separate cookies, cache and storage.
      partition: `persist:zima-app-${encodeURIComponent(params.title)}`,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin === origin) return
    // Leaving the app's origin inside this window would present a foreign page in a frame
    // the user reads as "my ZimaOS app". Hand it to the browser, where the address bar says
    // where they are.
    event.preventDefault()
    logger.info('app-window.navigation-externalised', { to: new URL(url).origin })
    void shell.openExternal(url)
  })

  void window.loadURL(params.url)
  return window
}
