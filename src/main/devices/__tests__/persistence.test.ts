import { mkdtempSync, mkdirSync, statSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Device } from '@shared/domain'

/**
 * The registry holds no secrets, but it does hold device names and LAN addresses — network
 * topology, readable by every local user if the file lands at 0644/0664.
 *
 * These tests exist because the obvious fix does not work on its own: `writeFileSync(…,
 * {mode})` applies the mode only when the file is *created*. On every machine that already
 * ran an older build the file exists, keeps its old mode, and the option reports success
 * while changing nothing — a setter whose return value is not a witness.
 */

let dir: string

vi.mock('electron', () => ({
  app: { getPath: (): string => dir },
}))

// electron-log attaches to a real app; re-importing the registry per test would make it
// complain on every reset. Nothing here is asserted through the log.
vi.mock('@main/logging/logger', () => ({
  logger: { debug: (): void => {}, info: (): void => {}, warn: (): void => {}, error: (): void => {} },
}))

const device = (id: string): Device => ({
  id,
  displayName: 'ZimaCube',
  addresses: [{ kind: 'lan', host: '198.51.100.7', port: 80, priority: 0 }],
  lastSeenIso: null,
  capabilities: null,
})

const modeOf = (path: string): string => (statSync(path).mode & 0o777).toString(8)

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zima-registry-'))
  vi.resetModules()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('devices.json permissions', () => {
  it('creates the registry at 0600', async () => {
    const registry = await import('../registry')

    expect(registry.upsert(device('a')).ok).toBe(true)
    expect(modeOf(join(dir, 'devices.json'))).toBe('600')
  })

  it('tightens a registry an older build left world-readable', async () => {
    // The exact state on this machine before the fix: 0664, written by a build that passed
    // no mode at all. Without the chmod this assertion fails at 664 — the positive control
    // for the bug, not just for the feature.
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'devices.json')
    writeFileSync(path, '{"devices":[],"activeDeviceId":null}\n', { encoding: 'utf8', mode: 0o664 })
    expect(modeOf(path)).toBe('664')

    const registry = await import('../registry')
    expect(registry.upsert(device('a')).ok).toBe(true)

    expect(modeOf(path)).toBe('600')
  })

  it('keeps the stored device readable after the tightening', async () => {
    const registry = await import('../registry')
    registry.upsert(device('a'))

    // A permission change that also lost the data would pass the two tests above.
    expect(registry.list().map((d) => d.id)).toEqual(['a'])
    expect(registry.activeDeviceId()).toBe('a')
  })
})
