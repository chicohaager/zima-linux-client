import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isErr } from '@shared/result'

/**
 * What an error CARRIES, not just which error it is.
 *
 * 🔴 Written 2026-08-11 for a defect that was invisible to every other test: a tester on
 * Fedora reported `The device rejects this path (HTTP 400)` with `path=/v2_1/files/file`,
 * and nothing in that sentence said which directory the device had refused — `path` is the
 * endpoint. Both remaining hypotheses (an unlistable first volume vs. the `sort=modified` /
 * `size=300` that only the Photos tab sends) needed exactly the value the message left out.
 *
 * The kind of the error was asserted elsewhere and was right. The report was still useless.
 * So these tests are about the context, and one of them is the counter-check: a query key
 * that is NOT on the diagnostic list must not leak into a string users paste into forums.
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

/** A bare 400 with no envelope — the files API's "invalid path", measured shape. */
const rejected = (): Response =>
  ({ ok: false, status: 400, text: async () => JSON.stringify({ message: 'invalid path' }) }) as Response

const ctx = { host: 'device.local', port: 80, token: 'a-token' }

describe('the context of a rejected request', () => {
  it('names the directory the device refused, not only the endpoint', async () => {
    const { listDirectory } = await import('../files')
    fetchMock.mockResolvedValue(rejected())

    const result = await listDirectory(ctx, { path: '/media/ZimaOS-HD/Pictures' })
    expect(isErr(result)).toBe(true)
    if (!isErr(result)) return

    expect(result.error.kind).toBe('forbidden-path')
    // The endpoint stays under `path`; the refused directory arrives as `target`. Two
    // meanings under one name is what made the original report undiagnosable.
    expect(result.error.context?.['path']).toBe('/v2_1/files/file')
    expect(result.error.context?.['target']).toBe('/media/ZimaOS-HD/Pictures')
  })

  it('carries the sort and page size, because the two tabs differ in exactly those', async () => {
    const { listDirectory } = await import('../files')
    fetchMock.mockResolvedValue(rejected())

    // The Photos tab's folder mode: `photosHandlers.ts` asks for this and nothing else does.
    const result = await listDirectory(ctx, {
      path: '/media/ZimaOS-HD',
      index: 1,
      size: 300,
      sort: 'modified',
      direction: 'desc',
    })
    expect(isErr(result)).toBe(true)
    if (!isErr(result)) return

    expect(result.error.context?.['sort']).toBe('modified')
    expect(result.error.context?.['direction']).toBe('desc')
    expect(result.error.context?.['size']).toBe('300')
  })

  it('leaves out every query key that is not on the diagnostic list', async () => {
    const { request } = await import('../client')
    fetchMock.mockResolvedValue(rejected())

    const result = await request('device.local', 80, '/v2_1/files/file', {
      query: { path: '/media/x', keyword: 'a-private-search-term', token: 'not-this-either' },
    })
    expect(isErr(result)).toBe(true)
    if (!isErr(result)) return

    const rendered = Object.entries(result.error.context ?? {})
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(' · ')
    expect(rendered).toContain('target=/media/x')
    // The counter-check. Without it, "the context is richer now" would also be true of a
    // version that copies the whole query into a line people paste in public.
    expect(rendered).not.toContain('a-private-search-term')
    expect(rendered).not.toContain('not-this-either')
    expect(result.error.context?.['keyword']).toBeUndefined()
  })

  it('names the file a rejected thumbnail was for', async () => {
    const { fetchBinary } = await import('../client')
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => '',
      arrayBuffer: async () => new ArrayBuffer(0),
      headers: { get: () => null },
    } as unknown as Response)

    const result = await fetchBinary(ctx, '/v2_1/files/thumbnail', { path: '/media/x/IMG_1.jpg' })
    expect(isErr(result)).toBe(true)
    if (!isErr(result)) return
    expect(result.error.context?.['target']).toBe('/media/x/IMG_1.jpg')
  })

  it('adds nothing when there is no query at all', async () => {
    const { request } = await import('../client')
    fetchMock.mockResolvedValue(rejected())

    const result = await request('device.local', 80, '/v2/zimaos/device/info')
    expect(isErr(result)).toBe(true)
    if (!isErr(result)) return
    expect(Object.keys(result.error.context ?? {}).sort()).toEqual(['host', 'method', 'path', 'status'])
  })
})
