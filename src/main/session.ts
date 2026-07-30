import type { Capabilities, Device, DeviceAddress } from '@shared/domain'
import { appError, err, isErr, ok, type Result } from '@shared/result'
import { TokenHolder, login as apiLogin, refresh as apiRefresh, type Tokens } from '@main/zima/auth'
import { fetchRoutes, request } from '@main/zima/client'
import { deriveCapabilities, parseRoutes, probeZerotier } from '@main/zima/capabilities'
import { BASE, ZT } from '@main/zima/endpoints'
import * as registry from '@main/devices/registry'
import * as credentials from '@main/secrets/credentials'
import { logger } from '@main/logging/logger'

/**
 * Holds the live session for the active device and coordinates the parts that must not
 * drift apart: registry entry, tokens, credential store.
 *
 * Kept in one place because "which device am I talking to" is exactly the kind of state
 * that produces wrong answers when two modules each keep their own copy.
 */

interface ActiveSession {
  readonly device: Device
  readonly address: DeviceAddress
  readonly tokens: TokenHolder
  readonly username: string
}

let active: ActiveSession | null = null

export interface SessionSummary {
  readonly deviceId: string
  readonly displayName: string
  readonly host: string
  readonly port: number
  readonly kind: DeviceAddress['kind']
  readonly username: string
  readonly role: string
  /** Epoch ms — lets the UI show when the session will need renewing. */
  readonly accessExpiresAtMs: number
  readonly capabilities: Capabilities | null
}

const summarise = (session: ActiveSession): Result<SessionSummary> => {
  const tokens = session.tokens.current()
  if (tokens === null) {
    return err(appError('unauthorized', 'session has no tokens', 'error.unauthorized'))
  }
  return ok({
    deviceId: session.device.id,
    displayName: session.device.displayName,
    host: session.address.host,
    port: session.address.port,
    kind: session.address.kind,
    username: session.username,
    role: tokens.access.role,
    accessExpiresAtMs: tokens.access.expiresAtMs,
    capabilities: session.device.capabilities,
  })
}

/**
 * Derives a stable device id.
 *
 * Uses the mDNS instance name when we have one, otherwise the host. Deliberately NOT the
 * IP alone: a DHCP lease change would otherwise turn one device into two registry
 * entries with split credentials.
 */
export const deviceIdFor = (name: string | null, host: string): string =>
  name !== null && name.trim().length > 0 ? `name:${name.trim()}` : `host:${host}`

/**
 * Asks the device for its ZeroTier state and stores the answer on the device entry.
 *
 * Separate from `deriveCapabilities` on purpose: this one needs a token, and it is the only
 * capability where the route table lies. Measured 2026-07-30 — `/v1/zt` is present on a host
 * whose daemon refuses on port 9993, so route presence rendered a green "available" for a
 * feature that returns HTTP 500.
 *
 * Never fails the caller: an unmeasurable state is itself a state the UI can name.
 */
const refreshZerotierState = async (
  deviceId: string,
  host: string,
  port: number,
  holder: TokenHolder,
): Promise<void> => {
  const token = await holder.accessToken()
  if (isErr(token)) return

  const state = await probeZerotier(() =>
    request<unknown>(host, port, `${BASE.zimaos}${ZT.info}`, { token: token.value }),
  )
  const merged = registry.setZerotierState(deviceId, state)
  if (isErr(merged)) {
    logger.warn('session.zerotier-state-not-stored', { deviceId, kind: merged.error.kind })
    return
  }
  if (active !== null && active.device.id === deviceId) {
    active = { ...active, device: merged.value }
  }
  logger.info('session.zerotier-probed', { deviceId, state: state.kind })
}

/**
 * Signs in and adopts the device as active.
 *
 * Order matters: capabilities are read first, because they need no credentials and give
 * the user a useful error ("this is not a ZimaOS device") before a password is sent
 * anywhere.
 */
