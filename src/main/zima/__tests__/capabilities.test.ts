import { describe, expect, it } from 'vitest'
import { deriveCapabilities, parseRoutes, probeZerotier } from '../capabilities'
import { appError, err, ok } from '@shared/result'
import {
  ROUTES_WITHOUT_PHOTOS,
  ROUTES_WITH_PHOTOS,
  rawPayload,
} from './fixtures/gateway-routes'

describe('parseRoutes', () => {
  it('reads the array form the gateway actually returns', () => {
    expect(parseRoutes(rawPayload(ROUTES_WITH_PHOTOS))).toEqual(ROUTES_WITH_PHOTOS)
  })

  it('reads a wrapped {data:[...]} form too', () => {
    expect(parseRoutes({ data: rawPayload(ROUTES_WITHOUT_PHOTOS) })).toEqual(
      ROUTES_WITHOUT_PHOTOS,
    )
  })

  // An unreadable table must be an error, not an empty list: empty would disable
  // every feature and read as "this device can do nothing".
  it.each([
    ['null', null],
    ['a string', 'nope'],
    ['an empty array', []],
    ['rows without a path field', [{ target: 'http://127.0.0.1:1' }]],
  ])('returns null for %s rather than an empty capability set', (_label, input) => {
    expect(parseRoutes(input)).toBeNull()
  })
})

describe('deriveCapabilities', () => {
  it('detects the photo library only where /v2/photos is registered', () => {
    expect(deriveCapabilities(ROUTES_WITH_PHOTOS).photoLibrary).toBe(true)
    expect(deriveCapabilities(ROUTES_WITHOUT_PHOTOS).photoLibrary).toBe(false)
  })

  // Photos is a mandatory section of this client. Browsing and backup ride on the
  // files API, so they must hold on BOTH measured hosts — including the one with no
  // photos module at all. If this ever goes false, the Photos tab has silently
  // become optional again.
  it.each([
    ['host with photos module', ROUTES_WITH_PHOTOS],
    ['host without photos module', ROUTES_WITHOUT_PHOTOS],
  ])('keeps photo browsing and backup available on %s', (_label, routes) => {
    const caps = deriveCapabilities(routes)
    expect(caps.photoBrowse).toBe(true)
    expect(caps.photoBackup).toBe(true)
    expect(caps.files).toBe(true)
  })

  it('detects the shared surface on both hosts', () => {
    for (const routes of [ROUTES_WITH_PHOTOS, ROUTES_WITHOUT_PHOTOS]) {
      const caps = deriveCapabilities(routes)
      expect(caps).toMatchObject({
        files: true,
        apps: true,
        appStore: true,
        systemPower: true,
        // NOT true: both fixtures carry the /v1/zt route, and on a real host that route
        // coexists with a ZeroTier daemon that refuses on port 9993. Route presence must
        // therefore leave the state unmeasured, not claim availability.
        zerotier: 'unknown',
        backup: true,
      })
    }
  })

  // Guards the fixture itself. If someone "simplifies" the two fixtures into one,
  // this assertion goes red instead of the diversity quietly disappearing.
  it('keeps two genuinely different fixtures around', () => {
    expect(ROUTES_WITH_PHOTOS.length).toBeGreaterThan(ROUTES_WITHOUT_PHOTOS.length)
    expect(ROUTES_WITH_PHOTOS).toContain('/v2/photos')
    expect(ROUTES_WITHOUT_PHOTOS).not.toContain('/v2/photos')
  })

  it('does not match a prefix that is merely similar', () => {
    // '/v2/photos_experimental' must not count as the photos module.
    const caps = deriveCapabilities([...ROUTES_WITHOUT_PHOTOS, '/v2/photos_experimental'])
    expect(caps.photoLibrary).toBe(false)
  })
})

/**
 * `probeZerotier` — the measured replacement for the route-derived boolean.
 *
 * Every case below comes from a real answer of a v1.7.0 host on 2026-07-30, including the
 * verbatim 500 message. The point of the tri-state is that "switched off on the device",
 * "this device does not offer it" and "we could not find out" need different words in the
 * UI; collapsing them to `false` is what produced a green dot for a broken feature.
 */
describe('probeZerotier', () => {
  it('reads an online network from the real 200 payload', async () => {
    const state = await probeZerotier(async () =>
      ok({ id: 'aa11bb22cc33dd44', ip: '10.147.17.9', name: 'IceWhale-RemoteAccess', status: 'online' }),
    )
    expect(state).toEqual({
      kind: 'online',
      networkId: 'aa11bb22cc33dd44',
      ip: '10.147.17.9',
      networkName: 'IceWhale-RemoteAccess',
    })
  })

  it('calls a non-online status offline rather than guessing', async () => {
    const state = await probeZerotier(async () =>
      ok({ id: 'aa11bb22cc33dd44', ip: null, name: null, status: 'requesting_configuration' }),
    )
    expect(state.kind).toBe('offline')
  })

  // The measured failure on the other host: HTTP 500 whose body names port 9993. This is
  // the case that made route-derivation wrong, so it gets its own name in the UI.
  it('recognises a refused daemon from the 9993 message', async () => {
    const state = await probeZerotier(async () =>
      err(
        appError(
          'unexpected-status',
          'Get "http://localhost:9993/controller/network": dial tcp 127.0.0.1:9993: connect: connection refused',
          'error.unexpectedStatus',
        ),
      ),
    )
    expect(state.kind).toBe('not-running')
  })

  it('treats an endpoint the device does not have as absent', async () => {
    const state = await probeZerotier(async () =>
      err(appError('unexpected-status', 'HTTP 404', 'error.unexpectedStatus', { status: 404 })),
    )
    expect(state.kind).toBe('absent')
  })

  it('carries the reason instead of inventing one when it cannot tell', async () => {
    const state = await probeZerotier(async () =>
      err(appError('timeout', 'no answer', 'error.timeout')),
    )
    expect(state).toEqual({ kind: 'unreachable', reason: 'error.timeout' })
  })

  // A 200 with an unknown shape must never read as "online" — that would be the same
  // false green, one layer further in.
  it('refuses to call an unrecognised 200 payload online', async () => {
    const state = await probeZerotier(async () => ok({ connected: true }))
    expect(state).toEqual({ kind: 'unreachable', reason: 'error.malformedResponse' })
  })
})
