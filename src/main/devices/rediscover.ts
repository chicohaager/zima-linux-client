import type { Device, DeviceAddress } from '@shared/domain'
import { isErr } from '@shared/result'
import { discover } from '@main/discovery/mdns'
import { fetchIdentity, sameDevice } from '@main/zima/identity'
import { logger } from '@main/logging/logger'
import * as registry from './registry'

/**
 * Teaches a stored device the ways to reach it that it did not know about.
 *
 * The gap this closes: how a device was **first** found became a permanent property of it.
 * a device entry held exactly one path — `Tailscale 198.51.100.10:80`, because that is how
 * it was added — while the very same box sat in the same LAN under `192.0.2.10`. On
 * 2026-08-10 that Tailscale path answered 3 of 16 requests while the LAN address answered
 * 16 of 16 in 2–6 ms, and the client had no way to notice: an address list of one dead
 * entry stays a list of one dead entry, however carefully it is probed.
 *
 * A connection path is a measurement, not a contract. So discovery runs again, and anything
 * that proves to be this device is added.
 *
 * 🔴 What proves it is `device_code`, parsed and compared — never an HTTP status. A foreign
 * service on the same host answers `/v2/zimaos/device/info` with **HTTP 200 and HTML**
 * (measured: Dozzle on port 8888). See `zima/identity.ts` for the whole measurement.
 *
 * Fails closed in every direction: no code stored, no code answered, codes differ, discovery
 * finds nothing — each of those adds no address. The cost of a miss is the status quo; the
 * cost of a wrong match would be a session pointed at somebody else's machine.
 */

export interface DiscoveredCandidate {
  readonly host: string
  readonly port: number
  readonly deviceCode: string
  readonly deviceName: string | null
}

export interface RediscoverOutcome {
  /** Addresses added to the device because their `device_code` matched. */
  readonly learned: readonly DeviceAddress[]
  /**
   * ZimaOS devices found in the LAN that could NOT be matched — because this device has no
   * stored code yet (every entry written before today) or the codes differ.
   *
   * Handed back rather than swallowed: for a device with no stored code this is exactly the
   * situation the user can resolve in one click, and guessing on their behalf is the one
   * thing that must not happen here.
   */
  readonly candidates: readonly DiscoveredCandidate[]
}

const EMPTY: RediscoverOutcome = { learned: [], candidates: [] }

/**
 * `timeoutMs` covers the mDNS listen window; each identity request has its own short
 * budget on top. Kept small because this runs while a user waits for a window to appear.
 */
export const learnAddressesFor = async (
  device: Device,
  timeoutMs = 2_000,
): Promise<RediscoverOutcome> => {
  const found = await discover(timeoutMs)
  if (found.length === 0) return EMPTY

  const known = new Set(device.addresses.map((a) => `${a.host}:${a.port}`))

  const learned: DeviceAddress[] = []
  const candidates: DiscoveredCandidate[] = []

  // Asked in parallel: these are LAN hosts, and a serial walk would add its timeouts up
  // while the user watches a spinner.
  const identities = await Promise.all(
    found.map(async (hit) => ({ hit, identity: await fetchIdentity(hit.host, hit.port) })),
  )

  for (const { hit, identity } of identities) {
    if (isErr(identity)) continue // not a ZimaOS device, or did not answer — nothing to add

    if (!sameDevice(device.deviceCode, identity.value.deviceCode)) {
      candidates.push({
        host: hit.host,
        port: hit.port,
        deviceCode: identity.value.deviceCode,
        deviceName: identity.value.deviceName,
      })
      continue
    }

    if (known.has(`${hit.host}:${hit.port}`)) continue

    const address: DeviceAddress = {
      kind: 'lan',
      host: hit.host,
      port: hit.port,
      // Behind the paths the user set up deliberately; the probe decides the actual order
      // by measured latency anyway, so this only breaks ties.
      priority: device.addresses.length + learned.length,
    }
    const stored = registry.addAddress(device.id, address)
    if (isErr(stored)) {
      logger.warn('devices.address-not-learned', { deviceId: device.id, kind: stored.error.kind })
      continue
    }
    learned.push(address)
    logger.info('devices.address-learned', {
      deviceId: device.id,
      host: address.host,
      port: address.port,
    })
  }

  return { learned, candidates }
}
