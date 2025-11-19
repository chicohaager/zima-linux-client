import { ipcMain } from 'electron'

import { devWindow } from './Dev'
import { deviceWindow } from './Device'
import { initializationWindow } from './Initialization'
import { mainWindow } from './Main'
import { PeerDropWindow } from './PeerDrop'
import { zimaBackupWindow } from './ZimaBackup'

function windowsIpcHanders() {
  // Main window
  ipcMain.handle('mainWindow:show', async () => {
    mainWindow.show()
  })

  // Initialization window
  ipcMain.handle('initializationWindow:show', async () => {
    initializationWindow.init(true)
  })

  // Device window
  ipcMain.handle('deviceWindow:show', async (_event, page) => {
    deviceWindow.show(page)
  })

  // PeerDrop window
  ipcMain.handle('PeerDropWindow:show', async () => {
    PeerDropWindow.show()
  })

  // Dev window
  ipcMain.handle('devWindow:show', async () => {
    devWindow.window.show()
  })

  // ZimaBackup window
  ipcMain.handle('ZimaBackupWindow:show', async () => {
    zimaBackupWindow.init(true)
  })
}

export {
  devWindow,
  initializationWindow,
  mainWindow,
  PeerDropWindow,
  windowsIpcHanders,
  zimaBackupWindow,
}
