import { platform } from '@electron-toolkit/utils'
import winErrorIcon from '@resources/tray-icons/error.ico?asset&asarUnpack'
import macErrorIcon from '@resources/tray-icons/errorTemplate.png?asset&asarUnpack'
import winPausedIcon from '@resources/tray-icons/paused.ico?asset&asarUnpack'
import macPausedIcon from '@resources/tray-icons/pausedTemplate.png?asset&asarUnpack'
import winRetryIcon00 from '@resources/tray-icons/retry/00.ico?asset&asarUnpack'
import macRetryIcon00 from '@resources/tray-icons/retry/00Template.png?asset&asarUnpack'
import winRetryIcon01 from '@resources/tray-icons/retry/01.ico?asset&asarUnpack'
import macRetryIcon01 from '@resources/tray-icons/retry/01Template.png?asset&asarUnpack'
import winRetryIcon02 from '@resources/tray-icons/retry/02.ico?asset&asarUnpack'
import macRetryIcon02 from '@resources/tray-icons/retry/02Template.png?asset&asarUnpack'
import winRetryIcon03 from '@resources/tray-icons/retry/03.ico?asset&asarUnpack'
import macRetryIcon03 from '@resources/tray-icons/retry/03Template.png?asset&asarUnpack'
import winRetryIcon04 from '@resources/tray-icons/retry/04.ico?asset&asarUnpack'
import macRetryIcon04 from '@resources/tray-icons/retry/04Template.png?asset&asarUnpack'
import winRetryIcon05 from '@resources/tray-icons/retry/05.ico?asset&asarUnpack'
import macRetryIcon05 from '@resources/tray-icons/retry/05Template.png?asset&asarUnpack'
import winRetryIcon06 from '@resources/tray-icons/retry/06.ico?asset&asarUnpack'
import macRetryIcon06 from '@resources/tray-icons/retry/06Template.png?asset&asarUnpack'
import winRetryIcon07 from '@resources/tray-icons/retry/07.ico?asset&asarUnpack'
import macRetryIcon07 from '@resources/tray-icons/retry/07Template.png?asset&asarUnpack'
import winRetryIcon08 from '@resources/tray-icons/retry/08.ico?asset&asarUnpack'
import macRetryIcon08 from '@resources/tray-icons/retry/08Template.png?asset&asarUnpack'
import winRetryIcon09 from '@resources/tray-icons/retry/09.ico?asset&asarUnpack'
import macRetryIcon09 from '@resources/tray-icons/retry/09Template.png?asset&asarUnpack'
import winTransferIcon00 from '@resources/tray-icons/transfer/00.ico?asset&asarUnpack'
import macTransferIcon00 from '@resources/tray-icons/transfer/00Template.png?asset&asarUnpack'
import winTransferIcon01 from '@resources/tray-icons/transfer/01.ico?asset&asarUnpack'
import macTransferIcon01 from '@resources/tray-icons/transfer/01Template.png?asset&asarUnpack'
import winTransferIcon02 from '@resources/tray-icons/transfer/02.ico?asset&asarUnpack'
import macTransferIcon02 from '@resources/tray-icons/transfer/02Template.png?asset&asarUnpack'
import winTransferIcon03 from '@resources/tray-icons/transfer/03.ico?asset&asarUnpack'
import macTransferIcon03 from '@resources/tray-icons/transfer/03Template.png?asset&asarUnpack'
import winTransferIcon04 from '@resources/tray-icons/transfer/04.ico?asset&asarUnpack'
import macTransferIcon04 from '@resources/tray-icons/transfer/04Template.png?asset&asarUnpack'
import winTransferIcon05 from '@resources/tray-icons/transfer/05.ico?asset&asarUnpack'
import macTransferIcon05 from '@resources/tray-icons/transfer/05Template.png?asset&asarUnpack'
import winTransferIcon06 from '@resources/tray-icons/transfer/06.ico?asset&asarUnpack'
import macTransferIcon06 from '@resources/tray-icons/transfer/06Template.png?asset&asarUnpack'
import winTransferIcon07 from '@resources/tray-icons/transfer/07.ico?asset&asarUnpack'
import macTransferIcon07 from '@resources/tray-icons/transfer/07Template.png?asset&asarUnpack'
import winTransferIcon08 from '@resources/tray-icons/transfer/08.ico?asset&asarUnpack'
import macTransferIcon08 from '@resources/tray-icons/transfer/08Template.png?asset&asarUnpack'
import winTransferIcon09 from '@resources/tray-icons/transfer/09.ico?asset&asarUnpack'
import macTransferIcon09 from '@resources/tray-icons/transfer/09Template.png?asset&asarUnpack'
import winUnconfiguredIcon from '@resources/tray-icons/unconfigured.ico?asset&asarUnpack'
import macUnconfiguredIcon from '@resources/tray-icons/unconfiguredTemplate.png?asset&asarUnpack'
import winZimaIcon from '@resources/tray-icons/zima.ico?asset&asarUnpack'
import macZimaIcon from '@resources/tray-icons/zimaTemplate.png?asset&asarUnpack'
import { app, Menu, Tray } from 'electron'
import log from 'electron-log'
import { i18n } from './i18n'
import { clearIntervalTask, setIntervalTask } from './utils/timers'
import { initializationWindow, mainWindow } from './windows'

const macRetryIcons = [
  macRetryIcon00,
  macRetryIcon01,
  macRetryIcon02,
  macRetryIcon03,
  macRetryIcon04,
  macRetryIcon05,
  macRetryIcon06,
  macRetryIcon07,
  macRetryIcon08,
  macRetryIcon09,
]

