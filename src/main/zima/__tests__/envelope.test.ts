import { describe, expect, it, vi } from 'vitest'
import { envelopeIsOk, envelopeToError, isEnvelope, unwrap } from '../envelope'

/**
 * Every payload below is a verbatim response measured on 2026-07-30 against a live
 * ZimaOS v1.7.0 host. They are here because HTTP 400 is overloaded on this API, and
 * mapping it by status alone produced the wrong user-facing message.
 */

const WRONG_PASSWORD = {
  success: 10013,
  message: 'User does not exist or password is invalid',
  data: null,
}
const EMPTY_BODY = { success: 400, message: 'Parameters Error', data: null }
const NO_TOKEN = {
  success: 20006,
  message: 'Verification failure',
  data: 'token contains an invalid number of segments',
}
const STATUS_OK = {
  success: 200,
  message: 'ok',
  data: { gpuCount: 1, gpus: 0, initialized: true, key: '' },
}

describe('isEnvelope', () => {
  it.each([
    ['a login failure', WRONG_PASSWORD, true],
    ['a success', STATUS_OK, true],
    // /v2 and /v2_1 do NOT use the envelope on 401 — measured.
    ['the files API 401 body', { message: 'Unauthorized' }, false],
    ['the zimaos API 401 body', { message: 'invalid or expired jwt' }, false],
    ['a bare array (gateway routes)', [{ path: '/v1/users' }], false],
    ['null', null, false],
  ])('recognises %s', (_label, body, expected) => {
    expect(isEnvelope(body)).toBe(expected)
  })
})

describe('envelopeIsOk', () => {
  it('trusts the application code, not the HTTP status', () => {
    expect(envelopeIsOk(STATUS_OK)).toBe(true)
    expect(envelopeIsOk(WRONG_PASSWORD)).toBe(false)
    expect(envelopeIsOk(EMPTY_BODY)).toBe(false)
  })
})

describe('envelopeToError', () => {
  // The bug this prevents: HTTP 400 also means "invalid path" on the files API, so a
  // status-only mapping turned "wrong password" into "the server rejects this path".
  it('maps a wrong password to invalid-credentials even though HTTP says 400', () => {
    const error = envelopeToError(WRONG_PASSWORD, 400, { host: 'device.local' })
    expect(error.kind).toBe('invalid-credentials')
    expect(error.i18nKey).toBe('error.invalidCredentials')
    expect(error.context).toMatchObject({ code: 10013, status: 400, host: 'device.local' })
  })

  it('maps a rejected body to parameters, not to invalid credentials', () => {
    expect(envelopeToError(EMPTY_BODY, 400, {}).kind).toBe('parameters')
  })

  it('maps a token verification failure to unauthorized', () => {
    expect(envelopeToError(NO_TOKEN, 401, {}).kind).toBe('unauthorized')
  })

  // An unmapped code must not be silently treated as a known one.
  it('falls back to the HTTP status for a code we have never measured', () => {
    const error = envelopeToError({ success: 99999, message: 'who knows', data: null }, 500, {})
    expect(error.kind).toBe('unexpected-status')
    expect(error.message).toContain('unmapped ZimaOS code 99999')
  })

  it('keeps the server message in the log field but exposes an i18n key to the UI', () => {
    const error = envelopeToError(WRONG_PASSWORD, 400, {})
    expect(error.message).toContain('User does not exist or password is invalid')
    expect(error.i18nKey.startsWith('error.')).toBe(true)
  })
})

/**
 * Unwrapping, per answer family.
 *
 * Written after all three v2 listings reached their parsers still wrapped ("expected
 * array, received object" on Apps, Trash and the task list) while the wire probes showed
 * a clean 200. Unwrapping had been tied to `success`, which only the v1 family carries.
 *
 * Each family gets its OWN case with the shape measured at ITS endpoint — a single
 * fixture that all of them happen to satisfy is what let this through the first time.
 * The bare-payload cases are the positive control: they must come back untouched, or the
 * unwrapper has become wide enough to eat real payloads.
 */
describe('unwrap', () => {
  it.each([
    ['v1 {success,message,data}', { success: 200, message: 'ok', data: { gpuCount: 1 } }, { gpuCount: 1 }],
    // /v2_1/files/tasks, /v2/app_management/web/appgrid — envelope without `success`
    ['v2 {data,message}', { data: [{ id: 7 }], message: 'ok' }, [{ id: 7 }]],
    // /v2_1/files/trash, /v2/app_management/installed/list — `data` alone
    ['v2 {data}', { data: [{ name: 'a' }] }, [{ name: 'a' }]],
    ['an empty envelope payload', { data: null }, null],
  ])('unwraps %s', (_label, body, expected) => {
    expect(unwrap(body)).toEqual(expected)
  })

  it.each([
    // Bare payloads measured at real endpoints. Each owns keys outside the envelope set,
    // so none of them may be unwrapped.
    ['a directory page (/v2_1/files/file)', { all: 34, content: [], depth: 1, index: 1, size: 200, total: 34 }],
    ['a gallery page (/v2/photos/gallery/stream)', { items: [], next_cursor: null, total: 1098 }],
    ['a photo search (/v2/photos/search)', { hits: [], took_ms: 3, total: 0 }],
    ['device info (/v2/zimaos/device/info)', { arch: 'amd64', device_model: 'Default string' }],
    ['zerotier info (/v2/zimaos/zt/info)', { id: 'abc', ip: '10.0.0.1', name: 'n', status: 'ONLINE' }],
    ['storage stats (/v2/local_storage/storage/stats)', { sys_disk: {}, sys_usb: {} }],
  ])('leaves %s untouched', (_label, body) => {
    expect(unwrap(body)).toBe(body)
  })

  it.each([
    ['a raw array (/v2_1/files/pin)', [{ name: 'Downloads', path: '/media' }]],
    ['a raw array (/v2/local_storage/storages)', [{ path: '/media/ZimaOS-HD' }]],
  ])('leaves %s untouched', (_label, body) => {
    expect(unwrap(body)).toBe(body)
  })

  /**
   * The narrowness of the test, stated as a test.
   *
   * A payload may legitimately own a `data` field. `'data' in body` would unwrap it and
   * hand the parser the inside of someone else's object — an allowance as wide as the
   * rule it is meant to serve.
   */
  it('does not unwrap a payload that merely has a data field', () => {
    const body = { data: [1, 2], total: 2 }
    expect(unwrap(body)).toBe(body)
  })
})

/**
 * The Authorization header format, pinned by a test because it is invisible otherwise.
 *
 * Measured 2026-07-30: ZimaOS wants the BARE JWT. `Bearer <jwt>` is answered with
 * 401 {"message":"invalid or expired jwt"} on an endpoint that actually enforces auth.
 * The client had shipped the `Bearer` form for weeks without anything noticing, because
 * no authenticated request had been made yet.
 */
describe('request — Authorization header', () => {
  it('sends the token bare, without a Bearer prefix', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: 200, message: 'ok', data: { ok: true } }),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)

    const { request } = await import('../client')
    await request('device.local', 80, '/v2/zimaos/zt/info', { token: 'the-jwt' })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['authorization']).toBe('the-jwt')
    expect(headers['authorization']).not.toContain('Bearer')

    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('sends no Authorization header at all when there is no token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: 200, message: 'ok', data: {} }),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)

    const { request } = await import('../client')
    await request('device.local', 80, '/v1/gateway/routes')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(Object.keys(init.headers as Record<string, string>)).not.toContain('authorization')

    vi.unstubAllGlobals()
    vi.resetModules()
  })
})
