import { describe, expect, it, vi } from 'vitest'
import { appError, err } from '@shared/result'

/*
 * A TLS failure must reach the UI under its own name.
 *
 * Measured 2026-09-17 from a tester's screenshot: the device announced port 443 over mDNS,
 * the client addressed it as https://, and the tile read "The device answered with an
 * unexpected status." It had not answered — the handshake failed, and the probe folded
 * every error kind it did not know into 'unexpected-status'. The user then looked for a
 * misbehaving device instead of a port/scheme mismatch.
 *
 * Addresses are RFC 5737 documentation ranges, never a real one.
 */

const liveness = vi.fn()

vi.mock('@main/zima/client', () => ({
  fetchLiveness: (host: string, port?: number) => liveness(host, port),
  fetchRoutes: vi.fn(),
}))

const { probe } = await import('@main/transport/probe')

describe('the probe keeps TLS failures distinct', () => {
  it.each([
    ['tls', 'error.tls'],
    ['not-tls', 'error.not-tls'],
  ] as const)('reports %s as its own failure, not as unexpected-status', async (kind, key) => {
    liveness.mockResolvedValue(err(appError(kind, `simulated ${kind}`, key, {})))
    const result = await probe('192.0.2.10', 443)
    expect(result.reachable).toBe(false)
    expect(result.failure).toBe(kind)
  })

  // Positive control: a kind the probe genuinely does not distinguish still collapses, so
  // the cases above pass because of the new branch and not because nothing collapses.
  it('still folds an unrelated kind into unexpected-status', async () => {
    liveness.mockResolvedValue(err(appError('malformed-response', 'x', 'error.malformedResponse', {})))
    const result = await probe('192.0.2.10', 80)
    expect(result.failure).toBe('unexpected-status')
  })
})