export const signIn = async (params: {
  readonly host: string
  readonly port: number
  readonly kind: DeviceAddress['kind']
  readonly username: string
  readonly password: string
  readonly displayName?: string
}): Promise<Result<SessionSummary>> => {
  const { host, port, kind, username, password } = params

  const routes = await fetchRoutes(host, port)
  if (isErr(routes)) return routes
  const paths = parseRoutes(routes.value)
  if (paths === null) {
    return err(
      appError('malformed-response', 'gateway route table not understood', 'error.notAZimaDevice', { host }),
    )
  }
  const capabilities = deriveCapabilities(paths)

  const tokens = await apiLogin(host, port, username, password)
  if (isErr(tokens)) return tokens

  const id = deviceIdFor(params.displayName ?? null, host)
  const address: DeviceAddress = { kind, host, port, priority: 0 }
  const stored = registry.upsert({
    id,
    displayName: params.displayName ?? host,
    addresses: [address],
    lastSeenIso: new Date().toISOString(),
    capabilities,
  })
  if (isErr(stored)) return stored

  const holder = new TokenHolder(host, port)
  holder.adopt(tokens.value)
  active = { device: stored.value, address, tokens: holder, username }

  // ZeroTier is the one capability the route table cannot answer: `/v1/zt` exists on hosts
  // whose daemon is not listening. So it is asked now, with the token we just got, and the
  // measured answer replaces the 'unknown' placeholder. A failure here does not fail the
  // sign-in — it becomes a named state in the UI.
  await refreshZerotierState(id, host, port, holder)

  // Persisting the refresh token can legitimately fail on a machine without a keyring.
  // That must not fail the sign-in — the session works, it just will not survive a
  // restart. The UI is told, so the user can decide.
  const saved = credentials.saveRefreshToken(id, tokens.value.refreshToken)
  if (isErr(saved)) {
    logger.warn('session.refresh-token-not-persisted', { id, kind: saved.error.kind })
  }

  logger.info('session.signed-in', {
    id,
    host,
    kind,
    role: tokens.value.access.role,
    persisted: saved.ok,
  })
  return summarise(active)
}

/** Restores a session from the stored refresh token — no password needed. */
export const resume = async (deviceId: string): Promise<Result<SessionSummary>> => {
  const device = registry.get(deviceId)
  if (device === null) {
    return err(appError('internal', `unknown device ${deviceId}`, 'error.internal', { deviceId }))
  }

  const stored = credentials.readRefreshToken(deviceId)
  if (isErr(stored)) return stored
  if (stored.value === null) {
    return err(appError('unauthorized', 'no stored session for this device', 'error.signInRequired'))
  }

  const address = registry.byPriority(device.addresses)[0]
  if (address === undefined) {
    return err(appError('internal', 'device has no addresses', 'error.internal', { deviceId }))
  }

  const holder = new TokenHolder(address.host, address.port)
  // Adopt a tokens object that only has the refresh half, then force a renewal. This is
  // the one place where a refresh token legitimately becomes a session — and it goes
  // through the same iss-pinned path as everything else.
  const renewed = await renewFromRefreshToken(holder, address, stored.value)
  if (isErr(renewed)) return renewed

  active = { device, address, tokens: holder, username: renewed.value.access.username }

  // Same probe as on sign-in. Without it a resumed session would show ZeroTier as
  // 'noch nicht geprüft' forever, which is a different claim from the measured one.
  await refreshZerotierState(deviceId, address.host, address.port, holder)

  const saved = credentials.saveRefreshToken(deviceId, renewed.value.refreshToken)
  if (isErr(saved)) logger.warn('session.refresh-token-not-persisted', { deviceId })

  return summarise(active)
}

const renewFromRefreshToken = async (
  holder: TokenHolder,
  address: DeviceAddress,
  refreshToken: string,
): Promise<Result<Tokens>> => {
  const renewed = await apiRefresh(address.host, address.port, refreshToken)
  if (isErr(renewed)) return renewed
  holder.adopt(renewed.value)
  return renewed
}

export const current = (): Result<SessionSummary> => {
  if (active === null) {
    return err(appError('unauthorized', 'no active session', 'error.signInRequired'))
  }
  return summarise(active)
}

/** A valid access token for the active device, renewed if it is about to expire. */
export const accessToken = async (): Promise<Result<string>> => {
  if (active === null) {
    return err(appError('unauthorized', 'no active session', 'error.signInRequired'))
  }
  return active.tokens.accessToken()
}

export const signOut = (): void => {
  if (active !== null) {
    logger.info('session.signed-out', { id: active.device.id })
    active.tokens.clear()
  }
  active = null
}

/**
 * Removes a device completely: registry entry AND its stored secret.
 *
 * Both steps are reported, so "removed" can never mean "the entry is gone but the
 * credential is still on disk".
 */
export const forgetDevice = (deviceId: string): Result<void> => {
  if (active?.device.id === deviceId) signOut()

  const secretForgotten = credentials.forgetRefreshToken(deviceId)
  const removed = registry.remove(deviceId)

  if (isErr(secretForgotten)) return secretForgotten
  return removed
}
