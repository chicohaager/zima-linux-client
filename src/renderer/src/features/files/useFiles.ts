import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import type { ResponseOf } from '@shared/contract'
import { unwrap } from '../../shared/lib/ipc'

/**
 * Data hooks for the File Hub.
 *
 * All of them go through `unwrap`, so a device error lands in react-query's `error` and the
 * component is forced to render it. None of them ever produces an empty list to stand in for
 * a failure.
 */

type Listing = Extract<ResponseOf<'files:list'>, { ok: true }>['value']
type Tasks = Extract<ResponseOf<'files:tasks'>, { ok: true }>['value']
type Trash = Extract<ResponseOf<'files:trash-list'>, { ok: true }>['value']
type Pins = Extract<ResponseOf<'files:pins'>, { ok: true }>['value']
type SearchResult = Extract<ResponseOf<'files:search'>, { ok: true }>['value']

/**
 * One directory page — and nothing at all until the path is known.
 *
 * 🔴 `path: null` is not the same as `path: '/'`, and treating it as such is what produced
 * `server rejected the path · /v2_1/files/file · status=400` on every visit to the File Hub.
 * The screen used `root ?? '/'` while the volume list was still in flight, so a request went
 * out for a root nobody had named. ZimaOS serves `/media/...` and `/DATA/...`; `/` is not a
 * directory it will list.
 *
 * The screen's own comment already said the rule — "a guessed root would produce 'path not
 * exist' and look like a broken client" — and the fallback three lines above it broke it.
 * Encoding the rule in the hook is what makes it hold: a caller with no path now cannot ask.
 */
export const useDirectory = (
  path: string | null,
  sort: 'name' | 'size' | 'modified',
  direction: 'asc' | 'desc',
): UseQueryResult<Listing> =>
  useQuery({
    queryKey: ['files', 'list', path, sort, direction],
    queryFn: async () =>
      unwrap(await window.zima.listFiles({ path: path ?? '', index: 1, size: 500, sort, direction })),
    enabled: path !== null,
  })

export const usePins = (): UseQueryResult<Pins> =>
  useQuery({ queryKey: ['files', 'pins'], queryFn: async () => unwrap(await window.zima.listPins({})) })

export const useTrash = (enabled: boolean): UseQueryResult<Trash> =>
  useQuery({
    queryKey: ['files', 'trash'],
    queryFn: async () => unwrap(await window.zima.listTrash({})),
    enabled,
  })

/**
 * Running server-side tasks.
 *
 * Polled every second while something is running and left alone when nothing is: a fixed
 * interval would keep waking the device up for no reason, and no interval at all would leave
 * a copy at "0 %" until the user clicked something.
 */
export const useTasks = (): UseQueryResult<Tasks> =>
  useQuery({
    queryKey: ['files', 'tasks'],
    queryFn: async () => unwrap(await window.zima.fileTasks({})),
    refetchInterval: (query) => {
      const tasks = query.state.data
      if (tasks === undefined) return false
      return tasks.some((task) => task.status !== 'finished' && task.status !== 'error') ? 1_000 : false
    },
  })

export interface FileActions {
  readonly createFolder: (parent: string, name: string) => void
  readonly upload: (destination: string) => void
  readonly download: (path: string) => void
  readonly trash: (paths: readonly string[]) => void
  readonly transfer: (
    kind: 'copy' | 'move',
    sources: readonly string[],
    destination: string,
  ) => void
  readonly restore: (paths: readonly string[]) => void
  readonly pending: boolean
  readonly error: unknown
  readonly lastResult: string | null
}

/**
 * The write side, as one hook.
 *
 * Every mutation invalidates the listing AND the task list, because a copy shows up in both.
 * `lastResult` carries a short outcome line ("3 uploaded, 1 failed") — the counts matter: a
 * partial success reported as success is how files go missing unnoticed.
 */
export const useFileActions = (): FileActions => {
  const client = useQueryClient()
  const invalidate = async (): Promise<void> => {
    await client.invalidateQueries({ queryKey: ['files'] })
  }

  const createFolder = useMutation({
    mutationFn: async (params: { parent: string; name: string }) =>
      unwrap(await window.zima.createFolder(params)),
    onSuccess: invalidate,
  })

  const upload = useMutation({
    mutationFn: async (destination: string) =>
      unwrap(await window.zima.uploadFiles({ destination })),
    onSuccess: invalidate,
  })

  const download = useMutation({
    mutationFn: async (path: string) => unwrap(await window.zima.downloadFile({ path })),
  })

  const trash = useMutation({
    mutationFn: async (paths: readonly string[]) =>
      unwrap(await window.zima.moveToTrash({ paths: [...paths] })),
    onSuccess: invalidate,
  })

  const transfer = useMutation({
    mutationFn: async (params: {
      kind: 'copy' | 'move'
      sources: readonly string[]
      destination: string
    }) =>
      unwrap(
        await window.zima.transferFiles({
          kind: params.kind,
          sources: [...params.sources],
          destination: params.destination,
          onConflict: 'rename',
        }),
      ),
    onSuccess: invalidate,
  })

  const restore = useMutation({
    mutationFn: async (paths: readonly string[]) =>
      unwrap(await window.zima.restoreFromTrash({ paths: [...paths] })),
    onSuccess: invalidate,
  })

  const uploadResult = upload.data
  const downloadResult = download.data
  const trashResult = trash.data

  return {
    createFolder: (parent, name) => createFolder.mutate({ parent, name }),
    upload: (destination) => upload.mutate(destination),
    download: (path) => download.mutate(path),
    trash: (paths) => trash.mutate(paths),
    transfer: (kind, sources, destination) => transfer.mutate({ kind, sources, destination }),
    restore: (paths) => restore.mutate(paths),
    pending:
      createFolder.isPending ||
      upload.isPending ||
      download.isPending ||
      trash.isPending ||
      transfer.isPending ||
      restore.isPending,
    error:
      createFolder.error ??
      upload.error ??
      download.error ??
      trash.error ??
      transfer.error ??
      restore.error,
    // Reported as data, not as a toast that disappears: the numbers are the receipt.
    lastResult:
      uploadResult !== undefined
        ? `upload:${uploadResult.uploaded}/${uploadResult.uploaded + uploadResult.failed}`
        : downloadResult !== undefined && downloadResult.savedTo !== null
          ? `download:${downloadResult.bytes}`
          : trashResult !== undefined
            ? `trash:${trashResult.filter((entry) => entry.status === 'success').length}/${trashResult.length}`
            : null,
  }
}

export const useSearch = (): {
  readonly run: (root: string, needle: string) => void
  readonly result: SearchResult | undefined
  readonly pending: boolean
  readonly error: unknown
  readonly clear: () => void
} => {
  const search = useMutation({
    mutationFn: async (params: { root: string; needle: string }) =>
      unwrap(await window.zima.searchFiles({ ...params, maxEntries: 4_000 })),
  })
  return {
    run: (root, needle) => search.mutate({ root, needle }),
    result: search.data,
    pending: search.isPending,
    error: search.error,
    clear: () => search.reset(),
  }
}