const winRetryIcons = [
  winRetryIcon00,
  winRetryIcon01,
  winRetryIcon02,
  winRetryIcon03,
  winRetryIcon04,
  winRetryIcon05,
  winRetryIcon06,
  winRetryIcon07,
  winRetryIcon08,
  winRetryIcon09,
]

const macTransferIcons = [
  macTransferIcon00,
  macTransferIcon01,
  macTransferIcon02,
  macTransferIcon03,
  macTransferIcon04,
  macTransferIcon05,
  macTransferIcon06,
  macTransferIcon07,
  macTransferIcon08,
  macTransferIcon09,
]

const winTransferIcons = [
  winTransferIcon00,
  winTransferIcon01,
  winTransferIcon02,
  winTransferIcon03,
  winTransferIcon04,
  winTransferIcon05,
  winTransferIcon06,
  winTransferIcon07,
  winTransferIcon08,
  winTransferIcon09,
]

// Linux and macOS use PNG icons, Windows uses ICO
const zimaIcon = platform.isWindows ? winZimaIcon : macZimaIcon
const errorIcon = platform.isWindows ? winErrorIcon : macErrorIcon
const pausedIcon = platform.isWindows ? winPausedIcon : macPausedIcon
const unconfiguredIcon = platform.isWindows ? winUnconfiguredIcon : macUnconfiguredIcon
const retryIcons = platform.isWindows ? winRetryIcons : macRetryIcons
const transferIcons = platform.isWindows ? winTransferIcons : macTransferIcons

export class ZimaTray {
  private static _tray?: Tray

  // Icons
  private static currentTrayIconName = 'zima'
  private static dynamicIconInterval?: NodeJS.Timeout
  private static dynamicIconIndex = 0

  static stage: 'start' | 'init' | 'main' = 'start'

  private constructor() {}

  private static showWindow() {
    switch (ZimaTray.stage) {
      case 'start':
        // Do nothing
        break
      case 'init':
        initializationWindow.window.show()
        break
      case 'main':
        mainWindow.resetPosition()
        mainWindow.show()
        break
    }
  }

  static get tray() {
    return ZimaTray._tray
  }

  static getBounds() {
    if (ZimaTray._tray) {
      return ZimaTray._tray.getBounds()
    }
    return undefined
  }

  static destroy() {
    if (ZimaTray._tray) {
      if (!ZimaTray._tray.isDestroyed()) {
        ZimaTray._tray.destroy()
      }
      ZimaTray._tray = undefined
      ZimaTray.currentTrayIconName = 'zima'
      if (ZimaTray.dynamicIconInterval) {
        clearIntervalTask(ZimaTray.dynamicIconInterval)
      }
      ZimaTray.dynamicIconInterval = undefined
      ZimaTray.dynamicIconIndex = 0
    }
  }

  static init() {
    if (ZimaTray._tray) {
      return ZimaTray._tray
    }

    log.info('Initializing TrayIcon')
    ZimaTray._tray = new Tray(zimaIcon)
    ZimaTray._tray.setToolTip(app.name)
    ZimaTray._tray.on('click', ZimaTray.showWindow)
    ZimaTray._tray.on('right-click', () => {
      const { t } = i18n
      ZimaTray._tray?.popUpContextMenu(
        Menu.buildFromTemplate([
          {
            label: t('show') || 'Show',
            click: ZimaTray.showWindow,
            enabled: ZimaTray.stage !== 'start',
          },
          { type: 'separator' },
          {
            label: t('about') || 'About',
            click: () => app.showAboutPanel(),
          },
          {
            label: t('quit') || 'Quit',
            click: () => app.quit(),
          },
        ]),
      )
    })

    return ZimaTray._tray
  }

  static updateIcon(iconName?: 'zima' | 'retry' | 'transfer' | 'error' | 'paused' | 'unconfigured') {
    // Default icon
    if (!iconName) {
      iconName = 'zima'
    }

    // If the icon didn't change, do nothing
    if (iconName === ZimaTray.currentTrayIconName) {
      return
    }

    // If the tray is not initialized, do nothing
    if (!ZimaTray._tray) {
      log.warn('TrayIcon is not initialized')
      return
    }

    log.info(`Updating TrayIcon to ${iconName}`)

    if (['retry', 'transfer'].includes(iconName)) {
      // Clear the dynamic icon interval task if it exists
      if (ZimaTray.dynamicIconInterval) {
        clearIntervalTask(ZimaTray.dynamicIconInterval)
      }

      let icons: string[]
      switch (iconName) {
        case 'retry':
          icons = retryIcons
          break
        case 'transfer':
        default:
          icons = transferIcons
          break
      }

      const maxIndex = 9
      ZimaTray.dynamicIconIndex = 0
      ZimaTray.dynamicIconInterval = setIntervalTask(() => {
        ZimaTray._tray?.setImage(icons[ZimaTray.dynamicIconIndex])
        ZimaTray.dynamicIconIndex = (ZimaTray.dynamicIconIndex + 1) % maxIndex
      }, 500 / maxIndex + 1)

      ZimaTray.currentTrayIconName = iconName
    }
    else {
      // Clear the dynamic icon interval task if it exists
      if (ZimaTray.dynamicIconInterval) {
        clearIntervalTask(ZimaTray.dynamicIconInterval)
      }

      let iconPath: string
      switch (iconName) {
        case 'unconfigured':
          iconPath = unconfiguredIcon
          break
        case 'error':
          iconPath = errorIcon
          break
        case 'paused':
          iconPath = pausedIcon
          break
        case 'zima':
        default:
          iconPath = zimaIcon
          break
      }
      // Set the icon to the default zima icon
      ZimaTray._tray.setImage(iconPath)
      ZimaTray.currentTrayIconName = iconName
    }
  }
}
