import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import { isVideoName } from '@shared/media'
import { Card, Muted, Pill, SectionTitle } from '../../shared/ui/Card'
import { Badge, Button, ErrorNote } from '../../shared/ui/Controls'
import { ChevronLeftIcon, FolderIcon, SearchIcon } from '../../shared/ui/Icons'
import { asAppError, errorDetail, errorMessage, unwrap } from '../../shared/lib/ipc'
import { basename, parentPath } from '../../shared/lib/format'
import { PhotoGrid, type GridItem } from './PhotoGrid'
import { BackupPanel } from './BackupPanel'
import { IndexProgress } from './IndexProgress'

/**
 * Photos — usable on every device, complete only on devices with the photos module.
 *
 * The split is the whole design (Plan § 7.3.1):
 *
 *   Library  (grid from the index, semantic search, index progress) -> needs /v2/photos
 *   Folder   (grid from a directory, thumbnails, backup)            -> files API, always
 *
 * A device without the module gets the folder mode — never an empty gallery, which reads as
 * "you have no photos".
 *
 * 🔴 That mode used to come with a card explaining that the Photos module is absent. It was
 * removed on 2026-08-15 after a tester said "It also say I need the Photo mudoul but I dont
 * need them": he runs Immich, so the card announced a missing dependency on every single
 * visit for a feature he will never install. The mode is still stated — the badge below says
 * "Folder" — but it is stated as what this screen IS, not as what the device lacks.
 */
const GALLERY_PAGE = 120
const FOLDER_PAGE = 300

