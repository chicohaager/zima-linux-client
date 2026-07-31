import { shell } from 'electron'
import { CHANNELS } from '@shared/contract'
import { appError, isErr, ok } from '@shared/result'
import * as systemApi from '@main/zima/system'
import * as registry from '@main/devices/registry'
import * as session from '@main/session'
import { logger } from '@main/logging/logger'
import { handle, wireError, withDevice } from './wire'

/**
 * Device figures, the power actions, and opening the log folder.
 */

export const registerSystemHandlers = (): void => {
  handle(CHANNELS.systemUtilization, async () =>
    withDevice((ctx) => systemApi.readUtilization(ctx)),
  )

  handle(CHANNELS.systemDeviceInfo, async () => withDevice((ctx) => systemApi.readDeviceInfo(ctx)))

  handle(CHANNELS.systemVolumes, async () => withDevice((ctx) => systemApi.listVolumes(ctx)))

  handle(CHANNELS.devicesPower, async (input) => {
    const { deviceId, action } = input

    // The action always targets the ACTIVE device, and the renderer's device id must match
    // it. Without that check, a stale screen could restart a device the user switched away
    // from — the id in the request is treated as a claim to verify, not as a target.
    const active = registry.activeDeviceId()
    if (active !== deviceId) {
      return wireError(
        appError('internal', `power action for ${deviceId} but ${String(active)} is active`,
          'error.powerDeviceMismatch', { deviceId }),
      )
    }
    const device = registry.get(deviceId)
    if (device?.capabilities?.systemPower !== true) {
      return wireError(
        appError('capability-missing', 'device does not offer power control', 'error.capabilityMissing', {
          deviceId,
        }),
      )
    }

    // Logged BEFORE the call: if the device goes down mid-request, the log must still say
    // that this client asked for it. A log line written afterwards would be missing exactly
    // when it matters most.
    logger.warn('device.power-requested', { deviceId, action })
    return withDevice(async (ctx) => {
      const requested = await systemApi.setSystemState(ctx, action)
      if (isErr(requested)) return requested
      // The session is dropped straight away: keeping tokens for a device that is shutting
      // down produces a screen that shows a live session against a machine that is off.
      session.signOut()
      return ok({ requested: action })
    })
  })

  handle(CHANNELS.logsOpenFolder, async () => {
    const folder = logger.filePath().replace(/\/[^/]+$/, '')
    await shell.openPath(folder)
    return ok({ folder })
  })
}
