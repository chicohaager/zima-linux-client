/*
 * `zima-media://preview/<id:path>` — photos-library and search tiles.
 *
 * Measured 2026-10-08 on ZimaOS 1.8.0-beta2: `/v2/photos/thumbnail` answers 404, the
 * library is served by `/v2/photos/preview/<asset id>_320.webp` instead. Every library and
 * search tile in the client went to the 404 path. Older firmware has only that path, so the
 * order is: preview, old module thumbnail, files thumbnail — and a host that proves it is old
 * (preview fails, thumbnail works) is not asked for previews again.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const deviceContext = vi.fn()
const fetchBinary = vi.fn()
let handler: ((request: Request) => Promise<Response>) | null = null

vi.mock('electron', () => ({
  protocol: {
    handle: (_scheme: string, fn: (request: Request) => Promise<Response>): void => {
      handler = fn
    },
    registerSchemesAsPrivileged: (): void => {},
  },
}))
vi.mock('@main/logging/logger', () => ({
  logger: { info: (): void => {}, warn: (): void => {}, error: (): void => {}, debug: (): void => {} },
}))
vi.mock('@main/session', () => ({ deviceContext: (): unknown => deviceContext() }))
vi.mock('@main/zima/client', () => ({
  fetchBinary: (...args: unknown[]): unknown => fetchBinary(...args),
}))

const WEBP = { ok: true, value: { bytes: new Uint8Array([0x52, 0x49, 0x46, 0x46]), contentType: 'image/webp' } }
const JPEG = { ok: true, value: { bytes: new Uint8Array([0xff, 0xd8]), contentType: 'image/jpeg' } }
const MISS = { ok: false, error: { kind: 'unexpected-status', message: 'HTTP 404' } }

const ID = '400000000000000101'
const PATH = '/media/disk/Media/Pictures/Holiday/IMG_0001.jpg'

const tile = async (target: string): Promise<Response> => {
  const shared = await import('@shared/media')
  const module = await import('@main/media/protocol')
  module.registerMediaProtocol()
  if (handler === null) throw new Error('handler was never registered')
  return handler(new Request(target.length > 0 ? shared.mediaUrl('preview', target) : ''))
}

const requestedPaths = (): string[] => fetchBinary.mock.calls.map((call) => String(call[1]))

beforeEach(() => {
  vi.resetModules()
  handler = null
  fetchBinary.mockReset()
  deviceContext.mockReturnValue(
    Promise.resolve({ ok: true, value: { host: '192.0.2.10', port: 80, token: 'tok' } }),
  )
})

describe('zima-media://preview', () => {
  it('serves the 1.8 preview by asset id with one request', async () => {
    fetchBinary.mockResolvedValueOnce(WEBP)

    const response = await tile(`${ID}:${PATH}`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/webp')
    expect(requestedPaths()).toEqual([`/v2/photos/preview/${ID}_320.webp`])
  })

  it('falls back to the old module thumbnail, then stops asking that host for previews', async () => {
    fetchBinary.mockResolvedValueOnce(MISS).mockResolvedValueOnce(JPEG)
    const first = await tile(`${ID}:${PATH}`)
    expect(first.status).toBe(200)
    expect(requestedPaths()).toEqual([`/v2/photos/preview/${ID}_320.webp`, '/v2/photos/thumbnail'])
    expect(fetchBinary.mock.calls[1]?.[2]).toMatchObject({ path: PATH })

    // Same module instance: the second tile on the same host skips the preview.
    fetchBinary.mockClear()
    fetchBinary.mockResolvedValueOnce(JPEG)
    if (handler === null) throw new Error('no handler')
    const shared = await import('@shared/media')
    const second = await handler(new Request(shared.mediaUrl('preview', `${ID}:${PATH}`)))
    expect(second.status).toBe(200)
    expect(requestedPaths()).toEqual(['/v2/photos/thumbnail'])
  })

  it('a single missing preview on a 1.8 device does not mark the host as old', async () => {
    // preview 404 AND old thumbnail 404 (1.8 has none) -> files thumbnail. Next tile: preview again.
    fetchBinary.mockResolvedValueOnce(MISS).mockResolvedValueOnce(MISS).mockResolvedValueOnce(JPEG)
    const first = await tile(`${ID}:${PATH}`)
    expect(first.status).toBe(200)
    expect(requestedPaths()).toEqual([
      `/v2/photos/preview/${ID}_320.webp`,
      '/v2/photos/thumbnail',
      '/v2_1/files/thumbnail',
    ])

    fetchBinary.mockClear()
    fetchBinary.mockResolvedValueOnce(WEBP)
    if (handler === null) throw new Error('no handler')
    const shared = await import('@shared/media')
    await handler(new Request(shared.mediaUrl('preview', `${ID}:${PATH}`)))
    expect(requestedPaths()).toEqual([`/v2/photos/preview/${ID}_320.webp`])
  })

  it('answers 404 with a reason when all three sources fail', async () => {
    fetchBinary.mockResolvedValue(MISS)

    const response = await tile(`${ID}:${PATH}`)

    expect(response.status).toBe(404)
    expect(await response.text()).toContain('thumbnail unavailable')
  })

  it.each([
    ['no id', `:${PATH}`],
    ['an id that is not digits', `../../etc:${PATH}`],
    ['no path', `${ID}:`],
    ['no separator', PATH],
  ])('refuses a reference with %s without touching the device', async (_label, target) => {
    const response = await tile(target)

    expect(response.status).toBe(404)
    expect(fetchBinary).not.toHaveBeenCalled()
  })
})
