/*
 * Learning a device's other addresses — and, more importantly, refusing to learn the wrong
 * ones.
 *
 * The situation this comes from, measured 2026-08-10: a device entry holding exactly one
 * path (`Tailscale 198.51.100.10:80`, because that is how it was added) while the same box
 * stood in the same LAN at `192.0.2.10`. Over three minutes the stored path answered
 * 3 of 16 requests; the LAN address answered 16 of 16 in 2–6 ms. Probing cannot fix that —
 * a list of one dead entry stays a list of one dead entry — so the list has to grow.
 *
 * Growing it is where the danger is. Every test marked 🔴 below asserts that something does
 * NOT happen: adopting a stranger's address into a device entry would point a session, and
 * with it a token, at somebody else's machine. Those are the tests that matter; the happy
 * path is the easy half.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Device } from '@shared/domain'
import type * as IdentityModule from '@main/zima/identity'

const found: { host: string; port: number; name: string; txt: Record<string, string> }[] = []
const identities = new Map<string, string>() // host -> device_code ('' = not a ZimaOS answer)
const added: { id: string; host: string }[] = []

vi.mock('@main/discovery/mdns', () => ({
  discover: async () => found,
}))

vi.mock('@main/zima/identity', async () => {
  const actual = await vi.importActual<typeof IdentityModule>('@main/zima/identity')
  return {
    // `sameDevice` stays real — it is half the decision under test here.
    sameDevice: actual.sameDevice,
    fetchIdentity: async (host: string) => {
      const code = identities.get(host)
      return code === undefined || code === ''
        ? { ok: false as const, error: { kind: 'malformed-response', message: 'not zimaos', i18nKey: 'error.notAZimaDevice' } }
        : { ok: true as const, value: { deviceCode: code, deviceName: 'ZimaOS', osVersion: 'v1.7.0' } }
    },
  }
})

// '../registry', not './registry': mock paths resolve relative to THIS file, and the
// wrong one silently mocks nothing — the real registry then runs, needs Electron's
// userData path, and fails in a way that looks like "no address was learned".
vi.mock('../registry', () => ({
  addAddress: (id: string, address: { host: string }) => {
    added.push({ id, host: address.host })
    return { ok: true as const, value: {} }
  },
}))

vi.mock('@main/logging/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}))

const CODE = '0f3b7c9e-1a2d-4b5c-8e6f-7a8b9c0d1e2f'
const OTHER = '9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d'

const device = (deviceCode: string | null): Device => ({
  id: 'name:ZimaOS',
  displayName: 'ZimaOS',
  addresses: [{ kind: 'tailscale', host: '198.51.100.10', port: 80, priority: 0 }],
  lastSeenIso: null,
  capabilities: null,
  deviceCode,
})

describe('learnAddressesFor', () => {
  beforeEach(() => {
    found.length = 0
    added.length = 0
    identities.clear()
  })

  it('adds the LAN address of the device it recognises', async () => {
    found.push({ host: '192.0.2.10', port: 80, name: 'ZimaOS', txt: { os: 'ZimaOS' } })
    identities.set('192.0.2.10', CODE)

    const { learnAddressesFor } = await import('../rediscover')
    const outcome = await learnAddressesFor(device(CODE))

    expect(outcome.learned.map((a) => a.host)).toEqual(['192.0.2.10'])
    expect(added).toEqual([{ id: 'name:ZimaOS', host: '192.0.2.10' }])
  })

  it('🔴 does not adopt a different ZimaOS standing in the same LAN', async () => {
    found.push({ host: '192.0.2.20', port: 80, name: 'ZimaOS-2', txt: { os: 'ZimaOS' } })
    identities.set('192.0.2.20', OTHER)

    const { learnAddressesFor } = await import('../rediscover')
    const outcome = await learnAddressesFor(device(CODE))

    expect(outcome.learned).toEqual([])
    expect(added).toEqual([])
    // Handed back as a candidate: the user may resolve it, this code may not.
    expect(outcome.candidates.map((c) => c.host)).toEqual(['192.0.2.20'])
  })

  it('🔴 adopts nothing when the device has no stored code yet', async () => {
    // Every entry written before today. If "no code" matched the first ZimaOS found,
    // a fresh install next to two devices would attach the wrong one.
    found.push({ host: '192.0.2.10', port: 80, name: 'ZimaOS', txt: { os: 'ZimaOS' } })
    identities.set('192.0.2.10', CODE)

    const { learnAddressesFor } = await import('../rediscover')
    const outcome = await learnAddressesFor(device(null))

    expect(outcome.learned).toEqual([])
    expect(added).toEqual([])
    expect(outcome.candidates).toHaveLength(1)
  })

  it('🔴 ignores a host that answers but is not a ZimaOS device', async () => {
    // Dozzle answers this very request with HTTP 200 and HTML — measured on port 8888.
    found.push({ host: '192.0.2.10', port: 8888, name: 'something', txt: {} })
    identities.set('192.0.2.10', '') // parses to "not a device info document"

    const { learnAddressesFor } = await import('../rediscover')
    const outcome = await learnAddressesFor(device(CODE))

    expect(outcome.learned).toEqual([])
    expect(outcome.candidates).toEqual([])
    expect(added).toEqual([])
  })

  it('does not store an address the device already has', async () => {
    found.push({ host: '198.51.100.10', port: 80, name: 'ZimaOS', txt: { os: 'ZimaOS' } })
    identities.set('198.51.100.10', CODE)

    const { learnAddressesFor } = await import('../rediscover')
    const outcome = await learnAddressesFor(device(CODE))

    expect(outcome.learned).toEqual([])
    expect(added).toEqual([])
  })

  it('adds nothing when discovery finds nothing', async () => {
    const { learnAddressesFor } = await import('../rediscover')
    const outcome = await learnAddressesFor(device(CODE))

    expect(outcome).toEqual({ learned: [], candidates: [] })
  })
})