export const PhotosScreen = (): React.JSX.Element => {
  const { t } = useTranslation()
  const [folder, setFolder] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const session = useQuery({
    queryKey: ['session', 'current'],
    queryFn: async () => unwrap(await window.zima.currentSession({})),
  })
  const hasLibrary = session.data?.capabilities?.photoLibrary === true

  const volumes = useQuery({
    queryKey: ['system', 'volumes'],
    queryFn: async () => unwrap(await window.zima.storageVolumes({})),
  })
  const root = folder ?? volumes.data?.[0]?.path ?? null

  /*
   * 🔴 Both grids are paged, and until 2026-10-15 only the first page was ever asked for:
   * a library of 2 000 pictures showed 120 and said "120 of 2000 shown", with no way to the
   * rest. Measured on device A (ZimaOS v1.8.0): the stream honours `limit` and continues by
   * `next_cursor` (11 pages of 10 = 106 distinct ids = `total`); the files API's `index` is
   * a 1-based PAGE number, not an offset (index=2,size=10 -> entries 10..19).
   */
  const gallery = useInfiniteQuery({
    queryKey: ['photos', 'gallery'],
    queryFn: async ({ pageParam }) =>
      unwrap(await window.zima.photoGallery({ limit: GALLERY_PAGE, cursor: pageParam })),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: hasLibrary && folder === null,
  })

  const grid = useInfiniteQuery({
    queryKey: ['photos', 'folder', root],
    queryFn: async ({ pageParam }) =>
      unwrap(
        await window.zima.photoFolderGrid({ path: root ?? '/', index: pageParam, size: FOLDER_PAGE }),
      ),
    initialPageParam: 1,
    // `total` counts every entry of the directory (folders and non-pictures included), so
    // it is the right measure for "is there another page", not for "how many pictures".
    getNextPageParam: (last, _all, lastIndex) =>
      lastIndex * FOLDER_PAGE < last.total ? lastIndex + 1 : undefined,
    enabled: root !== null && (folder !== null || !hasLibrary),
  })
  const galleryAssets = gallery.data?.pages.flatMap((page) => page.assets) ?? []
  const galleryTotal = gallery.data?.pages[0]?.total
  const gridEntries = grid.data?.pages.flatMap((page) => page.entries) ?? []
  const gridFolders = grid.data?.pages.flatMap((page) => page.folders) ?? []
  const gridTotal = grid.data?.pages[0]?.total
  // Entries of the directory read so far — the page index is a page number, so every page
  // but the last is full. Counted in the same unit as `gridTotal`, unlike the pictures.
  const gridRead =
    gridTotal === undefined ? 0 : Math.min((grid.data?.pages.length ?? 0) * FOLDER_PAGE, gridTotal)

  // The semantic index state, read for one reason: a search over a missing vision model
  // answers 200 with zero hits, which renders as "nothing found" — a statement about the
  // user's pictures instead of about the feature. Measured 2026-07-30 on a real host:
  // ready=false, status=install_required, missing=[runtime,model,mmproj].
  const progress = useQuery({
    queryKey: ['photos', 'progress'],
    queryFn: async () => unwrap(await window.zima.photoIndexProgress({})),
  })
  const semantic = progress.data?.semanticSearch

  const search = useMutation({
    mutationFn: async (text: string) => unwrap(await window.zima.photoSearch({ query: text })),
  })

  const galleryError = asAppError(gallery.error)
  const gridError = asAppError(grid.error)
  const searchError = asAppError(search.error)

  const libraryItems: readonly GridItem[] = galleryAssets.map((asset) => ({
    path: asset.path,
    name: basename(asset.path),
    capturedMs: asset.captureTsMs,
    isVideo: asset.mediaType !== 'img',
    assetId: asset.fileId,
  }))
  const folderItems: readonly GridItem[] = gridEntries.map((entry) => ({
    path: entry.path,
    name: entry.name,
    capturedMs: entry.modifiedMs,
    isVideo: isVideoName(entry.name),
  }))
  const searchItems: readonly GridItem[] = (search.data?.hits ?? []).map((hit) => ({
    path: hit.path,
    name: hit.name,
    capturedMs: 0,
    isVideo: hit.type !== 'img',
    assetId: hit.fileId,
  }))

  const showingSearch = search.data !== undefined
  const showingFolder = folder !== null || !hasLibrary
  const items = showingSearch ? searchItems : showingFolder ? folderItems : libraryItems
  const up = root === null ? null : parentPath(root)
  const pager = showingFolder ? grid : gallery

  /*
   * 🔴 `isLoading`, not `isPending` — and the difference was a permanent "Loading…".
   *
   * Exactly one of `gallery` and `grid` is always switched off: without the module the
   * gallery never runs, in library mode the folder grid never runs. Measured against
   * react-query 5.90, which is the version this app ships:
   *
   *     disabled -> status=pending isPending=true  isLoading=false fetchStatus=idle
   *     active   -> status=success isPending=false isLoading=false
   *
   * So `isPending` stayed true for ever on the disabled half. The card below therefore said
   * "Loading…" permanently whenever the result was empty, and the honest empty state —
   * "No pictures or videos in this folder." — was unreachable in BOTH modes. `isLoading` is
   * `isPending && isFetching`, which a query that is not running never satisfies.
   *
   * `volumes` is in here too: while it is still fetching there is no root yet, and without
   * it the screen would claim the folder is empty before knowing which folder it means.
   */
  const loading = volumes.isLoading || gallery.isLoading || grid.isLoading

  return (
    <>
      <SectionTitle>{t('photos.title')}</SectionTitle>

      {/* Not a hidden feature flag: the mode is on screen, with the reason. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone={hasLibrary ? 'success' : 'neutral'}>
          {t(hasLibrary ? 'photos.modeLibrary' : 'photos.modeFolder')}
        </Badge>
        {hasLibrary && (
          <Button
            variant={showingFolder ? 'secondary' : 'primary'}
            onClick={() => {
              search.reset()
              setFolder(showingFolder ? null : (volumes.data?.[0]?.path ?? null))
            }}
          >
            {t(showingFolder ? 'photos.switchToLibrary' : 'photos.switchToFolder')}
          </Button>
        )}
      </div>

      {hasLibrary && <IndexProgress />}

      {hasLibrary && semantic !== undefined && !semantic.ready && (
        <Card className="mb-4">
          <p className="font-medium">{t('photos.semanticUnavailable')}</p>
          <Muted className="mt-1">{t('photos.semanticUnavailableHint')}</Muted>
          {/* The device's own words, not ours: it says what is missing, and guessing a
              cause here would be an invented fact in front of the user. */}
          <Muted className="mt-1 text-xs">
            {t('photos.semanticState', {
              state: semantic.status,
              missing: semantic.missing.join(', ') || '-',
            })}
          </Muted>
        </Card>
      )}

      {hasLibrary && (
        <Card className="mb-4">
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (query.trim().length > 0) search.mutate(query.trim())
            }}
          >
            <input
              name="photoQuery"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('photos.searchPlaceholder')}
              className="flex-1 rounded-[999px] px-4 py-2 text-sm outline-none"
              style={{
                background: 'var(--surface-sunken)',
                color: 'var(--text-strong)',
                border: '1px solid var(--border-subtle)',
              }}
            />
            <Button
              type="submit"
              // Disabled rather than left clickable: a button that always returns nothing
              // teaches the user that their library is empty.
              disabled={
                search.isPending || query.trim().length === 0 || semantic?.ready === false
              }
            >
              <SearchIcon />
              {search.isPending ? t('photos.searching') : t('photos.search')}
            </Button>
            {showingSearch && (
              <Button
                variant="secondary"
                onClick={() => {
                  search.reset()
                  setQuery('')
                }}
              >
                {t('photos.clearSearch')}
              </Button>
            )}
          </form>
          {showingSearch && (
            <Muted className="mt-2">
              {t('photos.searchSummary', {
                count: search.data.total,
                ms: search.data.tookMs,
              })}
            </Muted>
          )}
        </Card>
      )}

      {root !== null && showingFolder && (
        <Pill className="mb-4">
          {up !== null && (
            <button type="button" onClick={() => setFolder(up)} aria-label={t('files.up')}>
              <ChevronLeftIcon />
            </button>
          )}
          <span className="truncate font-mono text-xs">{root}</span>
        </Pill>
      )}

      {showingFolder && gridFolders.length > 0 && !showingSearch && (
        <Card className="mb-4">
          <div className="flex flex-wrap gap-2">
            {gridFolders.map((entry) => (
              <Button key={entry.path} variant="secondary" onClick={() => setFolder(entry.path)}>
                <FolderIcon />
                {entry.name}
              </Button>
            ))}
          </div>
        </Card>
      )}

      {searchError !== null && (
        <div className="mb-4">
          <ErrorNote message={errorMessage(t, searchError)} detail={errorDetail(searchError)} />
        </div>
      )}
      {galleryError !== null && (
        <div className="mb-4">
          <ErrorNote message={errorMessage(t, galleryError)} detail={errorDetail(galleryError)} />
        </div>
      )}
      {gridError !== null && (
        <div className="mb-4">
          <ErrorNote message={errorMessage(t, gridError)} detail={errorDetail(gridError)} />
        </div>
      )}

      {root !== null && <BackupPanel destination={root} />}

      <Card>
        {loading && items.length === 0 && <Muted>{t('photos.loading')}</Muted>}
        {/* Not under an error: "no pictures here" next to "the device refused" is two
            contradicting statements, and only the error is true. */}
        {/* Nor while the folder has entries not yet read: a first page of sub-folders and
            documents says nothing about the pictures on the next one. */}
        {items.length === 0 && !loading && !(showingFolder && !showingSearch && pager.hasNextPage) &&
          (showingSearch ? searchError : showingFolder ? gridError : galleryError) === null && (
          <Muted>{showingSearch ? t('photos.noHits') : t('photos.noneHere')}</Muted>
        )}
        {items.length > 0 && (
          <PhotoGrid
            items={items}
            useLibraryThumbnails={hasLibrary && !showingFolder}
            onOpen={(item) => void window.zima.downloadFile({ path: item.path })}
          />
        )}
        {/* 🔴 In a folder the device counts ENTRIES (sub-folders and documents included),
            the grid shows pictures. "41 of 96 shown" with every entry read put two units in
            one fraction and promised 55 pictures that did not exist (device A, 2026-10-15),
            so the folder line names both quantities instead of dividing one by the other. */}
        {showingFolder && !showingSearch && gridTotal !== undefined && (items.length > 0 || pager.hasNextPage) ? (
          <Muted className="mt-3">
            {t('photos.folderCountSummary', {
              pictures: items.length,
              read: gridRead,
              total: gridTotal,
            })}
          </Muted>
        ) : (
          items.length > 0 && (
            <Muted className="mt-3">
              {t('photos.countSummary', {
                shown: items.length,
                total: showingSearch ? search.data.total : (galleryTotal ?? items.length),
              })}
            </Muted>
          )
        )}
        {!showingSearch && pager.hasNextPage && (
          <Button
            variant="secondary"
            className="mt-3"
            disabled={pager.isFetchingNextPage}
            onClick={() => void pager.fetchNextPage()}
          >
            {pager.isFetchingNextPage ? t('photos.loading') : t('photos.loadMore')}
          </Button>
        )}
      </Card>
    </>
  )
}
