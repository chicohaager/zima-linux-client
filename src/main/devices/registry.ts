import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { Capabilities, Device, DeviceAddress } from '@shared/domain'
import { appError, err, ok, type Result } from '@shared/result'
import { logger } from '@main/logging/logger'
import { writePrivateJson } from '@main/storage/privateFile'
import { addressKey, applyPriorityOrder, byPriority, mergeDevice } from './ordering'

/**
 * The device registry: which devices we know, how to reach each of them, and in which
 * order to try.
 *
 * Persisted as plain JSON next to the credential store. It holds no secrets — the refresh
 * token lives in the credential store and is referenced by device id — but it does hold
 * device names and LAN addresses, which is network topology. That is nobody else's business
 * on a shared machine, so the file is 0600 like the credential store.
 */

const FILE = 'devices.json'
const filePath = (): string => join(app.getPath('userData'), FILE)

interface StoredState {
  readonly devices: readonly Device[]
  readonly activeDeviceId: string | null
}

const EMPTY: StoredState = { devices: [], activeDeviceId: null }

const isDevice = (value: unknown): value is Device =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Device).id === 'string' &&
  typeof (value as Device).displayName === 'string' &&
  Array.isArray((value as Device).addresses)

const read = (): StoredState => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath(), 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return EMPTY
    const raw = parsed as { devices?: unknown; activeDeviceId?: unknown }
    const devices = Array.isArray(raw.devices) ? raw.devices.filter(isDevice) : []
    const active = typeof raw.activeDeviceId === 'string' ? raw.activeDeviceId : null
    return {
      devices,
      // Never point at a device that is no longer in the list.
      activeDeviceId: devices.some((d) => d.id === active) ? active : null,
    }
  } catch {
    return EMPTY
  }
}

const write = (state: StoredState): Result<void> => {
  try {
    writePrivateJson(filePath(), state)
    return ok(undefined)
  } catch (cause) {
    return err(
      appError('internal', 'could not write the device registry', 'error.internal', undefined, cause),
    )
  }
}

export { byPriority, addressKey }

export const list = (): readonly Device[] => read().devices

export const activeDeviceId = (): string | null => read().activeDeviceId

export const get = (id: string): Device | null => read().devices.find((d) => d.id === id) ?? null

/**
 * Adds a device, or merges new addresses into one we already know.
 *
 * Merging matters because the same box is commonly reached three ways (LAN, direct IP,
 * Remote ID). Creating a second entry for it would split its history and its
 * credentials.
 */
export const upsert = (device: Device): Result<Device> => {
  const state = read()
  const existing = state.devices.find((d) => d.id === device.id)

  const merged: Device = existing === undefined ? device : mergeDevice(existing, device)

  const devices = [
    ...state.devices.filter((d) => d.id !== merged.id),
    merged,
  ]
  const written = write({
    devices,
    activeDeviceId: state.activeDeviceId ?? merged.id,
  })
  return written.ok ? ok(merged) : written
}

/**
 * Records the measured ZeroTier state on a device, touching nothing else.
 *
 * Deliberately not routed through `upsert`: that merges a whole device and would need a
 * complete `Capabilities` object, which the caller does not have — it has one measurement.
 * Writing a partial device through a merge is how a known name or route list gets erased.
 */
export const setZerotierState = (id: string, state: Capabilities['zerotier']): Result<Device> => {
  const current = read()
  const device = current.devices.find((d) => d.id === id)
  if (device === undefined) {
    return err(appError('internal', `unknown device ${id}`, 'error.internal', { id }))
  }
  if (device.capabilities === null) {
    return err(
      appError('internal', 'device has no capability set to update', 'error.internal', { id }),
    )
  }

  const merged: Device = {
    ...device,
    capabilities: { ...device.capabilities, zerotier: state },
  }
  const written = write({
    ...current,
    devices: current.devices.map((d) => (d.id === id ? merged : d)),
  })
  return written.ok ? ok(merged) : written
}

/**
 * Records the device's own identifier, touching nothing else.
 *
 * Same reasoning as `setZerotierState`: the caller holds one measurement, not a whole
 * device, and writing a partial device through a merge is how a known name or address list
 * gets erased.
 *
 * Deliberately overwrites an existing code rather than keeping the first one. A device that
 * starts answering with a different code IS, as far as this client can tell, a different
 * device at that address — pinning the old value would keep matching a machine that is no
 * longer there.
 */
export const setDeviceCode = (id: string, deviceCode: string): Result<Device> => {
  const state = read()
  const existing = state.devices.find((d) => d.id === id)
  if (existing === undefined) {
    return err(appError('internal', `unknown device ${id}`, 'error.internal', { deviceId: id }))
  }
  const updated: Device = { ...existing, deviceCode }
  const written = write({
    devices: [...state.devices.filter((d) => d.id !== id), updated],
    activeDeviceId: state.activeDeviceId,
  })
  return written.ok ? ok(updated) : written
}

/**
 * Adds a way to reach a device that we learned about after it was stored.
 *
 * The address list is merged, never replaced: a second path is a gain, and losing the one
 * the user typed would be a regression. An address that is already known — same kind, host
 * and port — leaves the list untouched, so repeated discovery cannot grow it without bound.
 */
export const addAddress = (id: string, address: DeviceAddress): Result<Device> => {
  const state = read()
  const existing = state.devices.find((d) => d.id === id)
  if (existing === undefined) {
    return err(appError('internal', `unknown device ${id}`, 'error.internal', { deviceId: id }))
  }
  if (existing.addresses.some((a) => addressKey(a) === addressKey(address))) {
    return ok(existing)
  }
  const updated: Device = { ...existing, addresses: [...existing.addresses, address] }
  const written = write({
    devices: [...state.devices.filter((d) => d.id !== id), updated],
    activeDeviceId: state.activeDeviceId,
  })
  return written.ok ? ok(updated) : written
}

export const setActive = (id: string): Result<Device> => {
  const state = read()
  const device = state.devices.find((d) => d.id === id)
  if (device === undefined) {
    return err(appError('internal', `unknown device ${id}`, 'error.internal', { id }))
  }
  const written = write({ ...state, activeDeviceId: id })
  logger.info('devices.switched', { id })
  return written.ok ? ok(device) : written
}

export const setAddressPriorities = (
  id: string,
  ordered: readonly string[],
): Result<Device> => {
  const state = read()
  const device = state.devices.find((d) => d.id === id)
  if (device === undefined) {
    return err(appError('internal', `unknown device ${id}`, 'error.internal', { id }))
  }

  const updated: Device = { ...device, addresses: applyPriorityOrder(device.addresses, ordered) }
  const written = write({
    devices: state.devices.map((d) => (d.id === id ? updated : d)),
    activeDeviceId: state.activeDeviceId,
  })
  return written.ok ? ok(updated) : written
}

/**
 * Removes a device from the registry.
 *
 * Credentials are NOT deleted here — the caller does that explicitly, so that "forget
 * the device" and "forget the secret" cannot silently drift apart.
 */
export const remove = (id: string): Result<void> => {
  const state = read()
  const devices = state.devices.filter((d) => d.id !== id)
  const active = state.activeDeviceId === id ? (devices[0]?.id ?? null) : state.activeDeviceId
  logger.info('devices.removed', { id, remaining: devices.length })
  return write({ devices, activeDeviceId: active })
}
