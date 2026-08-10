import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery } from '@tanstack/react-query'
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
 * A device without the module gets the folder mode and a named explanation for what is
 * missing — never an empty gallery, which reads as "you have no photos".
 */
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

  const gallery = useQuery({
    queryKey: ['photos', 'gallery'],
    queryFn: async () => unwrap(await window.zima.photoGallery({ limit: 120, cursor: null })),
    enabled: hasLibrary && folder === null,
  })

  const grid = useQuery({
    queryKey: ['photos', 'folder', root],
    queryFn: async () =>
      unwrap(await window.zima.photoFolderGrid({ path: root ?? '/', index: 1, size: 300 })),
    enabled: root !== null && (folder !== null || !hasLibrary),
  })

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

  const libraryItems: readonly GridItem[] = (gallery.data?.assets ?? []).map((asset) => ({
    path: asset.path,
    name: basename(asset.path),
    capturedMs: asset.captureTsMs,
    isVideo: asset.mediaType !== 'img',
  }))
  const folderItems: readonly GridItem[] = (grid.data?.entries ?? []).map((entry) => ({
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
  }))

  const showingSearch = search.data !== undefined
  const showingFolder = folder !== null || !hasLibrary
  const items = showingSearch ? searchItems : showingFolder ? folderItems : libraryItems
  const up = root === null ? null : parentPath(root)

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

      {!hasLibrary && (
        <Card className="mb-4">
          <p className="font-medium">{t('photos.libraryMissing')}</p>
          <Muted className="mt-1">{t('photos.libraryMissingHint')}</Muted>
        </Card>
      )}

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

      {showingFolder && (grid.data?.folders ?? []).length > 0 && !showingSearch && (
        <Card className="mb-4">
          <div className="flex flex-wrap gap-2">
            {(grid.data?.folders ?? []).map((entry) => (
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
        {(gallery.isPending || grid.isPending) && items.length === 0 && (
          <Muted>{t('photos.loading')}</Muted>
        )}
        {items.length === 0 && !gallery.isPending && !grid.isPending && (
          <Muted>{showingSearch ? t('photos.noHits') : t('photos.noneHere')}</Muted>
        )}
        {items.length > 0 && (
          <PhotoGrid
            items={items}
            useLibraryThumbnails={hasLibrary && !showingFolder}
            onOpen={(item) => void window.zima.downloadFile({ path: item.path })}
          />
        )}
        {items.length > 0 && (
          <Muted className="mt-3">
            {t('photos.countSummary', {
              shown: items.length,
              total: showingSearch
                ? search.data.total
                : showingFolder
                  ? (grid.data?.total ?? items.length)
                  : (gallery.data?.total ?? items.length),
            })}
          </Muted>
        )}
      </Card>
    </>
  )
}
