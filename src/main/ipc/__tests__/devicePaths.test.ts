/*
 * The two channels behind the "is this your device?" card.
 *
 * They are deliberately two: `devices:find-paths` only looks and reports, `devices:add-path`
 * is the one that writes — and it only ever runs because a person pressed a button. A single
 * "find and adopt" channel would hide the dangerous half at the call site.
 *
 * The danger is concrete. Two ZimaOS devices in one LAN are ordinary, and adopting the wrong
 * one attaches a stranger's address to a device entry — the next session, with its token,
 * would go to that machine. So the tests that matter here assert what does NOT happen, and
 * that the write re-checks identity itself instead of trusting what a scan reported seconds
 * earlier (an address can change hands by DHCP in between).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (input: unknown) => Promise<unknown>>()

const learnAddressesFor = vi.fn()
const fetchIdentity = vi.fn()
const addAddress = vi.fn()
const setDeviceCode = vi.fn()
const registryGet = vi.fn()

vi.mock('electron', () => ({ app: { getVersion: () => '2.0.0', getLocale: () => 'de' } }))
vi.mock('@main/logging/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
// '../wire', not './wire' — mock specifiers resolve relative to THIS file. The wrong one
// mocks nothing, the real module runs, and the failure ("ipcMain is undefined") points at
// Electron instead of at the typo. Second time today; the rule is: mock paths are written
// from the test's location, imports from the module's.
vi.mock('../wire', () => ({
  handle: (channel: string, fn: (input: unknown) => Promise<unknown>) => {
    handlers.set(channel, fn)
  },
  toWire: (result: { ok: boolean }) => result,
  wireError: (error: unknown) => ({ ok: false, error }),
}))

vi.mock('@main/devices/rediscover', () => ({ learnAddressesFor }))
vi.mock('@main/zima/identity', () => ({ fetchIdentity }))
vi.mock('@main/devices/registry', () => ({
  get: registryGet,
  addAddress,
  setDeviceCode,
  list: vi.fn(() => []),
  activeDeviceId: vi.fn(() => null),
  setActive: vi.fn(),
  setAddressPriorities: vi.fn(),
}))

// Everything else the module registers, stubbed so importing it does not drag in the world.
vi.mock('@main/discovery/mdns', () => ({ discover: vi.fn() }))
vi.mock('@main/transport/probe', () => ({ probe: vi.fn() }))
vi.mock('@main/zima/client', () => ({ fetchRoutes: vi.fn() }))
vi.mock('@main/zima/capabilities', () => ({ deriveCapabilities: vi.fn(), parseRoutes: vi.fn() }))
vi.mock('@main/secrets/store', () => ({ readStatus: vi.fn(() => ({ plaintextRisk: false })) }))
vi.mock('@main/secrets/credentials', () => ({ setPlaintextConsent: vi.fn() }))
vi.mock('@main/session', () => ({
  signIn: vi.fn(),
  resume: vi.fn(),
  current: vi.fn(),
  signOut: vi.fn(),
  forgetDevice: vi.fn(),
}))
vi.mock('@main/cache/appsCache', () => ({ forget: vi.fn() }))
vi.mock('../filesHandlers', () => ({ registerFilesHandlers: vi.fn() }))
vi.mock('../photosHandlers', () => ({ registerPhotosHandlers: vi.fn() }))
vi.mock('../appsHandlers', () => ({ registerAppsHandlers: vi.fn() }))
vi.mock('../systemHandlers', () => ({ registerSystemHandlers: vi.fn() }))
vi.mock('../networkHandlers', () => ({ registerNetworkHandlers: vi.fn() }))

const CODE = '0f3b7c9e-1a2d-4b5c-8e6f-7a8b9c0d1e2f'

const device = {
  id: 'name:ZimaOS',
  displayName: 'ZimaOS',
  addresses: [{ kind: 'tailscale', host: '198.51.100.10', port: 80, priority: 0 }],
  lastSeenIso: null,
  capabilities: null,
  deviceCode: null,
}

describe('device path channels', () => {
  beforeEach(async () => {
    handlers.clear()
    vi.clearAllMocks()
    registryGet.mockReturnValue(device)
    const { registerIpc } = await import('../register')
    registerIpc()
  })

  it('reports candidates without storing anything', async () => {
    learnAddressesFor.mockResolvedValue({
      learned: [],
      candidates: [{ host: '192.0.2.10', port: 80, deviceCode: CODE, deviceName: 'ZimaOS' }],
    })

    const result = (await handlers.get('devices:find-paths')?.({ deviceId: device.id })) as {
      ok: boolean
      value: { candidates: readonly unknown[] }
    }

    expect(result.ok).toBe(true)
    expect(result.value.candidates).toHaveLength(1)
    // 🔴 The looking channel must never write. If it did, a scan alone would attach an
    // address, and the user's answer would be decoration.
    expect(addAddress).not.toHaveBeenCalled()
    expect(setDeviceCode).not.toHaveBeenCalled()
  })

  it('stores the address and the code when a candidate is adopted', async () => {
    fetchIdentity.mockResolvedValue({ ok: true, value: { deviceCode: CODE, deviceName: 'ZimaOS' } })
    addAddress.mockReturnValue({ ok: true, value: device })
    setDeviceCode.mockReturnValue({ ok: true, value: { ...device, deviceCode: CODE } })

    const result = (await handlers.get('devices:add-path')?.({
      deviceId: device.id,
      host: '192.0.2.10',
      port: 80,
    })) as { ok: boolean }

    expect(result.ok).toBe(true)
    expect(addAddress).toHaveBeenCalledWith(device.id, {
      kind: 'lan',
      host: '192.0.2.10',
      port: 80,
      priority: 99,
    })
    // The code goes in with the address: without it the next start would ask again, and the
    // whole point is that nobody has to answer this twice.
    expect(setDeviceCode).toHaveBeenCalledWith(device.id, CODE)
  })

  it('🔴 re-checks identity at the moment of the write, and stores nothing if it fails', async () => {
    // Between the scan and the click the address can have changed hands — DHCP, a rebooted
    // router, a different box. The write must not trust the scan's word for it.
    fetchIdentity.mockResolvedValue({
      ok: false,
      error: { kind: 'malformed-response', message: 'not a device', i18nKey: 'error.notAZimaDevice' },
    })

    const result = (await handlers.get('devices:add-path')?.({
      deviceId: device.id,
      host: '192.0.2.10',
      port: 80,
    })) as { ok: boolean }

    expect(result.ok).toBe(false)
    expect(addAddress).not.toHaveBeenCalled()
    expect(setDeviceCode).not.toHaveBeenCalled()
  })

  it('🔴 does not store a code when the address could not be stored', async () => {
    // Order matters: a device that carries a code but not the address it was measured at
    // would be "recognised" without a way to reach it.
    fetchIdentity.mockResolvedValue({ ok: true, value: { deviceCode: CODE, deviceName: null } })
    addAddress.mockReturnValue({
      ok: false,
      error: { kind: 'internal', message: 'disk full', i18nKey: 'error.internal' },
    })

    const result = (await handlers.get('devices:add-path')?.({
      deviceId: device.id,
      host: '192.0.2.10',
      port: 80,
    })) as { ok: boolean }

    expect(result.ok).toBe(false)
    expect(setDeviceCode).not.toHaveBeenCalled()
  })

  it('refuses to search for a device that is not in the registry', async () => {
    registryGet.mockReturnValue(null)

    const result = (await handlers.get('devices:find-paths')?.({ deviceId: 'name:ghost' })) as {
      ok: boolean
    }

    expect(result.ok).toBe(false)
    expect(learnAddressesFor).not.toHaveBeenCalled()
  })
})
