import type { Device, DeviceAddress } from '@shared/domain'

/**
 * Pure device bookkeeping — no Electron, no filesystem, so it is directly testable.
 *
 * Split out of the registry on purpose: the interesting rules (which address wins, how
 * two sightings of the same box merge) deserve tests that do not need an app instance.
 */

export const addressKey = (a: DeviceAddress): string => `${a.kind}:${a.host}:${a.port}`

/** Sorted by the user's priority; equal priorities keep their original order. */
export const byPriority = (addresses: readonly DeviceAddress[]): readonly DeviceAddress[] =>
  [...addresses]
    .map((address, index) => ({ address, index }))
    .sort((a, b) =>
      a.address.priority !== b.address.priority
        ? a.address.priority - b.address.priority
        : a.index - b.index,
    )
    .map((entry) => entry.address)

/**
 * Merges the addresses of two sightings of the same device.
 *
 * The same box is commonly reachable three ways (LAN, direct IP, Remote ID). New ways
 * are added, but a priority the user has already set is never overwritten by a fresh
 * discovery — otherwise every network scan would silently undo their ordering.
 */
export const mergeAddresses = (
  existing: readonly DeviceAddress[],
  incoming: readonly DeviceAddress[],
): readonly DeviceAddress[] => {
  const merged = new Map(existing.map((a) => [addressKey(a), a]))
  for (const address of incoming) {
    const previous = merged.get(addressKey(address))
    merged.set(
      addressKey(address),
      previous === undefined ? address : { ...address, priority: previous.priority },
    )
  }
  return [...merged.values()]
}

/** Applies an explicit order (list of address keys) as new priorities. */
export const applyPriorityOrder = (
  addresses: readonly DeviceAddress[],
  orderedKeys: readonly string[],
): readonly DeviceAddress[] => {
  const rank = new Map(orderedKeys.map((key, index) => [key, index]))
  return addresses.map((address) => {
    const next = rank.get(addressKey(address))
    return next === undefined ? address : { ...address, priority: next }
  })
}

/**
 * Merges a freshly seen device into a known one.
 *
 * Never lets a fresh sighting erase what we already knew: an empty display name or a
 * missing capability set from a partial scan must not overwrite good data.
 */
export const mergeDevice = (existing: Device, incoming: Device): Device => ({
  ...existing,
  displayName: incoming.displayName || existing.displayName,
  lastSeenIso: incoming.lastSeenIso ?? existing.lastSeenIso,
  capabilities: incoming.capabilities ?? existing.capabilities,
  addresses: mergeAddresses(existing.addresses, incoming.addresses),
})
