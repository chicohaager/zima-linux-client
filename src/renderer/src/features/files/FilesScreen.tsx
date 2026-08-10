import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Card, Muted, SectionTitle } from '../../shared/ui/Card'
import { Badge, Button, ErrorNote } from '../../shared/ui/Controls'
import {
  ChevronLeftIcon,
  CopyIcon,
  DownloadIcon,
  PlusIcon,
  RefreshIcon,
  ScissorsIcon,
  SearchIcon,
  TrashIcon,
  UploadIcon,
} from '../../shared/ui/Icons'
import { asAppError, errorDetail, errorMessage, unwrap } from '../../shared/lib/ipc'
import { breadcrumbs, parentPath } from '../../shared/lib/format'
import { FileList, type Entry } from './FileList'
import { TaskList } from './TaskList'
import { TrashPanel } from './TrashPanel'
import { useDirectory, useFileActions, useSearch, useTasks } from './useFiles'

/**
 * The File Hub.
 *
 * Two things about it are deliberate and visible to the user:
 *
 *  - **The starting points come from the device**, not from a constant. The volume list
 *    (`/v2/local_storage/storages`) is the register ZimaOS itself uses; a hardcoded
 *    `/media/ZimaOS-HD` would be a measured value frozen into code, and it would break on the
 *    first device that names its volume differently.
 *  - **Search is client-side and says so.** ZimaOS v1.7.0 has no server-side file query —
 *    `/file/search` is the indexer's status. So this walks directories, bounded, and reports
 *    when it stopped early. A search box that silently searched only part of the tree would
 *    be worse than one that admits its scope.
 */
