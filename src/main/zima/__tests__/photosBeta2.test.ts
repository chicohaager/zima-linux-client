import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isErr, isOk, ok } from '@shared/result'

/*
 * ZimaOS 1.8.0-beta2 changed the photos API underneath the client. Measured 2026-10-08 on a
 * real device with a library of 106 assets:
 *
 *  - `/gallery/stream` items are FLAT (`{id, source_id, path, ts, w, h, media_type?}`) and
 *    `path` is relative to the source folder; the client read `item.asset`, found none, and
 *    showed "0 assets of 106" — a full library as an empty one, with no error anywhere.
 *  - `/progress` is a task tree; the client read counters that no longer exist and showed
 *    "0 of 0 indexed", and disabled a search that answers (`person` -> 25 hits).
 *
 * The shapes below are the measured ones. Ids, paths and counts are made up.
 */

const authed = vi.fn()
vi.mock('../client', () => ({ authed: (...args: unknown[]): unknown => authed(...args) }))
vi.mock('@main/logging/logger', () => ({
  logger: { info: (): void => {}, warn: (): void => {}, error: (): void => {}, debug: (): void => {} },
}))

const ctx = { host: '192.0.2.10', port: 80, token: 'tok' }

const SOURCE = { id: '400000000000000001', path: '/media/disk/Media/Pictures', mount_path: '/media/disk', status: 'available', available: true }

const flatImage = {
  id: '400000000000000101',
  source_id: SOURCE.id,
  path: 'Holiday/IMG_0001.jpg',
  ts: 1_785_260_774,
  time_source: 'file_mod_time',
  metadata_ready: false,
  blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
  w: 1600,
  h: 1200,
}
const flatVideo = {
  id: '400000000000000102',
  source_id: SOURCE.id,
  path: 'Holiday/clip.mp4',
  ts: 1_785_260_700,
  time_source: 'file_mod_time',
  metadata_ready: false,
  media_type: 'video',
}

/** Routes `authed` by path, the way the device answers. */
const device = (answers: Record<string, unknown>): void => {
  authed.mockImplementation(async (_ctx: unknown, path: string) => {
    if (!(path in answers)) throw new Error(`unexpected request ${path}`)
    return ok(answers[path])
  })
}

beforeEach(() => {
  authed.mockReset()
})

describe('gallery stream on 1.8.0-beta2', () => {
  it('reads flat items and resolves their paths against the source folder', async () => {
    const { galleryPage } = await import('../photos')
    device({
      '/v2/photos/gallery/stream': { items: [flatImage, flatVideo], total: 106, next_cursor: null },
      '/v2/photos/sources': { items: [SOURCE] },
    })

    const page = await galleryPage(ctx)

    expect(isOk(page)).toBe(true)
    if (!isOk(page)) return
    expect(page.value.total).toBe(106)
    expect(page.value.assets).toHaveLength(2)
    const [image, video] = page.value.assets
    expect(image?.path).toBe('/media/disk/Media/Pictures/Holiday/IMG_0001.jpg')
    expect(image?.fileId).toBe(flatImage.id)
    expect(image?.width).toBe(1600)
    expect(image?.captureTsMs).toBe(flatImage.ts * 1000)
    expect(image?.mediaType).toBe('img')
    expect(video?.mediaType).toBe('video')
  })

  it('still reads the nested form of older firmware without asking for sources', async () => {
    const { galleryPage } = await import('../photos')
    device({
      '/v2/photos/gallery/stream': {
        items: [{ entry_type: 'asset', asset: { file_id: 'f1', path: '/media/x/a.jpg', width: 10, height: 20, capture_ts: 5, media_type: 'img' } }],
        total: 1,
      },
    })

    const page = await galleryPage(ctx)

    expect(isOk(page) && page.value.assets[0]?.path).toBe('/media/x/a.jpg')
    expect(authed).toHaveBeenCalledTimes(1)
  })

  it('fails loudly when no item is in a known shape, instead of showing an empty library', async () => {
    // The exact symptom of the beta2 change: items present, none readable.
    const { galleryPage } = await import('../photos')
    device({ '/v2/photos/gallery/stream': { items: [{ uid: 1 }, { uid: 2 }], total: 106 } })

    const page = await galleryPage(ctx)

    expect(isErr(page)).toBe(true)
    if (!isErr(page)) return
    expect(page.error.kind).toBe('malformed-response')
    expect(page.error.message).toContain('2 of 2 items in an unrecognised shape')
  })

  it('fails loudly when every flat item names a source the device does not list', async () => {
    const { galleryPage } = await import('../photos')
    device({
      '/v2/photos/gallery/stream': { items: [flatImage], total: 1 },
      '/v2/photos/sources': { items: [] },
    })

    const page = await galleryPage(ctx)

    expect(isErr(page) && page.error.message).toContain('1 with an unknown source')
  })

  it('an empty library stays an empty library, not an error', async () => {
    const { galleryPage } = await import('../photos')
    device({ '/v2/photos/gallery/stream': { items: [], total: 0 } })

    const page = await galleryPage(ctx)

    expect(isOk(page) && page.value.assets).toEqual([])
  })
})

