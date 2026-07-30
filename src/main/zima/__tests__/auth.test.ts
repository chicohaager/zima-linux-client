import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isErr, isOk } from '@shared/result'

/**
 * Covers the two behaviours that are easy to get wrong and expensive when wrong:
 * the login response shape, and renewal being single-flight.
 *
 * ZimaOS rotates the refresh token on renewal, so two concurrent renewals would race and
 * one of them would end up holding a token the server has already replaced.
 */

const b64 = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url')
const token = (payload: object): string => `${b64({ alg: 'ES256' })}.${b64(payload)}.sig`

const NOW = 1_800_000_000_000
const sec = (ms: number): number => Math.floor(ms / 1000)

const makeTokens = (accessOffsetMs: number, suffix = '') => ({
  access_token: token({
    username: 'owner',
    role: 'admin',
    iss: 'casaos',
    iat: sec(NOW),
    exp: sec(NOW + accessOffsetMs),
  }),
  refresh_token: token({
    username: 'owner',
    role: 'admin',
    iss: 'refresh',
    iat: sec(NOW),
    exp: sec(NOW + 7 * 86_400_000),
  }) + suffix,
})

const envelope = (data: unknown) => ({ success: 200, message: 'ok', data })

/**
 * The two endpoints answer in DIFFERENT shapes, both measured live on 2026-07-30:
 *
 *   POST /v1/users/login    -> data.token.{access_token,refresh_token}   (nested)
 *   POST /v1/users/refresh  -> data.{access_token,refresh_token,...}     (flat)
 *
 * Until then this file mocked renewal with the *login* shape. That is why 63 green tests
 * coexisted with renewal being broken in production: the fixture had flattened the very
 * difference the code got wrong, so the bug could not occur in the test world. The helpers
 * below keep the two shapes apart on purpose — using the wrong one now goes red.
 */
const loginBody = (accessOffsetMs: number, suffix = '') =>
  envelope({ token: makeTokens(accessOffsetMs, suffix) })
const refreshBody = (accessOffsetMs: number, suffix = '') =>
  envelope({ ...makeTokens(accessOffsetMs, suffix), expires_at: sec(NOW + accessOffsetMs) })

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }) as Response

describe('login', () => {
  it('reads data.token.access_token / refresh_token and pins the issuers', async () => {
    const { login } = await import('../auth')
    fetchMock.mockResolvedValue(jsonResponse(envelope({ token: makeTokens(3 * 3_600_000) })))

    const result = await login('device.local', 80, 'owner', 'secret')
    expect(isOk(result)).toBe(true)
    if (!isOk(result)) return
    expect(result.value.access.kind).toBe('access')
    expect(result.value.refresh.kind).toBe('refresh')
  })

  // Measured contract: a wrong password is HTTP 400 with application code 10013.
  it('reports a wrong password as invalid-credentials, not as a rejected path', async () => {
    const { login } = await import('../auth')
    fetchMock.mockResolvedValue(
      jsonResponse(
        { success: 10013, message: 'User does not exist or password is invalid', data: null },
        400,
      ),
    )

    const result = await login('device.local', 80, 'owner', 'wrong')
    expect(isErr(result) && result.error.kind).toBe('invalid-credentials')
  })

  // A shape we do not understand must be an error. An empty session would read as
  // "not signed in" and hide a protocol change.
  it('fails loudly when the token pair is missing', async () => {
    const { login } = await import('../auth')
    fetchMock.mockResolvedValue(jsonResponse(envelope({ token: {} })))

    const result = await login('device.local', 80, 'owner', 'secret')
    expect(isErr(result) && result.error.kind).toBe('malformed-response')
  })

  it('refuses a server that returns two access tokens', async () => {
    const { login } = await import('../auth')
    const pair = makeTokens(3_600_000)
    fetchMock.mockResolvedValue(
      jsonResponse(envelope({ token: { ...pair, refresh_token: pair.access_token } })),
    )

    const result = await login('device.local', 80, 'owner', 'secret')
    expect(isErr(result) && result.error.message).toContain('expected a refresh token')
  })
})