export const FilesScreen = (): React.JSX.Element => {
  const { t } = useTranslation()
  const [path, setPath] = useState<string | null>(null)
  const [sort, setSort] = useState<'name' | 'size' | 'modified'>('name')
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc')
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [clipboard, setClipboard] = useState<{ kind: 'copy' | 'move'; paths: readonly string[] } | null>(null)
  const [needle, setNeedle] = useState('')
  const [showTrash, setShowTrash] = useState(false)

  const volumes = useQuery({
    queryKey: ['system', 'volumes'],
    queryFn: async () => unwrap(await window.zima.storageVolumes({})),
  })

  // The first volume is only the DEFAULT; the others stay one click away. Chosen after the
  // volume list arrives so the app never asks the device for a path it invented.
  const root = path ?? volumes.data?.[0]?.path ?? null
  // `root`, not `root ?? '/'`. The hook stays idle while the volume list is in flight; the
  // fallback used to send a request for a root the device had not named, which came back 400
  // on every single visit to this screen.
  const listing = useDirectory(root, sort, direction)
  const tasks = useTasks()
  const actions = useFileActions()
  const search = useSearch()

  const listingError = asAppError(listing.error)
  const actionError = asAppError(actions.error)
  const searchError = asAppError(search.error)

  const entries: readonly Entry[] = search.result?.hits ?? listing.data?.entries ?? []
  const toggle = (target: string): void => {
    const next = new Set(selected)
    if (next.has(target)) next.delete(target)
    else next.add(target)
    setSelected(next)
  }

  const open = (entry: Entry): void => {
    if (entry.isDir) {
      search.clear()
      setNeedle('')
      setSelected(new Set())
      setPath(entry.path)
    } else {
      actions.download(entry.path)
    }
  }

  if (volumes.isPending) {
    return (
      <>
        <SectionTitle>{t('files.title')}</SectionTitle>
        <Card>
          <Muted>{t('files.loadingVolumes')}</Muted>
        </Card>
      </>
    )
  }

  const volumesError = asAppError(volumes.error)
  if (root === null) {
    return (
      <>
        <SectionTitle>{t('files.title')}</SectionTitle>
        {/* No fallback path is invented here. If the device did not name a volume, saying so
            is the honest answer — a guessed root would produce "path not exist" and look
            like a broken client. */}
        <ErrorNote
          message={volumesError === null ? t('files.noVolumes') : errorMessage(t, volumesError)}
          detail={errorDetail(volumesError)}
        />
      </>
    )
  }

  const trail = breadcrumbs(root)
  const up = parentPath(root)

  return (
    <>
      <SectionTitle>{t('files.title')}</SectionTitle>

      <Card className="mb-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {(volumes.data ?? []).map((volume) => (
            <Button
              key={volume.path}
              variant={root.startsWith(volume.path) ? 'primary' : 'secondary'}
              onClick={() => {
                search.clear()
                setNeedle('')
                setPath(volume.path)
              }}
            >
              {volume.name}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          {up !== null && (
            <button type="button" onClick={() => setPath(up)} aria-label={t('files.up')}>
              <ChevronLeftIcon />
            </button>
          )}
          {trail.map((segment, index) => (
            <span key={segment.path} className="flex items-center gap-1.5">
              {index > 0 && <span style={{ color: 'var(--text-muted)' }}>/</span>}
              <button
                type="button"
                onClick={() => setPath(segment.path)}
                className={index === trail.length - 1 ? 'font-medium' : ''}
                style={index === trail.length - 1 ? undefined : { color: 'var(--text-muted)' }}
              >
                {segment.name}
              </button>
            </span>
          ))}
        </div>
      </Card>

      <Card className="mb-4">
        <form
          className="mb-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (needle.trim().length > 0) search.run(root, needle)
          }}
        >
          <input
            name="needle"
            value={needle}
            onChange={(event) => setNeedle(event.target.value)}
            placeholder={t('files.searchPlaceholder')}
            className="flex-1 rounded-[999px] px-4 py-2 text-sm outline-none"
            style={{
              background: 'var(--surface-sunken)',
              color: 'var(--text-strong)',
              border: '1px solid var(--border-subtle)',
            }}
          />
          <Button type="submit" disabled={search.pending || needle.trim().length === 0}>
            <SearchIcon />
            {search.pending ? t('files.searching') : t('files.search')}
          </Button>
          {search.result !== undefined && (
            <Button
              variant="secondary"
              onClick={() => {
                search.clear()
                setNeedle('')
              }}
            >
              {t('files.clearSearch')}
            </Button>
          )}
        </form>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              const name = window.prompt(t('files.newFolderPrompt'))
              if (name !== null && name.trim().length > 0) actions.createFolder(root, name.trim())
            }}
          >
            <PlusIcon />
            {t('files.newFolder')}
          </Button>
          <Button variant="secondary" onClick={() => actions.upload(root)} disabled={actions.pending}>
            <UploadIcon />
            {t('files.upload')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setClipboard({ kind: 'copy', paths: [...selected] })
              setSelected(new Set())
            }}
            disabled={selected.size === 0}
          >
            <CopyIcon />
            {t('files.copy')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setClipboard({ kind: 'move', paths: [...selected] })
              setSelected(new Set())
            }}
            disabled={selected.size === 0}
          >
            <ScissorsIcon />
            {t('files.move')}
          </Button>
          {clipboard !== null && (
            <Button
              onClick={() => {
                actions.transfer(clipboard.kind, clipboard.paths, root)
                setClipboard(null)
              }}
            >
              {t(clipboard.kind === 'copy' ? 'files.pasteCopy' : 'files.pasteMove', {
                count: clipboard.paths.length,
              })}
            </Button>
          )}
          {selected.size === 1 && (
            <Button variant="secondary" onClick={() => actions.download([...selected][0] ?? '')}>
              <DownloadIcon />
              {t('files.download')}
            </Button>
          )}
          <Button
            variant="danger"
            onClick={() => {
              actions.trash([...selected])
              setSelected(new Set())
            }}
            disabled={selected.size === 0}
          >
            <TrashIcon />
            {t('files.toTrash')}
          </Button>
          <Button variant="secondary" onClick={() => void listing.refetch()}>
            <RefreshIcon />
            {t('files.refresh')}
          </Button>
          <Button variant="secondary" onClick={() => setShowTrash(!showTrash)}>
            {showTrash ? t('files.hideTrash') : t('files.showTrash')}
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <Badge>{t('files.sortedBy', { field: t(`files.sort.${sort}`) })}</Badge>
          <button
            type="button"
            onClick={() => setSort(sort === 'name' ? 'modified' : sort === 'modified' ? 'size' : 'name')}
          >
            {t('files.changeSort')}
          </button>
          <button type="button" onClick={() => setDirection(direction === 'asc' ? 'desc' : 'asc')}>
            {t(direction === 'asc' ? 'files.ascending' : 'files.descending')}
          </button>
        </div>
      </Card>

      {actionError !== null && (
        <div className="mb-4">
          <ErrorNote message={errorMessage(t, actionError)} detail={errorDetail(actionError)} />
        </div>
      )}
      {searchError !== null && (
        <div className="mb-4">
          <ErrorNote message={errorMessage(t, searchError)} detail={errorDetail(searchError)} />
        </div>
      )}

      <TaskList tasks={tasks.data ?? []} />

      {showTrash && <TrashPanel onRestore={actions.restore} />}

      <Card>
        {listing.isPending && <Muted>{t('files.loading')}</Muted>}

        {listingError !== null && (
          <ErrorNote message={errorMessage(t, listingError)} detail={errorDetail(listingError)} />
        )}

        {search.result !== undefined && (
          <div className="mb-3">
            <Muted>
              {t('files.searchSummary', {
                hits: search.result.hits.length,
                scanned: search.result.scanned,
              })}
            </Muted>
            {/* A truncated walk is stated, so "8 hits" is never read as "8 in total". */}
            {search.result.truncated && (
              <p className="mt-1 text-sm" style={{ color: 'var(--danger)' }}>
                {t('files.searchTruncated')}
              </p>
            )}
          </div>
        )}

        {listingError === null && !listing.isPending && entries.length === 0 && (
          <Muted>{search.result !== undefined ? t('files.noHits') : t('files.emptyFolder')}</Muted>
        )}

        {entries.length > 0 && (
          <FileList entries={entries} selected={selected} onToggle={toggle} onOpen={open} />
        )}

        {listing.data !== undefined && search.result === undefined && (
          <Muted className="mt-3">
            {t('files.countSummary', {
              shown: listing.data.entries.length,
              total: listing.data.total,
            })}
          </Muted>
        )}
      </Card>
    </>
  )
}
