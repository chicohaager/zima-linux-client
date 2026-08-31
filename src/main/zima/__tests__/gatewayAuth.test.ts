import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isErr } from '@shared/result'

/*
 * `GET /v1/gateway/routes` requires a bearer token since ZimaOS v1.7.1-beta1, and the
 * liveness endpoint does not. These tests pin both halves at the HTTP level — the layer
 * where the difference actually lives — because pinning it only in `probe.ts` would leave
 * the next caller free to make the same mistake.
 *
 * Measured 2026-08-31 from the device against its own four addresses:
 *
 *     /v1/gateway/routes   127.0.0.1 -> 200   LAN/ZeroTier/Tailscale -> 401
 *     /v1/users/status     all four            -> 200
 *
 * and with a valid token the route table returned 200 / 2195 bytes, with a deliberately
 * invalid one 401 — so it is authentication, not a source-address filter.
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

const answered = (payload: unknown): Response =>
  ({ ok: true, status: 200, text: async () => JSON.stringify(payload) }) as Response

// `calls[0]` is optional to TypeScript (noUncheckedIndexedAccess), and an absent call must
// not silently become "no headers" — that would let a test pass because nothing was sent.
const headersOf = (call: unknown[] | undefined): Record<string, string> => {
  if (call === undefined) throw new Error('fetch was never called')
  return (call[1] as { headers?: Record<string, string> } | undefined)?.headers ?? {}
}

describe('which gateway calls carry a token', () => {
  it('sends the bearer token when reading the route table', async () => {
    const { fetchRoutes } = await import('../client')
    fetchMock.mockResolvedValue(answered({ data: [{ path: '/v2/photos' }] }))

    await fetchRoutes('device.local', 80, 'a-token')

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('/v1/gateway/routes')
    /*
     * The BARE token under the lowercase key — the convention `client.ts` measured on
     * v1.7.0 and this file re-measured on v1.7.1-beta1 for THIS endpoint: bare, `Bearer …`
     * and `bearer …` all returned 200 / 2195 bytes, only a missing header returned 401.
     * Pinned to the bare form because that is what the client actually sends; the other two
     * being accepted today is not a promise about tomorrow.
     */
    expect(headersOf(fetchMock.mock.calls[0])['authorization']).toBe('a-token')
  })

  it('sends NO Authorization header on the liveness probe', async () => {
    /*
     * The counter-control, and it is the important one. A probe runs before the login, so a
     * header here could only ever be a stale token — and a request that authenticates is a
     * request that can be refused, which is precisely the failure being fixed.
     */
    const { fetchLiveness } = await import('../client')
    fetchMock.mockResolvedValue(answered({ data: { initialized: true } }))

    await fetchLiveness('device.local', 80)

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('/v1/users/status')
    expect(headersOf(fetchMock.mock.calls[0])['authorization']).toBeUndefined()
  })

  it('surfaces the 401 as unauthorized when the route table is read without a token', async () => {
    // The state the field was in: measured body and status of the real refusal.
    const { fetchRoutes } = await import('../client')
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ message: 'Unauthorized' }),
    } as Response)

    const result = await fetchRoutes('device.local', 80)

    expect(isErr(result)).toBe(true)
    if (!isErr(result)) return
    expect(result.error.kind).toBe('unauthorized')
  })
})
