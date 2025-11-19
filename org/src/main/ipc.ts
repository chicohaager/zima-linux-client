import { is } from '@electron-toolkit/utils'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { main } from '.'
import { Config } from './config'
import { $t, i18n } from './i18n'
import { ZimaTray } from './tray'
import { ConnectionManager } from './utils/device'
import { showNotification } from './utils/notification'
import { mainWindow } from './windows'

export function globalIpcHandlers(): void {
  // ----------------
  // App
  // ----------------
  // Quit app
  ipcMain.handle('app:quit', () => {
    app.quit()
  })
  // App version
  ipcMain.handle('app:getVersion', () => {
    return app.getVersion()
  })
  // app.showAboutPanel
  ipcMain.handle('app:showAboutPanel', () => {
    app.showAboutPanel()
  })
  // app.getLoginItemSettings { openAtLogin, status }
  ipcMain.handle('app:getOpenAtLogin', () => {
    const settings = app.getLoginItemSettings()
    return {
      openAtLogin: is.dev ? true : settings.openAtLogin,
      status: settings.status,
    }
  })
  // app.setLoginItemSettings { openAtLogin }
  ipcMain.handle('app:setOpenAtLogin', () => {
    !is.dev && app.setLoginItemSettings({
      openAtLogin: true,
    })
  })
  // app main
  ipcMain.handle('app:main', () => {
    main()
  })

  // ----------------
  // i18n
  // ----------------
  // $t
  ipcMain.handle('$t', (_event, key, options) => {
    return $t(key, options)
  })
  // i18n change language
  ipcMain.handle('i18n:changeLanguage', (_event, language) => {
    return i18n.changeLanguage(language)
  })

  // ----------------
  // Config
  // ----------------
  // get
  ipcMain.handle('config:get', (_event, key) => {
    return Config.get(key)
  })
  // set
  ipcMain.handle('config:set', (_event, key, value) => {
    Config.set(key, value)
  })
  // delete
  ipcMain.handle('config:delete', (_event, key) => {
    Config.delete(key)
  })
  // store
  ipcMain.handle('config:store', (_event) => {
    return Config.store
  })
  // clear
  ipcMain.handle('config:clear', (_event) => {
    Config.clear()
  })

  // ----------------
  // Tray
  // ----------------
  ipcMain.handle('Tray:updateIcon', (_event, icon) => {
    ZimaTray.updateIcon(icon)
  })

  // ----------------
  // Dialog
  // ----------------

  // Show open directory dialog
  ipcMain.handle('dialog:openDirectory', async (event, options) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (!senderWindow) {
      return
    }
    const result = await dialog.showOpenDialog(senderWindow, {
      properties: ['openDirectory', 'createDirectory'],
      ...options,
    })
    return result
  })

  // ----------------
  // Notification
  // ----------------
  ipcMain.handle('notification:show', (_event, options) => {
    const { title, body, slient } = options
    showNotification({ title, body, slient })
  })

  // ----------------
  // Window
  // ----------------

  // isClosable
  ipcMain.handle('window:isClosable', (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (senderWindow) {
      return senderWindow.isClosable()
    }
    return false
  })
  // setCloseable
  ipcMain.handle('window:setClosable', (event, closeable) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (senderWindow) {
      senderWindow.setClosable(closeable)
    }
  })
  // Close window
  ipcMain.handle('window:close', (event, force) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (senderWindow && (senderWindow.isClosable() || force)) {
      force && senderWindow.hide() && senderWindow.setClosable(true)
      senderWindow.close()
    }
  })

  // isResizable
  ipcMain.handle('window:isResizable', (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (senderWindow) {
      return senderWindow.isResizable()
    }
    return false
  })
  // setResizable
  ipcMain.handle('window:setResizable', (event, resizable) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (senderWindow) {
      senderWindow.setResizable(resizable)
    }
  })
  // Resize window
  ipcMain.handle('window:resize', (event, width, height, force) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (senderWindow) {
      if (senderWindow.isResizable()) {
        senderWindow.setContentSize(width, height)
      }
      else {
        if (force) {
          senderWindow.setResizable(true)
          senderWindow.setContentSize(width, height)
          senderWindow.setResizable(false)
        }
      }
      if (senderWindow.id === mainWindow.window.id) {
        mainWindow.resetPosition()
      }
    }
  })

  // set height
  ipcMain.handle('window:setHeight', (event, height, force) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (senderWindow) {
      if (senderWindow.isResizable()) {
        senderWindow.setContentSize(senderWindow.getContentSize()[0], height)
      }
      else if (force) {
        senderWindow.setResizable(true)
        senderWindow.setContentSize(senderWindow.getContentSize()[0], height)
        senderWindow.setResizable(false)
      }
      if (senderWindow.id === mainWindow.window.id) {
        mainWindow.resetPosition()
      }
    }
  })

  // isMaximizable
  ipcMain.handle('window:isMaximizable', (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (senderWindow) {
      return senderWindow.isMaximizable()
    }
    return false
  })
  // setMaximizable
  ipcMain.handle('window:setMaximizable', (event, maximizable) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (senderWindow) {
      senderWindow.setMaximizable(maximizable)
    }
  })
  // Maximize window
  ipcMain.handle('window:maximize', (event, force) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (senderWindow) {
      if (senderWindow.isMaximizable()) {
        senderWindow.isMaximized() ? senderWindow.unmaximize() : senderWindow.maximize()
      }
      else if (force) {
        senderWindow.setResizable(true)
        senderWindow.isMaximized() ? senderWindow.unmaximize() : senderWindow.maximize()
        senderWindow.setResizable(false)
      }
    }
  })

  // isMinimizable
  ipcMain.handle('window:isMinimizable', (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (senderWindow) {
      return senderWindow.isMinimizable()
    }
    return false
  })
  // setMinimizable
  ipcMain.handle('window:setMinimizable', (event, minimizable) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (senderWindow) {
      senderWindow.setMinimizable(minimizable)
    }
  })
  // Minimize window
  ipcMain.handle('window:minimize', (event, force) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (senderWindow) {
      if (senderWindow.isMinimizable()) {
        senderWindow.minimize()
      }
      else if (force) {
        senderWindow.setResizable(true)
        senderWindow.minimize()
        senderWindow.setResizable(false)
      }
    }
  })

  // ----------------
  // Shell
  // ----------------
  // Open external
  ipcMain.handle('shell:openExternal', (_event, url) => {
    shell.openExternal(url)
  })
  // Open path
  ipcMain.handle('shell:openPath', (_event, path) => {
    shell.openPath(path)
  })
  // Show item in folder
  ipcMain.handle('shell:showItemInFolder', (_event, path) => {
    shell.showItemInFolder(path)
  })

  // ----------------
  // ZimaOS
  // ----------------
  // Open Path in ZimaOS Files
  ipcMain.handle('zimaos:files:openPath', (_event, path) => {
    const cm = ConnectionManager.getInstance()
    if (cm.currentConnectionPath) {
      const host = cm.currentConnectionPath.remote_ipv4
      const port = cm.device?.port ?? 80
      // When server is ready to use token
      // const tokens = cm.authentication
      //   ? `?${qs.stringify({
      //     token: cm.authentication.access_token,
      //     refresh_token: cm.authentication.refresh_token,
      //   })}`
      //   : ''

      // Real Path => Files Path
      const replacedPath = path.replace(/^\/DATA/, '/ZimaOS-HD').replace(/^\/media/, '')
      shell.openExternal(`http://${host}:${port}/modules/icewhale_files/#/files${replacedPath}`)
    }
  })
}
