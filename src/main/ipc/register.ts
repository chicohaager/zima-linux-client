import { app } from 'electron'
import { CHANNELS } from '@shared/contract'
import { appError, isErr, ok } from '@shared/result'
import { discover } from '@main/discovery/mdns'
import { probe } from '@main/transport/probe'
import { fetchRoutes } from '@main/zima/client'
import { deriveCapabilities, parseRoutes } from '@main/zima/capabilities'
import { readStatus } from '@main/secrets/store'
import { setPlaintextConsent } from '@main/secrets/credentials'
import * as session from '@main/session'
import * as registry from '@main/devices/registry'
import * as appsCache from '@main/cache/appsCache'
import { logger } from '@main/logging/logger'
import { handle, toWire, wireError } from './wire'
import { registerFilesHandlers } from './filesHandlers'
import { registerPhotosHandlers } from './photosHandlers'
import { registerAppsHandlers } from './appsHandlers'
import { registerSystemHandlers } from './systemHandlers'
import { registerNetworkHandlers } from './networkHandlers'

/**
 * Registration of every IPC channel.
 *
 * The core channels (discovery, session, devices, secrets) are handled here; each feature
 * area brings its own module. `handle` and `toWire` come from `./wire`, so validation and the
 * envelope are identical everywhere — a handler cannot opt out of them.
 */

export const registerIpc = (): void => {
  handle(CHANNELS.discoveryScan, async (input) => {
    const { timeoutMs } = input
    const devices = await discover(timeoutMs)
    logger.info('discovery.scan', { found: devices.length, timeoutMs })
    return ok(devices)
  })

  handle(CHANNELS.transportProbe, async (input) => {
    const { host, port } = input
    return ok(await probe(host, port))
  })

  handle(CHANNELS.deviceCapabilities, async (input) => {
    const { host, port } = input
    const routes = await fetchRoutes(host, port)
    if (isErr(routes)) return toWire(routes)

    const paths = parseRoutes(routes.value)
    if (paths === null) {
      // An unreadable route table is an error. Returning an empty capability set
      // would silently disable every feature and read as "this device can do nothing".
      return wireError(
        appError('malformed-response', 'gateway route table not understood',
          'error.malformedResponse', { host }),
      )
    }
    return ok(deriveCapabilities(paths))
  })

  handle(CHANNELS.secretsStatus, async () => {
    const status = readStatus()
    if (status.plaintextRisk) {
      logger.warn('secrets.plaintext-risk', { backend: status.backend })
    }
    return ok(status)
  })

  handle(CHANNELS.secretsConsent, async (input) => {
    const { granted } = input
    setPlaintextConsent(granted)
    return ok(readStatus())
  })

  handle(CHANNELS.sessionSignIn, async (input) =>
    toWire(
      // No cast: the schema is the type. This one listed seven fields by hand — the exact
      // shape that goes stale the day the sign-in request gains an eighth.
      await session.signIn(input),
    ),
  )

  handle(CHANNELS.sessionResume, async (input) =>
    toWire(await session.resume(input.deviceId)),
  )

  handle(CHANNELS.sessionCurrent, async () => toWire(session.current()))

  handle(CHANNELS.sessionSignOut, async () => {
    session.signOut()
    return ok({ signedOut: true as const })
  })

  handle(CHANNELS.devicesList, async () =>
    ok({ devices: registry.list(), activeDeviceId: registry.activeDeviceId() }),
  )

  handle(CHANNELS.devicesSetActive, async (input) =>
    toWire(registry.setActive(input.deviceId)),
  )

  handle(CHANNELS.devicesSetPriorities, async (input) => {
    const { deviceId, orderedAddressKeys } = input
    return toWire(registry.setAddressPriorities(deviceId, orderedAddressKeys))
  })

  handle(CHANNELS.devicesForget, async (input) => {
    const { deviceId } = input
    const result = session.forgetDevice(deviceId)
    if (isErr(result)) return toWire(result)
    // The cached app list goes with the device. Leaving it behind would show the apps of a
    // device the user just removed, which reads as "it is still connected".
    appsCache.forget(deviceId)
    return ok({ forgotten: true as const })
  })

  handle(CHANNELS.appInfo, async () =>
    ok({
      version: app.getVersion(),
      electron: process.versions.electron ?? 'unknown',
      platform: `${process.platform}-${process.arch}`,
      locale: app.getLocale(),
    }),
  )

  registerFilesHandlers()
  registerPhotosHandlers()
  registerAppsHandlers()
  registerSystemHandlers()
  registerNetworkHandlers()
}
