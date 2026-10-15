import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The backup's duplicate check reads the destination — ALL of it.
 *
 * 🔴 Until 2026-10-15 it read one page of 1 000 entries. A destination with 1 500 photos
 * looked like 1 000, so the other 500 were not recognised as already present. The fixture
 * uses the measured listing shape of device A (v1.8.0): `total` = this page, `all` = the folder.
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

const page = (from: number, count: number, all: number): Response =>
  ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        content: Array.from({ length: count }, (_, i) => ({
          name: `img${from + i}.jpg`,
          path: `/DATA/Backup/img${from + i}.jpg`,
          is_dir: false,
          size: 100 + from + i,
          modified: 0,
        })),
        total: count,
        all,
        index: 1,
        size: 500,
        depth: 1,
      }),
  }) as Response

describe('existingIndex', () => {
  it('knows every file of a destination larger than one page', async () => {
    fetchMock
      .mockResolvedValueOnce(page(0, 500, 1_200))
      .mockResolvedValueOnce(page(500, 500, 1_200))
      .mockResolvedValueOnce(page(1_000, 200, 1_200))
    const { existingIndex } = await import('../backupQueue')
    const index = await existingIndex({ host: 'device.local', port: 80, token: 't' }, '/DATA/Backup')
    expect(index.size).toBe(1_200)
    // A file from the LAST page — the one the one-page version never saw.
    expect(index.get('img1199.jpg')).toBe(1_299)
  })
})
