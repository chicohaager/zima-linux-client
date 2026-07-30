import { describe, expect, it } from 'vitest'
import { decodeClaims, needsRenewal, requireKind } from '../jwt'
import { isErr, isOk } from '@shared/result'

/**
 * Token shapes here mirror what ZimaOS v1.7.0 really issues: ES256, no `kid`, and the
 * issuer distinguishing an access token (`casaos`, ~3 h) from a refresh token
 * (`refresh`, ~7 days) — both signed with the same key.
 */

const b64 = (value: object): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url')

const token = (payload: object): string =>
  `${b64({ alg: 'ES256', typ: 'JWT' })}.${b64(payload)}.c2lnbmF0dXJl`

const NOW = 1_800_000_000_000
const seconds = (ms: number): number => Math.floor(ms / 1000)

const accessPayload = {
  username: 'owner',
  role: 'admin',
  id: 1,
  iss: 'casaos',
  iat: seconds(NOW),
  exp: seconds(NOW + 3 * 3_600_000),
}
const refreshPayload = { ...accessPayload, iss: 'refresh', exp: seconds(NOW + 7 * 86_400_000) }

describe('decodeClaims', () => {
  it('reads an access token and marks it as such', () => {
    const result = decodeClaims(token(accessPayload))
    expect(isOk(result)).toBe(true)
    if (!isOk(result)) return
    expect(result.value).toMatchObject({ kind: 'access', issuer: 'casaos', role: 'admin', username: 'owner' })
    expect(result.value.expiresAtMs).toBe(seconds(NOW + 3 * 3_600_000) * 1000)
  })

  it('recognises the refresh token by its issuer', () => {
    const result = decodeClaims(token(refreshPayload))
    expect(isOk(result) && result.value.kind).toBe('refresh')
  })

  // The whole reason this module exists: both token types are signed with the same key,
  // so an unknown issuer must NOT fall back to "probably an access token".
  it('refuses an unknown issuer instead of defaulting to access', () => {
    const result = decodeClaims(token({ ...accessPayload, iss: 'something-else' }))
    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.message).toContain('unknown token issuer')
  })

  it.each([
    ['too few segments', 'header.payload'],
    ['too many segments', 'a.b.c.d'],
    ['payload that is not JSON', `${b64({ alg: 'ES256' })}.bm90LWpzb24.sig`],
  ])('rejects a malformed token: %s', (_label, value) => {
    expect(isErr(decodeClaims(value))).toBe(true)
  })

  it('rejects a token without numeric exp/iat rather than assuming it is valid', () => {
    const result = decodeClaims(token({ ...accessPayload, exp: 'soon' }))
    expect(isErr(result)).toBe(true)
  })
})

describe('requireKind', () => {
  it('lets a refresh token through only where a refresh token is expected', () => {
    const refresh = decodeClaims(token(refreshPayload))
    expect(isOk(refresh)).toBe(true)
    if (!isOk(refresh)) return

    expect(isOk(requireKind(refresh.value, 'refresh'))).toBe(true)
    // This is the attack the iss pinning prevents: a long-lived refresh token being
    // accepted as a full session.
    const asSession = requireKind(refresh.value, 'access')
    expect(isErr(asSession)).toBe(true)
    if (isErr(asSession)) expect(asSession.error.context).toMatchObject({ expected: 'access', actual: 'refresh' })
  })
})

describe('needsRenewal', () => {
  const claims = { expiresAtMs: NOW + 300_000 } as Parameters<typeof needsRenewal>[0]

  it('is false while the token has more time left than the skew', () => {
    expect(needsRenewal(claims, NOW, 120_000)).toBe(false)
  })

  it('is true once the token is inside the skew window', () => {
    expect(needsRenewal(claims, NOW + 200_000, 120_000)).toBe(true)
  })

  it('is true for an already expired token', () => {
    expect(needsRenewal(claims, NOW + 400_000, 0)).toBe(true)
  })
})
