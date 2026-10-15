// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PhotosScreen } from '../PhotosScreen'

/**
 * The Photos screen's empty state — which for months could not be reached.
 *
 * 🔴 The defect. Exactly one of the two grids is always switched off: without the Photos
 * module the library query never runs, in library mode the folder query never runs. The
 * card asked `isPending`, and react-query 5.90 — the version this app ships — answers that
 * for a DISABLED query for ever. Measured against the real library:
 *
 *     disabled -> status=pending isPending=true  isLoading=false fetchStatus=idle
 *     active   -> status=success isPending=false isLoading=false
 *
 * So "Loading…" was permanent whenever the result was empty, and `photos.noneHere` was
 * unreachable in BOTH modes. A user with an Immich library and no ZimaOS Photos module met
 * a card that never finished — reported as a white patch.
 *
 * The assertions are therefore written the way round that can fail: the empty state must
 * APPEAR, and "Loading…" must be GONE. Asserting only that pictures render would have been
 * green before the fix too, because the bug never touched the non-empty case.
 */

const t = (key: string): string => key

vi.mock('react-i18next', () => ({
  // Keys rather than translations: the identity is stable across all 28 catalogues, and
  // this test is about which sentence is shown, not how it reads in German.
  useTranslation: () => ({ t, i18n: { language: 'en-US' } }),
}))

const EMPTY_GRID = { entries: [], folders: [], total: 0 }

/** The full shape of `photoProgressSchema` — a partial one crashed `IndexProgress`. */
const IDLE_PROGRESS = {
  status: 'idle',
  totalImages: 0,
  totalVideos: 0,
  processedImages: 0,
  processedVideos: 0,
  pendingImages: 0,
  pendingVideos: 0,
  stages: [],
  semanticSearch: { ready: true, status: 'ready', missing: [] },
}

const install = (over: Record<string, unknown> = {}): void => {
  ;(globalThis as unknown as { window: Record<string, unknown> }).window.zima = {
    currentSession: async () => ({ ok: true, value: { capabilities: { photoLibrary: false } } }),
    storageVolumes: async () => ({ ok: true, value: [{ path: '/DATA' }] }),
    photoGallery: async () => ({ ok: true, value: { assets: [], total: 0 } }),
    photoFolderGrid: async () => ({ ok: true, value: EMPTY_GRID }),
    photoIndexProgress: async () => ({ ok: true, value: IDLE_PROGRESS }),
    photoBackupStatus: async () => ({ ok: true, value: { phase: 'idle', notes: [] } }),
    ...over,
  }
}

const draw = (): void => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PhotosScreen />
    </QueryClientProvider>,
  )
}

beforeEach(() => install())
afterEach(cleanup)

describe('PhotosScreen without the Photos module', () => {
  it('ends up saying the folder is empty, not "Loading…" for ever', async () => {
    draw()
    await waitFor(() => expect(screen.getByText('photos.noneHere')).toBeTruthy())
    expect(screen.queryByText('photos.loading')).toBeNull()
  })

  it('does not tell the user about a module they did not ask for', async () => {
    draw()
    await waitFor(() => expect(screen.getByText('photos.noneHere')).toBeTruthy())
    // Removed 2026-08-15 on a tester's report: he runs Immich, and the card announced a
    // missing ZimaOS dependency on every visit. The mode is still on screen as a badge.
    expect(screen.queryByText('photos.libraryMissing')).toBeNull()
    expect(screen.getByText('photos.modeFolder')).toBeTruthy()
  })

  it('still shows pictures when there are pictures — the case the bug never broke', async () => {
    install({
      photoFolderGrid: async () => ({
        ok: true,
        value: { entries: [{ path: '/DATA/a.jpg', name: 'a.jpg', modifiedMs: 0 }], folders: [], total: 1 },
      }),
    })
    draw()
    // Waited on the POSITIVE fact. "noneHere is absent" is true a millisecond after render
    // as well, while the card still says "Loading…" — a condition that is satisfied before
    // the thing under test has happened proves nothing.
    await waitFor(() => expect(screen.getByText('photos.countSummary')).toBeTruthy())
    expect(screen.queryByText('photos.noneHere')).toBeNull()
    expect(screen.queryByText('photos.loading')).toBeNull()
  })
})

