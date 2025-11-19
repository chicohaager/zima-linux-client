import { platform } from '@electron-toolkit/utils'
import zimaIcns from '@resources/icons/zima.icns?asset&asarUnpack'
import zimaIco from '@resources/icons/zima.ico?asset&asarUnpack'
import { Notification } from 'electron'

export function showNotification({
  title,
  body,
  slient,
}: {
  title?: string
  body?: string
  slient?: boolean
}) {
  if (!Notification.isSupported())
    return

  const icon = platform.isMacOS
    ? zimaIcns
    : zimaIco

  const notification = new Notification({
    icon,
    title,
    body,
    silent: !!slient,
  })

  notification.show()
}
