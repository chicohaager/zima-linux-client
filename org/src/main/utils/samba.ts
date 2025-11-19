import { platform } from '@electron-toolkit/utils'
import { $t } from '@main/i18n'
import { clipboard, ipcMain, shell } from 'electron'
import log from 'electron-log'
import { showNotification } from './notification'

export function openSmbSharePath(options: {
  username?: string
  password?: string
  address: string
  path: string
}) {
  let smbPath
  if (platform.isMacOS) {
    let auth = ''
    if (options.username && options.password) {
      auth = `${options.username}:${options.password}@`
    }
    smbPath = `smb://${auth}${options.address}${options.path}`
  }
  else if (platform.isWindows) {
    smbPath = `\\\\${options.address}${options.path}`
  }
  else {
    throw new Error('Unsupported platform')
  }
  log.info(`Opening SMB Path: ${smbPath}`)
  shell.openExternal(smbPath)
    .catch((error) => {
      log.error('Failed to open SMB path', error)
      clipboard.writeText(smbPath)
      showNotification({
        title: $t('smbPathCopied'),
        body: smbPath,
      })
    })
}

export function registerSmbIpcHandlers() {
  ipcMain.handle('samba:openSmbSharePath', async (_event, options) => {
    openSmbSharePath(options)
  })
}
