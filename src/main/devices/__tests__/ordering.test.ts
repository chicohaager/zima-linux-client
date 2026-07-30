import { describe, expect, it } from 'vitest'
import type { Device, DeviceAddress } from '@shared/domain'
import { addressKey, applyPriorityOrder, byPriority, mergeAddresses, mergeDevice } from '../ordering'

const address = (
  kind: DeviceAddress['kind'],
  host: string,
  priority: number,
  port = 80,
): DeviceAddress => ({ kind, host, port, priority })

describe('byPriority', () => {
  it('sorts by priority', () => {
    const sorted = byPriority([
      address('remote-id', 'zt.example', 2),
      address('lan', '192.0.2.5', 0),
      address('direct', 'nas.local', 1),
    ])
    expect(sorted.map((a) => a.kind)).toEqual(['lan', 'direct', 'remote-id'])
  })

  // Stability matters: an unstable sort would reshuffle equal-priority addresses on
  // every render, and the connection path shown to the user would jump around.
  it('keeps the original order for equal priorities', () => {
    const sorted = byPriority([
      address('lan', 'first', 0),
      address('direct', 'second', 0),
      address('remote-id', 'third', 0),
    ])
    expect(sorted.map((a) => a.host)).toEqual(['first', 'second', 'third'])
  })

  it('does not mutate its input', () => {
    const input = [address('lan', 'b', 1), address('lan', 'a', 0)]
    byPriority(input)
    expect(input.map((a) => a.host)).toEqual(['b', 'a'])
  })
})

describe('mergeAddresses', () => {
  it('adds a newly discovered way to reach the same device', () => {
    const merged = mergeAddresses([address('direct', 'nas.local', 0)], [address('lan', '192.0.2.5', 0)])
    expect(merged).toHaveLength(2)
  })

  // The rule that protects the user's settings: a network scan must never silently
  // undo an ordering they chose by hand.
  it('keeps a user-set priority when the same address is rediscovered', () => {
    const existing = [address('lan', '192.0.2.5', 7)]
    const rediscovered = [address('lan', '192.0.2.5', 0)]
    const merged = mergeAddresses(existing, rediscovered)
    expect(merged).toHaveLength(1)
    expect(merged[0]?.priority).toBe(7)
  })

  it('treats a different port as a different address', () => {
    const merged = mergeAddresses(
      [address('direct', 'nas.local', 0, 80)],
      [address('direct', 'nas.local', 0, 8080)],
    )
    expect(merged).toHaveLength(2)
  })
})

describe('applyPriorityOrder', () => {
  it('renumbers the addresses the user reordered', () => {
    const addresses = [address('lan', 'a', 0), address('direct', 'b', 1), address('remote-id', 'c', 2)]
    const reordered = applyPriorityOrder(addresses, [
      addressKey(addresses[2] as DeviceAddress),
      addressKey(addresses[0] as DeviceAddress),
    ])
    expect(reordered.find((a) => a.host === 'c')?.priority).toBe(0)
    expect(reordered.find((a) => a.host === 'a')?.priority).toBe(1)
    // Not mentioned in the order → untouched, rather than pushed to an arbitrary slot.
    expect(reordered.find((a) => a.host === 'b')?.priority).toBe(1)
  })
})

describe('mergeDevice', () => {
  const base: Device = {
    id: 'name:ZimaOS',
    displayName: 'Wohnzimmer',
    addresses: [address('lan', '192.0.2.5', 3)],
    lastSeenIso: '2026-07-01T10:00:00.000Z',
    capabilities: null,
  }

  // A partial scan must not erase good data. This is the "silent downgrade" failure:
  // everything still looks fine, but the device has lost its name.
  it('never overwrites a known name with an empty one', () => {
    const merged = mergeDevice(base, { ...base, displayName: '' })
    expect(merged.displayName).toBe('Wohnzimmer')
  })

  it('keeps known capabilities when a fresh sighting has none', () => {
    const withCaps: Device = {
      ...base,
      capabilities: {
        photoLibrary: true,
        photoBrowse: true,
        photoBackup: true,
        files: true,
        apps: true,
        appStore: true,
        systemPower: true,
        zerotier: { kind: 'online', networkId: 'aa11bb22cc33dd44', ip: '10.147.17.9', networkName: 'net' },
        backup: true,
        routes: ['/v2/photos'],
      },
    }
    const merged = mergeDevice(withCaps, { ...base, capabilities: null })
    expect(merged.capabilities?.photoLibrary).toBe(true)
  })

  it('takes the newer lastSeen and preserves the priority the user set', () => {
    const merged = mergeDevice(base, {
      ...base,
      lastSeenIso: '2026-07-30T09:00:00.000Z',
      addresses: [address('lan', '192.0.2.5', 0)],
    })
    expect(merged.lastSeenIso).toBe('2026-07-30T09:00:00.000Z')
    expect(merged.addresses[0]?.priority).toBe(3)
  })
})
