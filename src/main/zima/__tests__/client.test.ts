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

    // What was SENT: the UI's `modified` goes out as the API's `date` (see API_SORT).
    expect(result.error.context?.['sort']).toBe('date')
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

/**
 * 🔴 2026-10-15: the cause of the August reports, measured on device A (v1.8.0) and device B — the
 * validator refuses `sort=modified`; it knows date, name, size, format. Body copied verbatim.
 */
const validatorRefusal = (): Response =>
  ({
    ok: false,
    status: 400,
    text: async () =>
      JSON.stringify({
        message:
          'parameter "sort" in query has an error: value is not one of the allowed values ["date","name","size","format"]',
      }),
  }) as Response

describe('the sort field on the wire', () => {
  it('sends the API name `date` for the UI field `modified`', async () => {
    const { listDirectory } = await import('../files')
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ content: [], total: 0, index: 1, size: 40 }),
    } as Response)

    await listDirectory(ctx, { path: '/DATA', sort: 'modified', direction: 'desc' })
    const sent = new URL(String(fetchMock.mock.calls[0]?.[0]))
    expect(sent.searchParams.get('sort')).toBe('date')
  })

  it('passes name and size through unchanged', async () => {
    const { listDirectory } = await import('../files')
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ content: [], total: 0, index: 1, size: 40 }),
    } as Response)

    await listDirectory(ctx, { path: '/DATA', sort: 'name' })
    await listDirectory(ctx, { path: '/DATA', sort: 'size' })
    const sorts = fetchMock.mock.calls.map((call) => new URL(String(call[0])).searchParams.get('sort'))
    expect(sorts).toEqual(['name', 'size'])
  })
})

describe('a 400 from the request validator', () => {
  it('names the refused parameter instead of blaming the path', async () => {
    const { request } = await import('../client')
    fetchMock.mockResolvedValue(validatorRefusal())

    const result = await request('device.local', 80, '/v2_1/files/file', { query: { path: '/DATA' } })
    expect(isErr(result)).toBe(true)
    if (!isErr(result)) return
    expect(result.error.kind).toBe('parameters')
    expect(result.error.message).toContain('parameter "sort"')
    expect(result.error.kind).not.toBe('forbidden-path')
  })

  it('still reports a bare "invalid path" 400 as a refused path — the counter-case', async () => {
    const { request } = await import('../client')
    fetchMock.mockResolvedValue(rejected())

    const result = await request('device.local', 80, '/v2_1/files/file', { query: { path: '/x' } })
    expect(isErr(result)).toBe(true)
    if (!isErr(result)) return
    expect(result.error.kind).toBe('forbidden-path')
  })
})

/**
 * 🔴 `total` vs `all`, measured 2026-10-15 on device A (v1.8.0), folder of 107, pages of 40:
 * index=1 → total=40 all=107, index=3 → total=27 all=107. `total` is the page, `all` the folder.
 */
const listingPage = (names: readonly string[], all: number, index: number, size: number): Response =>
  ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        content: names.map((name) => ({
          name,
          path: `/DATA/d/${name}`,
          is_dir: false,
          size: 1,
          modified: 0,
        })),
        total: names.length,
        all,
        index,
        size,
        depth: 1,
      }),
  }) as Response

const names = (from: number, count: number): string[] =>
  Array.from({ length: count }, (_, i) => `f${from + i}.jpg`)

describe('the size of a directory', () => {
  it('reports `all` as the directory total, not the page length in `total`', async () => {
    const { listDirectory } = await import('../files')
    fetchMock.mockResolvedValue(listingPage(names(0, 40), 107, 1, 40))
    const result = await listDirectory(ctx, { path: '/DATA/d', index: 1, size: 40 })
    expect(isErr(result)).toBe(false)
    if (isErr(result)) return
    expect(result.value.total).toBe(107)
    expect(result.value.entries).toHaveLength(40)
  })

  it('listEveryEntry walks every page until `all` is reached', async () => {
    const { listEveryEntry } = await import('../files')
    fetchMock
      .mockResolvedValueOnce(listingPage(names(0, 40), 107, 1, 40))
      .mockResolvedValueOnce(listingPage(names(40, 40), 107, 2, 40))
      .mockResolvedValueOnce(listingPage(names(80, 27), 107, 3, 40))
    const result = await listEveryEntry(ctx, { path: '/DATA/d', pageSize: 40 })
    expect(isErr(result)).toBe(false)
    if (isErr(result)) return
    expect(result.value.entries).toHaveLength(107)
    expect(new Set(result.value.entries.map((e) => e.name)).size).toBe(107)
    expect(result.value.truncated).toBe(false)
    const indices = fetchMock.mock.calls.map((call) => new URL(String(call[0])).searchParams.get('index'))
    expect(indices).toEqual(['1', '2', '3'])
  })

  it('stops on an empty page even if `all` claims more — no endless walk', async () => {
    const { listEveryEntry } = await import('../files')
    fetchMock
      .mockResolvedValueOnce(listingPage(names(0, 40), 107, 1, 40))
      .mockResolvedValueOnce(listingPage([], 107, 2, 40))
    const result = await listEveryEntry(ctx, { path: '/DATA/d', pageSize: 40 })
    expect(isErr(result)).toBe(false)
    if (isErr(result)) return
    expect(result.value.entries).toHaveLength(40)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('says truncated when `max` stops the walk', async () => {
    const { listEveryEntry } = await import('../files')
    fetchMock.mockResolvedValueOnce(listingPage(names(0, 40), 107, 1, 40))
    const result = await listEveryEntry(ctx, { path: '/DATA/d', pageSize: 40, max: 30 })
    expect(isErr(result)).toBe(false)
    if (isErr(result)) return
    expect(result.value.entries).toHaveLength(30)
    expect(result.value.truncated).toBe(true)
  })
})
