import { CHANNELS } from '@shared/contract'
import { appError, isErr, ok } from '@shared/result'
import * as files from '@main/zima/files'
import { downloadToDisk, pickAndUpload } from '@main/transfer/download'
import { uploadFile } from '@main/transfer/upload'
import { focusedWindow, handle, wireError, withDevice } from './wire'

/**
 * The File Hub's IPC handlers.
 *
 * Thin by design: validate (done by `handle`), get a device context, delegate, serialise.
 * No business logic here — anything worth a decision lives in `zima/files.ts` where it can
 * be tested without Electron.
 */


export const registerFilesHandlers = (): void => {
  handle(CHANNELS.filesList, async (input) => {
    const params = input as { path: string; index: number; size: number; sort: files.SortField; direction: files.SortDirection }
    return withDevice((ctx) => files.listDirectory(ctx, params))
  })

  handle(CHANNELS.filesSearch, async (input) => {
    const { root, needle, maxEntries } = input as { root: string; needle: string; maxEntries: number }
    return withDevice((ctx) => files.searchDirectory(ctx, { root, needle, maxEntries }))
  })

  handle(CHANNELS.filesCreateFolder, async (input) => {
    const { parent, name } = input as { parent: string; name: string }
    // Path assembly happens here and nowhere else. A name containing a slash would create a
    // nested path the user did not ask for, so it is rejected rather than silently accepted.
    if (name.includes('/') || name === '.' || name === '..') {
      return wireError(
        appError('internal', 'folder name may not contain a path', 'error.invalidFolderName', { name }),
      )
    }
    const path = `${parent.replace(/\/$/, '')}/${name}`
    return withDevice(async (ctx) => {
      const created = await files.createFolder(ctx, path)
      return isErr(created) ? created : ok({ path })
    })
  })

  handle(CHANNELS.filesTransfer, async (input) => {
    const params = input as {
      kind: 'copy' | 'move'
      sources: string[]
      destination: string
      onConflict: 'skip' | 'rename' | 'overwrite'
    }
    return withDevice((ctx) => files.startTransferTask(ctx, params))
  })

  handle(CHANNELS.filesTasks, async () => withDevice((ctx) => files.listTasks(ctx)))

  handle(CHANNELS.filesTrashMove, async (input) => {
    const { paths } = input as { paths: string[] }
    return withDevice((ctx) => files.moveToTrash(ctx, paths))
  })

  handle(CHANNELS.filesTrashList, async () => withDevice((ctx) => files.listTrash(ctx)))

  handle(CHANNELS.filesTrashRestore, async (input) => {
    const { paths } = input as { paths: string[] }
    return withDevice(async (ctx) => {
      const restored = await files.restoreFromTrash(ctx, paths)
      return isErr(restored) ? restored : ok({ restored: paths.length })
    })
  })

  handle(CHANNELS.filesPins, async () => withDevice((ctx) => files.listPins(ctx)))

  handle(CHANNELS.filesDownload, async (input) => {
    const { path } = input as { path: string }
    return withDevice((ctx) => downloadToDisk(ctx, { devicePath: path, window: focusedWindow() }))
  })

  handle(CHANNELS.filesUpload, async (input) => {
    const { destination } = input as { destination: string }
    return withDevice((ctx) =>
      pickAndUpload(ctx, {
        destination,
        window: focusedWindow(),
        upload: (deviceCtx, args) => uploadFile(deviceCtx, args),
      }),
    )
  })
}