describe('refresh — its own response shape', () => {
  it('reads the two tokens FLAT under data, the way the device really answers', async () => {
    const { refresh } = await import('../auth')
    fetchMock.mockResolvedValue(jsonResponse(refreshBody(3 * 3_600_000)))

    const result = await refresh('device.local', 80, 'stored-refresh-token')
    expect(isOk(result)).toBe(true)
    if (!isOk(result)) return
    expect(result.value.access.kind).toBe('access')
    expect(result.value.refresh.kind).toBe('refresh')
  })

  // Positivkontrolle für den behobenen Fehler: genau diese Form hat der Code vorher
  // erwartet. Sie darf jetzt NICHT mehr durchgehen — sonst prüft der Test oben nichts,
  // weil ein Parser, der beide Formen frisst, den Unterschied gar nicht bemerkt.
  it('rejects the login shape — nested tokens are not what refresh returns', async () => {
    const { refresh } = await import('../auth')
    fetchMock.mockResolvedValue(jsonResponse(loginBody(3 * 3_600_000)))

    const result = await refresh('device.local', 80, 'stored-refresh-token')
    expect(isErr(result) && result.error.kind).toBe('malformed-response')
  })

  it('names the endpoint in the error, so a shape change is traceable', async () => {
    const { refresh } = await import('../auth')
    fetchMock.mockResolvedValue(jsonResponse(envelope({ expires_at: 1 })))

    const result = await refresh('device.local', 80, 'stored-refresh-token')
    expect(isErr(result) && result.error.message).toContain('refresh')
  })
})

describe('TokenHolder', () => {
  it('returns the current token untouched while it is still fresh', async () => {
    const { TokenHolder, login } = await import('../auth')
    fetchMock.mockResolvedValue(jsonResponse(envelope({ token: makeTokens(3 * 3_600_000) })))
    const tokens = await login('device.local', 80, 'owner', 'secret')
    expect(isOk(tokens)).toBe(true)
    if (!isOk(tokens)) return

    const holder = new TokenHolder('device.local', 80, () => NOW)
    holder.adopt(tokens.value)
    fetchMock.mockClear()

    const access = await holder.accessToken()
    expect(isOk(access)).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('renews only once when several callers ask at the same time', async () => {
    const { TokenHolder, login } = await import('../auth')
    fetchMock.mockResolvedValue(jsonResponse(envelope({ token: makeTokens(60_000) })))
    const initial = await login('device.local', 80, 'owner', 'secret')
    expect(isOk(initial)).toBe(true)
    if (!isOk(initial)) return

    const holder = new TokenHolder('device.local', 80, () => NOW)
    holder.adopt(initial.value)

    // Fresh tokens for the renewal, distinguishable from the initial pair.
    fetchMock.mockClear()
    fetchMock.mockResolvedValue(jsonResponse(refreshBody(3 * 3_600_000, '2')))

    const results = await Promise.all([
      holder.accessToken(),
      holder.accessToken(),
      holder.accessToken(),
    ])

    expect(results.every(isOk)).toBe(true)
    // The point of the test: three callers, one renewal request.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('says sign-in is required instead of looping when the refresh token is expired too', async () => {
    const { TokenHolder, login } = await import('../auth')
    fetchMock.mockResolvedValue(jsonResponse(envelope({ token: makeTokens(60_000) })))
    const initial = await login('device.local', 80, 'owner', 'secret')
    if (!isOk(initial)) throw new Error('setup failed')

    // Eight days later: both halves are past their expiry.
    const holder = new TokenHolder('device.local', 80, () => NOW + 8 * 86_400_000)
    holder.adopt(initial.value)
    fetchMock.mockClear()

    const access = await holder.accessToken()
    expect(isErr(access) && access.error.i18nKey).toBe('error.sessionExpired')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(holder.current()).toBeNull()
  })

  it('drops the session when renewal itself is rejected', async () => {
    const { TokenHolder, login } = await import('../auth')
    fetchMock.mockResolvedValue(jsonResponse(envelope({ token: makeTokens(60_000) })))
    const initial = await login('device.local', 80, 'owner', 'secret')
    if (!isOk(initial)) throw new Error('setup failed')

    const holder = new TokenHolder('device.local', 80, () => NOW)
    holder.adopt(initial.value)
    fetchMock.mockResolvedValue(
      jsonResponse({ success: 20006, message: 'Verification failure', data: null }, 401),
    )

    const access = await holder.accessToken()
    expect(isErr(access)).toBe(true)
    expect(holder.current()).toBeNull()
  })
})
