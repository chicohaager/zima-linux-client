import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isErr, isOk } from '@shared/result'

/**
 * The scheme is a fact about the device, not a property of the port number.
 *
 * 🔴 Written 2026-09-17 for a tester on client 2.0.1: his ZimaOS (v1.7.1) had "WebUI Port"
 * set to 443 with HTTPS off. The client derived `https://` from the port, spoke TLS to a
 * clear-text listener and reported "the device answered with an unexpected status". Nothing
 * here had to change for that to happen — the port is the user's choice.
 *
 * Both directions are asserted: a clear-text 443 stays HTTP, and the one signal that
 * really means "this port is TLS" — Go's `400 Client sent an HTTP request to an HTTPS
 * server.`, measured against the ZimaOS gateway — flips the pair to HTTPS exactly once.
 * The counter-check is an ordinary 400, which must not flip anything.
 *
 * Hosts are documentation names/ranges, never a real one.
 */

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

const okStatus = (): Response =>
  ({ ok: true, status: 200, text: async () => JSON.stringify({ success: 200, data: { initialized: true } }) }) as Response

const goTlsRefusal = (): Response =>
  ({ ok: false, status: 400, text: async () => 'Client sent an HTTP request to an HTTPS server.\n' }) as Response

const plainRejection = (): Response =>
  ({ ok: false, status: 400, text: async () => JSON.stringify({ message: 'invalid path' }) }) as Response

const urlOfCall = (index: number): string => String(fetchMock.mock.calls[index]?.[0])

describe('baseUrl never infers the scheme from the port', () => {
  it('addresses port 443 as plain HTTP, keeping the port in the authority', async () => {
    const { baseUrl } = await import('../client')
    expect(baseUrl('192.0.2.10', 443)).toBe('http://192.0.2.10:443')
    expect(baseUrl('192.0.2.10', 80)).toBe('http://192.0.2.10')
    expect(baseUrl('192.0.2.10', 8080)).toBe('http://192.0.2.10:8080')
  })

  it('drops only the scheme’s own default port', async () => {
    const { baseUrl } = await import('../client')
    expect(baseUrl('192.0.2.10', 443, 'https')).toBe('https://192.0.2.10')
    expect(baseUrl('192.0.2.10', 80, 'https')).toBe('https://192.0.2.10:80')
  })
})

describe('the request learns HTTPS from the device, once', () => {
  it('sends clear text to a device on port 443 and takes its 200', async () => {
    const { fetchLiveness } = await import('../client')
    fetchMock.mockResolvedValue(okStatus())

    const result = await fetchLiveness('192.0.2.10', 443)
    expect(isOk(result)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(urlOfCall(0)).toBe('http://192.0.2.10:443/v1/users/status')
  })

  it('switches to HTTPS on Go’s refusal and remembers it for the next request', async () => {
    const { fetchLiveness, schemeFor } = await import('../client')
    fetchMock.mockResolvedValueOnce(goTlsRefusal()).mockResolvedValue(okStatus())

    const first = await fetchLiveness('192.0.2.20', 8443)
    expect(isOk(first)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(urlOfCall(0)).toBe('http://192.0.2.20:8443/v1/users/status')
    expect(urlOfCall(1)).toBe('https://192.0.2.20:8443/v1/users/status')
    expect(schemeFor('192.0.2.20', 8443)).toBe('https')

    // The next request goes straight to HTTPS — no second clear-text probe.
    await fetchLiveness('192.0.2.20', 8443)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(urlOfCall(2)).toBe('https://192.0.2.20:8443/v1/users/status')
  })

  it('repeats at most once: a device that refuses clear text on HTTPS too is reported, not looped', async () => {
    const { fetchLiveness } = await import('../client')
    fetchMock.mockResolvedValue(goTlsRefusal())

    const result = await fetchLiveness('192.0.2.30', 443)
    expect(isErr(result)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  // Counter-check: an ordinary 400 is the files API's "invalid path" and must keep its
  // meaning. If this flipped the scheme, the tests above would pass for the wrong reason.
  it('does not treat an ordinary 400 as a TLS signal', async () => {
    const { fetchLiveness, schemeFor } = await import('../client')
    fetchMock.mockResolvedValue(plainRejection())

    const result = await fetchLiveness('192.0.2.40', 443)
    expect(isErr(result)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(schemeFor('192.0.2.40', 443)).toBe('http')
  })

  it('keeps the learned scheme per host and port, not per host', async () => {
    const { rememberScheme, schemeFor, forgetSchemes } = await import('../client')
    rememberScheme('192.0.2.50', 8443, 'https')
    expect(schemeFor('192.0.2.50', 8443)).toBe('https')
    expect(schemeFor('192.0.2.50', 80)).toBe('http')
    forgetSchemes()
    expect(schemeFor('192.0.2.50', 8443)).toBe('http')
  })
})

describe('a failed request is logged with its classified cause', () => {
  it('names the kind and the code, not only "fetch failed"', async () => {
    const warn = vi.fn()
    vi.doMock('@main/logging/logger', () => ({ logger: { info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() } }))
    const { fetchLiveness } = await import('../client')
    const cause = Object.assign(new Error('x'), { code: 'ERR_SSL_PACKET_LENGTH_TOO_LONG' })
    fetchMock.mockRejectedValue(new TypeError('fetch failed', { cause }))

    await fetchLiveness('192.0.2.60', 443)
    const entry = warn.mock.calls.find((call) => call[0] === 'zima.request-failed')?.[1] as Record<string, unknown>
    expect(entry).toBeDefined()
    expect(entry['kind']).toBe('not-tls')
    expect(String(entry['reason'])).toContain('ERR_SSL_PACKET_LENGTH_TOO_LONG')
    expect(String(entry['reason'])).not.toBe('fetch failed')
    vi.doUnmock('@main/logging/logger')
  })
})
