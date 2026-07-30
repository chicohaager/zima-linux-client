import { describe, expect, it } from 'vitest'
import { deriveCapabilities, parseRoutes } from '../capabilities'
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
        zerotier: true,
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
