import { describe, expect, it, vi } from 'vitest'
import { appError, err, ok } from '@shared/result'

/*
 * The regression this file exists for.
 *
 * On 2026-08-31 ZimaOS v1.7.1-beta1 began requiring a token on `GET /v1/gateway/routes`.
 * The probe called exactly that endpoint, without a token — it cannot have one, it runs
 * before the login — so every device on current firmware answered 401, the probe reported
 * 'unexpected-status', and every connection path in `session.ts` declared a healthy device
 * unreachable. Measured on the user's own machine: the ZeroTier tunnel came up and the
 * device answered in 282 ms, and the client called it dead.
 *
 * 315 tests stayed green throughout, because every fixture mocked one call and made it
 * either succeed or fail as a whole. The property that broke — liveness and route table
 * DISAGREEING — could not be expressed. So the tests below make them disagree on purpose,
 * in both directions, and each one goes red against the old implementation.
 *
 * Addresses here are RFC 5737 documentation ranges, never a real one: the privacy gate
 * checks TRACKED files, so a brand-new test file is invisible to it until it is added —
 * which is the moment a real address would slip through unseen.
 */

const liveness = vi.fn()
const routes = vi.fn()

vi.mock('@main/zima/client', () => ({
  fetchLiveness: (host: string, port?: number) => liveness(host, port),
  fetchRoutes: (host: string, port?: number, token?: string) => routes(host, port, token),
}))

const { probe } = await import('@main/transport/probe')

const unauthorized = () =>
  err(appError('unauthorized', 'HTTP 401', 'error.unauthorized', { status: 401 }))

describe('the reachability probe uses an endpoint that cannot demand a token', () => {
  it('calls the credential-free liveness endpoint, never the route table', async () => {
    liveness.mockResolvedValue(ok({ data: { initialized: true } }))
    routes.mockResolvedValue(unauthorized())

    await probe('198.51.100.10')

    expect(liveness).toHaveBeenCalledWith('198.51.100.10', 80)
    // The heart of it: asking here is what broke, so asking at all is the failure.
    expect(routes).not.toHaveBeenCalled()
  })

  it('reports a v1.7.1 device as reachable although its route table answers 401', async () => {
    liveness.mockResolvedValue(ok({ data: { initialized: true } }))
    routes.mockResolvedValue(unauthorized())

    const result = await probe('192.0.2.10')

    expect(result.reachable).toBe(true)
    expect(result.failure).toBeNull()
  })

  it('still reports a genuinely dead path as dead, and keeps the failure shape', async () => {
    // The counter-control. Without it a probe that reports EVERYTHING as reachable would
    // pass the test above — "always green" and "correct" look identical from one side.
    liveness.mockResolvedValue(err(appError('timeout', 'no answer', 'error.timeout', {})))
    routes.mockResolvedValue(ok({ data: { routes: [] } }))

    const result = await probe('192.0.2.1')

    expect(result.reachable).toBe(false)
    expect(result.failure).toBe('timeout')
  })

  it('keeps "something answered, but it is not ZimaOS" as its own outcome', async () => {
    // A foreign web server on port 80 must not become "reachable device". This is the
    // meaning 'unexpected-status' is supposed to carry — the 401 had stolen it.
    liveness.mockResolvedValue(
      err(appError('malformed-response', 'not JSON', 'error.malformedResponse', {})),
    )
    routes.mockResolvedValue(unauthorized())

    const result = await probe('192.0.2.2')

    expect(result.reachable).toBe(false)
    expect(result.failure).toBe('unexpected-status')
  })
})
