import type { Capabilities, Device, DeviceAddress } from '@shared/domain'
import { appError, err, isErr, ok, NO_PATH_ANSWERED, type Result } from '@shared/result'
import { TokenHolder, login as apiLogin, refresh as apiRefresh, type Tokens } from '@main/zima/auth'
import { fetchLiveness, fetchRoutes, request, type DeviceContext } from '@main/zima/client'
import { deriveCapabilities, parseRoutes, probeZerotier } from '@main/zima/capabilities'
import { BASE, ZT } from '@main/zima/endpoints'
import * as registry from '@main/devices/registry'
import { selectBestAddress } from '@main/transport/probe'
import { learnAddressesFor } from '@main/devices/rediscover'
import { fetchIdentity } from '@main/zima/identity'
import { joinNetwork as zerotierJoin } from '@main/zerotier/daemon'
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
 * Order matters, and the reason changed on 2026-08-31. It used to read the capability list
 * first "because it needs no credentials" — true under ZimaOS v1.7.0, false under
 * v1.7.1-beta1, where `/v1/gateway/routes` answers 401 to everything but the loopback. So
 * the two jobs that were bundled into that one call are now separate:
 *
 *   1. "is this a ZimaOS device at all?" — `fetchLiveness`, credential-free, still BEFORE
 *      the password is sent anywhere. That was the user-facing point of the old order and
 *      it is kept.
 *   2. "what can it do?" — the route table, now AFTER the login and with the token.
 *
 * Reading capabilities before the login is no longer possible, and pretending otherwise is
 * what broke every connection path at once.
 */