/** The task tree as measured, trimmed to the entries the reader uses plus one it ignores. */
const taskTree = (nnStatus: string, nnCompleted: number) => ({
  status: 'running',
  library_revision: 1,
  tasks: [
    {
      id: 'media',
      kind: 'media',
      status: 'running',
      total: 106,
      children: [
        { id: 'media:images', kind: 'images', status: 'running', total: 95 },
        { id: 'media:videos', kind: 'videos', status: 'running', total: 11 },
      ],
    },
    { id: 'stage:exif', kind: 'exif', status: 'completed', total: 106, completed: 106 },
    { id: 'stage:nn', kind: 'nn', status: nnStatus, total: 106, completed: nnCompleted },
    { id: 'ai:vlm', kind: 'ai_vlm', status: 'idle', enabled: false, available: false, children: [] },
  ],
})

describe('index progress on 1.8.0-beta2', () => {
  it('reads totals from the media task and "indexed" from the nn stage', async () => {
    const { readProgress } = await import('../photos')
    device({ '/v2/photos/progress': taskTree('completed', 106) })

    const progress = await readProgress(ctx)

    expect(isOk(progress)).toBe(true)
    if (!isOk(progress)) return
    expect(progress.value.totalImages).toBe(95)
    expect(progress.value.totalVideos).toBe(11)
    expect(progress.value.processedImages + progress.value.processedVideos).toBe(106)
    // Complete, so the split is exact — never more processed images than images.
    expect(progress.value.processedImages).toBe(95)
    expect(progress.value.processedVideos).toBe(11)
    expect(progress.value.stages.find((stage) => stage.kind === 'nn')?.percentage).toBe(100)
  })

  it('calls search ready once the nn stage is complete, though no vision model exists', async () => {
    // Measured: with `ai:vlm` unavailable, `person` answered 25 hits. Gating on the VLM
    // would disable a search that works.
    const { readProgress } = await import('../photos')
    device({ '/v2/photos/progress': taskTree('completed', 106) })

    const progress = await readProgress(ctx)

    expect(isOk(progress) && progress.value.semanticSearch.ready).toBe(true)
  })

  it('does not call search ready while the nn stage still runs', async () => {
    const { readProgress } = await import('../photos')
    device({ '/v2/photos/progress': taskTree('running', 40) })

    const progress = await readProgress(ctx)

    expect(isOk(progress)).toBe(true)
    if (!isOk(progress)) return
    expect(progress.value.semanticSearch.ready).toBe(false)
    expect(progress.value.processedImages + progress.value.processedVideos).toBe(40)
    expect(progress.value.stages.find((stage) => stage.kind === 'nn')?.percentage).toBe(38)
  })

  it('keeps reading the counter form of older firmware', async () => {
    const { readProgress } = await import('../photos')
    device({
      '/v2/photos/progress': {
        status: 'idle',
        total_images: 10,
        processed_images: 7,
        vlm: { enabled: true, ready: false, status: 'install_required', missing: ['model'] },
      },
    })

    const progress = await readProgress(ctx)

    expect(isOk(progress)).toBe(true)
    if (!isOk(progress)) return
    expect(progress.value.processedImages).toBe(7)
    expect(progress.value.semanticSearch).toEqual({
      ready: false,
      enabled: true,
      missing: ['model'],
      status: 'install_required',
    })
  })
})
