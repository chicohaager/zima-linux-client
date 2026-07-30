import { app, ipcMain } from 'electron'
import { CHANNELS, channelSchemas, type ChannelName } from '@shared/contract'
import { appError, isErr, type AppError, type Result } from '@shared/result'
import { discover } from '@main/discovery/mdns'
import { probe } from '@main/transport/probe'
import { fetchRoutes } from '@main/zima/client'
import { deriveCapabilities, parseRoutes } from '@main/zima/capabilities'
import { readStatus } from '@main/secrets/store'
import { setPlaintextConsent } from '@main/secrets/credentials'
import * as session from '@main/session'
import * as registry from '@main/devices/registry'
import { logger } from '@main/logging/logger'

/**
 * The IPC boundary. Thin on purpose: validate, delegate, serialise.
 *
 * Every handler returns the envelope from the contract, so a failure crossing the
 * boundary keeps its kind, its i18n key and its context. Nothing is turned into an
 * empty array on the way out.
 */

const toWire = <T>(result: Result<T>): { ok: true; value: T } | { ok: false; error: AppError } =>
  isErr(result)
    ? { ok: false, error: { ...result.error, cause: undefined } as AppError }
    : { ok: true, value: result.value }

/** Wraps a handler so a validation failure or a throw is reported, never swallowed. */
const handle = <C extends ChannelName>(
  channel: C,
  run: (input: unknown) => Promise<{ ok: boolean } & Record<string, unknown>>,
): void => {
  ipcMain.handle(channel, async (_event, rawInput: unknown) => {
    const parsed = channelSchemas[channel].request.safeParse(rawInput ?? {})
    if (!parsed.success) {
      logger.error('ipc.invalid-request', { channel, issues: parsed.error.issues })
      return toWire(
        {
          ok: false,
          error: appError('internal', `invalid request for ${channel}`, 'error.internal', {
            channel,
          }),
        } as Result<never>,
      )
    }
    try {
      return await run(parsed.data)
    } catch (cause) {
      logger.error('ipc.handler-threw', { channel, cause: String(cause) })
      return toWire({
        ok: false,
        error: appError('internal', `handler failed for ${channel}`, 'error.internal', {
          channel,
        }),
      } as Result<never>)
    }
  })
}

export const registerIpc = (): void => {
  handle(CHANNELS.discoveryScan, async (input) => {
    const { timeoutMs } = input as { timeoutMs: number }
    const devices = await discover(timeoutMs)
    logger.info('discovery.scan', { found: devices.length, timeoutMs })
    return { ok: true, value: devices }
  })

  handle(CHANNELS.transportProbe, async (input) => {
    const { host, port } = input as { host: string; port: number }
    return { ok: true, value: await probe(host, port) }
  })

  handle(CHANNELS.deviceCapabilities, async (input) => {
    const { host, port } = input as { host: string; port: number }
    const routes = await fetchRoutes(host, port)
    if (isErr(routes)) return toWire(routes)

    const paths = parseRoutes(routes.value)
    if (paths === null) {
      // An unreadable route table is an error. Returning an empty capability set
      // would silently disable every feature and read as "this device can do nothing".
      return toWire({
        ok: false,
        error: appError(
          'malformed-response',
          'gateway route table not understood',
          'error.malformedResponse',
          { host },
        ),
      } as Result<never>)
    }
    return { ok: true, value: deriveCapabilities(paths) }
  })

  handle(CHANNELS.secretsStatus, async () => {
    const status = readStatus()
    if (status.plaintextRisk) {
      logger.warn('secrets.plaintext-risk', { backend: status.backend })
    }
    return { ok: true, value: status }
  })

  handle(CHANNELS.secretsConsent, async (input) => {
    const { granted } = input as { granted: boolean }
    setPlaintextConsent(granted)
    return { ok: true, value: readStatus() }
  })

  handle(CHANNELS.sessionSignIn, async (input) =>
    toWire(
      await session.signIn(
        input as {
          host: string
          port: number
          kind: 'lan' | 'direct' | 'remote-id'
          username: string
          password: string
          displayName?: string
        },
      ),
    ),
  )

  handle(CHANNELS.sessionResume, async (input) =>
    toWire(await session.resume((input as { deviceId: string }).deviceId)),
  )

  handle(CHANNELS.sessionCurrent, async () => toWire(session.current()))

  handle(CHANNELS.sessionSignOut, async () => {
    session.signOut()
    return { ok: true, value: { signedOut: true as const } }
  })

  handle(CHANNELS.devicesList, async () => ({
    ok: true,
    value: { devices: registry.list(), activeDeviceId: registry.activeDeviceId() },
  }))

  handle(CHANNELS.devicesSetActive, async (input) =>
    toWire(registry.setActive((input as { deviceId: string }).deviceId)),
  )

  handle(CHANNELS.devicesSetPriorities, async (input) => {
    const { deviceId, orderedAddressKeys } = input as {
      deviceId: string
      orderedAddressKeys: string[]
    }
    return toWire(registry.setAddressPriorities(deviceId, orderedAddressKeys))
  })

  handle(CHANNELS.devicesForget, async (input) => {
    const { deviceId } = input as { deviceId: string }
    const result = session.forgetDevice(deviceId)
    return isErr(result) ? toWire(result) : { ok: true, value: { forgotten: true as const } }
  })

  handle(CHANNELS.appInfo, async () => ({
    ok: true,
    value: {
      version: app.getVersion(),
      electron: process.versions.electron ?? 'unknown',
      platform: `${process.platform}-${process.arch}`,
      locale: app.getLocale(),
    },
  }))
}
