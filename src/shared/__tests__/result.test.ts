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
