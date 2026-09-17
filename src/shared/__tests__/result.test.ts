import { describe, expect, it } from 'vitest'
import { fromUnknown } from '../result'

/**
 * These map onto measured behaviour of Node's fetch, not onto guesses:
 * a refused connection arrives as `TypeError: fetch failed` with the real code one or
 * two levels down in `.cause`, and a blocked port never reaches the network at all.
 */
describe('fromUnknown', () => {
  it('finds the code nested inside a fetch failure', () => {
    const wrapped = new TypeError('fetch failed', {
      cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    })
    expect(fromUnknown(wrapped).kind).toBe('refused')
  })

  it('finds the code inside an AggregateError from a multi-address attempt', () => {
    const aggregate = new AggregateError([
      Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }),
    ])
    expect(fromUnknown(new TypeError('fetch failed', { cause: aggregate })).kind).toBe('timeout')
  })

  // The distinction that matters: refused, timeout and dns lead to three different
  // pieces of user advice. Collapsing them would hide which problem to fix.
  it.each([
    ['ECONNREFUSED', 'refused'],
    ['ETIMEDOUT', 'timeout'],
    ['EHOSTUNREACH', 'timeout'],
    ['ENOTFOUND', 'dns'],
  ] as const)('maps %s to %s', (code, expected) => {
    expect(fromUnknown(Object.assign(new Error('x'), { code })).kind).toBe(expected)
  })

  /**
   * TLS failures get their own kinds. Until 2026-09-17 every one of these fell through to
   * `internal`, which the probe then reported as 'unexpected-status' — a user whose device
   * announced port 443 read "the device answered with an unexpected status" about a device
   * that had never completed a handshake.
   *
   * The shape is the one Node really produces (measured against ZimaOS v1.7.1 with HTTPS on,
   * and against a clear-text port addressed as https://): a TypeError "fetch failed" whose
   * `cause` carries the code.
   */
  it.each([
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'tls', 'error.tls'],
    ['DEPTH_ZERO_SELF_SIGNED_CERT', 'tls', 'error.tls'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls', 'error.tls'],
    ['ERR_SSL_PACKET_LENGTH_TOO_LONG', 'not-tls', 'error.not-tls'],
    ['ERR_SSL_WRONG_VERSION_NUMBER', 'not-tls', 'error.not-tls'],
  ] as const)('maps the fetch failure carrying %s to %s', (code, kind, i18nKey) => {
    const wrapped = new TypeError('fetch failed', { cause: Object.assign(new Error('x'), { code }) })
    const mapped = fromUnknown(wrapped)
    expect(mapped.kind).toBe(kind)
    expect(mapped.i18nKey).toBe(i18nKey)
    expect(mapped.message).toContain(code)
  })

  // Positive control for the block above: an unknown code still lands in `internal`, so
  // the cases above pass because of their own branch, not because everything does.
  it('still treats an unknown code as internal', () => {
    const wrapped = new TypeError('fetch failed', { cause: Object.assign(new Error('x'), { code: 'ERR_SOMETHING_NEW' }) })
    expect(fromUnknown(wrapped).kind).toBe('internal')
  })

  // A port on the WHATWG blocked list makes fetch fail with a bare "bad port"
  // without opening a socket. Reporting that as a transport failure would blame the
  // device for our own invalid input.
  it('treats a blocked port as our bug, not as a network condition', () => {
    const badPort = new TypeError('fetch failed', { cause: new Error('bad port') })
    const mapped = fromUnknown(badPort)
    expect(mapped.kind).toBe('internal')
    expect(mapped.i18nKey).toBe('error.badPort')
  })

  it('keeps the original cause and the context for reporting', () => {
    const cause = Object.assign(new Error('nope'), { code: 'ECONNREFUSED' })
    const mapped = fromUnknown(cause, { host: 'example.local', path: '/v1/gateway/routes' })
    expect(mapped.cause).toBe(cause)
    expect(mapped.context).toEqual({ host: 'example.local', path: '/v1/gateway/routes' })
  })

  it('never returns a silent success for an unknown shape', () => {
    const mapped = fromUnknown('something odd')
    expect(mapped.kind).toBe('internal')
    expect(mapped.message).toContain('something odd')
  })
})