export const signIn = async (params: {
  readonly host: string
  readonly port: number
  readonly kind: DeviceAddress['kind']
  readonly username: string
  readonly password: string
  /*
   * `| undefined` explicitly, because this is fed straight from the validated IPC request and
   * `exactOptionalPropertyTypes` distinguishes "absent" from "present and undefined". zod
   * produces the latter for `.optional()`, so a signature that only allows "absent" cannot
   * accept its own contract's output — and the previous hand-written cast at the call site
   * papered over exactly that. The same cast also still listed three connection kinds after
   * `tailscale` became a fourth: a copied type that had quietly stopped matching.
   */
  readonly displayName?: string | undefined
  /** The Remote ID the user typed — the ZeroTier network this host lives in. */
  readonly networkId?: string | undefined
}): Promise<Result<SessionSummary>> => {
  const { host, port, kind, username, password } = params

  /*
   * A saved remote-id device is signed into the same way as any other, and the tunnel it
   * lives in may well be gone — the daemon is stopped when the window closes. Reopened here
   * as well as in `resume`, because this is the other door into the same room: without it
   * the very first request (`/v1/gateway/routes`) sits in its timeout and comes back as
   * "no answer at all — possibly a firewall", which sends the user to inspect a firewall
   * that never saw the packet.
   */
  if (kind === 'remote-id' && params.networkId !== undefined) {
    const road = await zerotierJoin(params.networkId)
    if (isErr(road)) return road
  }

  // Credential-free, so a wrong host is named as such before a password leaves this machine.
  const alive = await fetchLiveness(host, port)
  if (isErr(alive)) return alive

  const tokens = await apiLogin(host, port, username, password)
  if (isErr(tokens)) return tokens

  /*
   * Now, and only now, the capability list — it needs the token since v1.7.1-beta1.
   *
   * A failure here does NOT fail the sign-in. The credentials were accepted; refusing the
   * session over an unreadable capability list would turn "I cannot tell which modules you
   * have" into "you cannot log in", which is a far larger claim than the evidence supports.
   * An empty capability set is a named, logged state — and `registry` keeps whatever was
   * measured on an earlier sign-in rather than overwriting it with nothing.
   */
  const routes = await fetchRoutes(host, port, tokens.value.accessToken)
  const paths = isErr(routes) ? null : parseRoutes(routes.value)
  if (paths === null) {
    logger.warn('session.capabilities-unreadable', {
      host,
      reason: isErr(routes) ? routes.error.kind : 'route table not understood',
    })
  }
  // `deriveCapabilities([])` rather than a hand-written empty object: one definition of
  // what a capability set looks like, so a new capability cannot be forgotten here.
  const capabilities = deriveCapabilities(paths ?? [])

  const id = deviceIdFor(params.displayName ?? null, host)
  // The network id is remembered WITH the address, because a remote-id host only exists
  // inside that network — see DeviceAddress.networkId. Spread rather than an `undefined`
  // value: exactOptionalPropertyTypes distinguishes absent from present-but-undefined.
  const address: DeviceAddress = {
    kind,
    host,
    port,
    priority: 0,
    ...(kind === 'remote-id' && params.networkId !== undefined
      ? { networkId: params.networkId }
      : {}),
  }
  const stored = registry.upsert({
    id,
    displayName: params.displayName ?? host,
    addresses: [address],
    lastSeenIso: new Date().toISOString(),
    capabilities,
  })
  if (isErr(stored)) return stored

  // The device's own identifier, read credential-free from the same host we just signed
  // into. Stored so this box can be recognised later at an address nobody typed yet.
  const identity = await fetchIdentity(host, port)
  if (!isErr(identity)) {
    const noted = registry.setDeviceCode(id, identity.value.deviceCode)
    if (isErr(noted)) logger.warn('session.device-code-not-stored', { deviceId: id })
  } else {
    logger.info('session.device-code-unavailable', { host, kind: identity.error.kind })
  }

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

/**
 * Rebuilds the ZeroTier tunnel a stored `remote-id` address depends on.
 *
 * 🔴 Measured 2026-07-30, and it is the reason the app sat on "loading" for a long time
 * after a restart:
 *
 *   our ZeroTier unit after a restart    inactive
 *   POST /v1/users/refresh via 10.x.y.1  no answer, aborted after 10 s
 *   the same request over the LAN        401 in 3 ms
 *   ping 10.x.y.1                        3 packets, 100 % loss
 *
 * The daemon is stopped when the window closes — deliberately; this client has no
 * background mode, and leaving a network daemon running after the user closed the app
 * would be one. But nothing brought it back, so the resumed session pointed at an address
 * that had no road to it, and every request paid its full timeout before failing.
 *
 * ⚠️ I nearly reported this as "GET works over the tunnel, POST hangs" — the two
 * measurements came from before and after the restart, i.e. from two different worlds. The
 * tunnel state has to be established in the SAME breath as the request that is being
 * judged, otherwise the comparison is between two unrelated moments.
 *
 * A non-remote-id address returns immediately: LAN, direct and tailscale addresses are
 * reachable without anything of ours running.
 */
const reopenRemoteRoad = async (
  device: Device,
  address: DeviceAddress,
): Promise<Result<void>> => {
  if (address.kind !== 'remote-id') return ok(undefined)

  // The address's own record first; the device's measured ZeroTier state as the fallback
  // for entries written before the address carried it.
  // `zerotier` is 'unknown' before it has ever been probed — a string, not a state object.
  // Narrowed explicitly, because that placeholder is exactly the case where guessing a
  // network id would be worst.
  const zt = device.capabilities?.zerotier
  const measured = typeof zt === 'object' && zt !== null ? zt : null
  const networkId =
    address.networkId ??
    (measured !== null && (measured.kind === 'online' || measured.kind === 'offline')
      ? measured.networkId
      : undefined)

  if (networkId === undefined) {
    return err(
      appError(
        'capability-missing',
        `this device was reached over a Remote ID, but no network id was stored — sign in again with the Remote ID`,
        'error.remoteIdUnknown',
        { host: address.host },
      ),
    )
  }

  logger.info('session.reopening-remote-road', { host: address.host })
  const joined = await zerotierJoin(networkId)
  if (isErr(joined)) return joined
  return ok(undefined)
}

/** Restores a session from the stored refresh token — no password needed. */
/**
 * Which stored path to resume on — measured, not assumed.
 *
 * This used to be `byPriority(device.addresses)[0]`: take the first entry and drive on it,
 * whatever its state. Measured on 2026-08-10 on a machine standing in the same LAN as its
 * device: over the stored Tailscale path 3 of 16 requests succeeded, over the LAN address
 * 16 of 16 in 2–6 ms — while `tailscale status` reported `active; direct` throughout. The
 * client sat on the dead path for the whole session and blamed a firewall.
 *
 * Paths that need no tunnel are probed first, all at once, fastest answer wins. Only if
 * none of them answers is a remote-id road opened — opening one costs a ZeroTier join that
 * can take over the user's DNS, which is far too much to spend while a LAN address two
 * milliseconds away would have done.
 */
const chooseResumeAddress = async (device: Device): Promise<Result<DeviceAddress>> => {
  const ordered = registry.byPriority(device.addresses)
  if (ordered.length === 0) {
    return err(appError('internal', 'device has no addresses', 'error.internal', {
      deviceId: device.id,
    }))
  }

  const attempts: string[] = []
  const withoutRoad = ordered.filter((a) => a.kind !== 'remote-id')

  if (withoutRoad.length > 0) {
    const { best, results } = await selectBestAddress(withoutRoad)
    for (const r of results) attempts.push(`${r.host}=${r.reachable ? `${r.latencyMs}ms` : r.failure}`)
    if (best !== null) {
      logger.info('session.resume-path-chosen', { deviceId: device.id, host: best.host, attempts })
      return ok(best)
    }
  }

  /*
   * No stored path answered. Before opening a tunnel, ask the network whether this device
   * is simply standing next to us under an address nobody wrote down — which is exactly
   * how the measured failure looked: one stored Tailscale path, dead, while the same box
   * answered in 3 ms over the LAN. Recognition is by `device_code`, so a stranger in the
   * LAN cannot be adopted; see devices/rediscover.ts.
   */
  const relearned = await learnAddressesFor(device)
  if (relearned.learned.length > 0) {
    const { best, results } = await selectBestAddress(relearned.learned)
    for (const r of results) attempts.push(`${r.host}=${r.reachable ? `${r.latencyMs}ms` : r.failure}`)
    if (best !== null) {
      logger.info('session.resume-path-relearned', {
        deviceId: device.id,
        host: best.host,
        attempts,
      })
      return ok(best)
    }
  }

  // Only now is a tunnel worth its cost.
  for (const candidate of ordered.filter((a) => a.kind === 'remote-id')) {
    const road = await reopenRemoteRoad(device, candidate)
    if (isErr(road)) {
      attempts.push(`${candidate.host}=road-failed`)
      continue
    }
    const { best, results } = await selectBestAddress([candidate])
    for (const r of results) attempts.push(`${r.host}=${r.reachable ? `${r.latencyMs}ms` : r.failure}`)
    if (best !== null) {
      logger.info('session.resume-path-chosen', { deviceId: device.id, host: best.host, attempts })
      return ok(best)
    }
  }

  logger.warn('session.resume-no-path', { deviceId: device.id, attempts })
  return err(
    appError('timeout', `no stored path answered: ${attempts.join(', ')}`, NO_PATH_ANSWERED, {
      deviceId: device.id,
      paths: attempts.join(', '),
    }),
  )
}

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

  const address = await chooseResumeAddress(device)
  if (isErr(address)) return address

  const holder = new TokenHolder(address.value.host, address.value.port)
  // Adopt a tokens object that only has the refresh half, then force a renewal. This is
  // the one place where a refresh token legitimately becomes a session — and it goes
  // through the same iss-pinned path as everything else.
  const renewed = await renewFromRefreshToken(holder, address.value, stored.value)
  if (isErr(renewed)) return renewed

  active = { device, address: address.value, tokens: holder, username: renewed.value.access.username }

  /*
   * Backfill the device's identifier for entries written before it existed — the reported among
   * them. Without this a device stored earlier could never be recognised at a new address,
   * because recognition compares against a code that is null and null matches nothing.
   * Runs on the path that just answered, so it costs one short request on a live route.
   */
  if (device.deviceCode === null || device.deviceCode === undefined) {
    const identity = await fetchIdentity(address.value.host, address.value.port)
    if (!isErr(identity)) {
      const noted = registry.setDeviceCode(deviceId, identity.value.deviceCode)
      if (isErr(noted)) logger.warn('session.device-code-not-stored', { deviceId })
      else logger.info('session.device-code-backfilled', { deviceId })
    }
  }

  // Same probe as on sign-in. Without it a resumed session would show ZeroTier as
  // 'noch nicht geprüft' forever, which is a different claim from the measured one.
  await refreshZerotierState(deviceId, address.value.host, address.value.port, holder)

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

/**
 * Address plus a fresh token for the active device — what every service call needs.
 *
 * Built here rather than assembled by each caller, so a request can never mix the host of
 * one device with the token of another. That combination answers 401 and looks like an
 * expired session, which sends the user to re-enter a password that was never the problem.
 */
export const deviceContext = async (): Promise<Result<DeviceContext>> => {
  if (active === null) {
    return err(appError('unauthorized', 'no active session', 'error.signInRequired'))
  }
  const token = await active.tokens.accessToken()
  if (isErr(token)) return token
  return ok({ host: active.address.host, port: active.address.port, token: token.value })
}

/** Capabilities of the active device, for handlers that must refuse before they call. */
export const activeCapabilities = (): Capabilities | null => active?.device.capabilities ?? null

/** Host of the active device — used to build an app's web-UI address. */
export const activeHost = (): string | null => active?.address.host ?? null

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