describe('PhotosScreen with the Photos module', () => {
  beforeEach(() =>
    install({
      currentSession: async () => ({ ok: true, value: { capabilities: { photoLibrary: true } } }),
    }),
  )

  it('reaches the empty state in library mode too — there the OTHER query is the disabled one', async () => {
    draw()
    // The mirror image of the first test. Without it, a fix that only repaired the
    // folder half would look complete.
    await waitFor(() => expect(screen.getByText('photos.noneHere')).toBeTruthy())
    expect(screen.queryByText('photos.loading')).toBeNull()
  })
})

/**
 * 🔴 Paging — until 2026-10-15 both grids asked for page one and stopped. A library of
 * 2 000 pictures showed 120 and said "120 of 2000 shown", with nothing to reach the rest.
 * The fixtures copy the measured contracts of device A (ZimaOS v1.8.0): the gallery continues
 * by `next_cursor`, the files API by a 1-based page `index`.
 */
const asset = (n: number): Record<string, unknown> => ({
  fileId: `id${n}`,
  path: `/media/sda/Photos/p${n}.jpg`,
  width: 1,
  height: 1,
  captureTsMs: 0,
  mediaType: 'img',
  isFavorite: false,
})
const entry = (n: number): Record<string, unknown> => ({
  path: `/DATA/f${n}.jpg`,
  name: `f${n}.jpg`,
  modifiedMs: 0,
})

describe('PhotosScreen paging', () => {
  it('library: follows next_cursor on "load more" and appends, then hides the button', async () => {
    const calls: Array<{ limit: number; cursor: string | null }> = []
    install({
      currentSession: async () => ({ ok: true, value: { capabilities: { photoLibrary: true } } }),
      photoGallery: async (input: { limit: number; cursor: string | null }) => {
        calls.push(input)
        return input.cursor === null
          ? { ok: true, value: { assets: [asset(1), asset(2)], total: 3, nextCursor: 'c2' } }
          : { ok: true, value: { assets: [asset(3)], total: 3, nextCursor: null } }
      },
    })
    draw()
    await waitFor(() => expect(screen.getByAltText('p2.jpg')).toBeTruthy())
    expect(screen.queryByAltText('p3.jpg')).toBeNull()
    fireEvent.click(screen.getByText('photos.loadMore'))
    await waitFor(() => expect(screen.getByAltText('p3.jpg')).toBeTruthy())
    // The first page is still there — appended, not replaced.
    expect(screen.getByAltText('p1.jpg')).toBeTruthy()
    expect(calls.map((c) => c.cursor)).toEqual([null, 'c2'])
    expect(screen.queryByText('photos.loadMore')).toBeNull()
  })

  it('library: no button when the device says there is no further page', async () => {
    install({
      currentSession: async () => ({ ok: true, value: { capabilities: { photoLibrary: true } } }),
      photoGallery: async () => ({ ok: true, value: { assets: [asset(1)], total: 1, nextCursor: null } }),
    })
    draw()
    await waitFor(() => expect(screen.getByAltText('p1.jpg')).toBeTruthy())
    expect(screen.queryByText('photos.loadMore')).toBeNull()
  })

  it('folder: asks for page index 2 while index*size < total, and stops at the last page', async () => {
    const indices: number[] = []
    install({
      photoFolderGrid: async (input: { index: number; size: number }) => {
        indices.push(input.index)
        // 301 entries in the directory, page size 300: exactly one more page exists.
        return input.index === 1
          ? { ok: true, value: { path: '/DATA', entries: [entry(1)], folders: [], total: 301 } }
          : { ok: true, value: { path: '/DATA', entries: [entry(2)], folders: [], total: 301 } }
      },
    })
    draw()
    await waitFor(() => expect(screen.getByAltText('f1.jpg')).toBeTruthy())
    fireEvent.click(screen.getByText('photos.loadMore'))
    await waitFor(() => expect(screen.getByAltText('f2.jpg')).toBeTruthy())
    expect(indices).toEqual([1, 2])
    expect(screen.queryByText('photos.loadMore')).toBeNull()
  })
})

describe('PhotosScreen with a failing grid', () => {
  it('shows the error and NOT "no pictures here" — only one of the two is true', async () => {
    install({
      photoFolderGrid: async () => ({
        ok: false,
        error: {
          kind: 'parameters',
          message: 'parameter "sort" in query has an error',
          i18nKey: 'error.parameters',
          context: { status: 400 },
        },
      }),
    })
    draw()
    await waitFor(() => expect(screen.getByText(/error\.parameters/)).toBeTruthy())
    expect(screen.queryByText('photos.noneHere')).toBeNull()
  })
})
