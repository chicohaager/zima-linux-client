import { describe, expect, it } from 'vitest'
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

describe('unwrap', () => {
  it('returns data for an envelope and the body itself otherwise', () => {
    expect(unwrap(STATUS_OK)).toEqual(STATUS_OK.data)
    const routes = [{ path: '/v1/users' }]
    expect(unwrap(routes)).toBe(routes)
  })
})
