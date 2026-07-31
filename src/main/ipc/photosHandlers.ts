import { dialog } from 'electron'
import { CHANNELS } from '@shared/contract'
import { isVisualName } from '@shared/media'
import { appError, isErr, ok } from '@shared/result'
import * as photosApi from '@main/zima/photos'
import { listDirectory } from '@main/zima/files'
import * as backup from '@main/transfer/backupQueue'
import * as session from '@main/session'
import { focusedWindow, handle, wireError, withDevice } from './wire'

/**
 * Photos — both halves.
 *
 * The split matters and is visible here: the gallery, facets and search go through
 * `/v2/photos` and need the optional module; the folder grid and the backup run on the files
 * API and work on every device (measured: one of two v1.7.0 hosts has no photos binary).
 * A handler that needs the module refuses with `capability-missing` and a named reason, so
 * the UI can explain instead of showing an empty gallery — which reads as "no photos".
 */

const requirePhotosModule = (): ReturnType<typeof wireError> | null => {
  const capabilities = session.activeCapabilities()
  if (capabilities === null) {
    return wireError(appError('unauthorized', 'no active session', 'error.signInRequired'))
  }
  if (!capabilities.photoLibrary) {
    return wireError(
      appError('capability-missing', 'photos module is not registered on this device',
        'error.photosModuleMissing'),
    )
  }
  return null
}

export const registerPhotosHandlers = (): void => {
  handle(CHANNELS.photosGallery, async (input) => {
    const missing = requirePhotosModule()
    if (missing !== null) return missing
    const { limit, cursor } = input
    return withDevice((ctx) => photosApi.galleryPage(ctx, { limit, cursor }))
  })

  handle(CHANNELS.photosProgress, async () => {
    const missing = requirePhotosModule()
    if (missing !== null) return missing
    return withDevice((ctx) => photosApi.readProgress(ctx))
  })

  handle(CHANNELS.photosSearch, async (input) => {
    const missing = requirePhotosModule()
    if (missing !== null) return missing
    const { query } = input
    return withDevice((ctx) => photosApi.search(ctx, query))
  })

  /**
   * The grid that works everywhere: a directory listing filtered to pictures and videos.
   *
   * Folders come back separately so the Photos section can be navigated on its own, without
   * sending the user to the Files tab to change album.
   */
  handle(CHANNELS.photosFolderGrid, async (input) => {
    const { path, index, size } = input
    return withDevice(async (ctx) => {
      const page = await listDirectory(ctx, { path, index, size, sort: 'modified', direction: 'desc' })
      if (isErr(page)) return page
      return ok({
        path: page.value.path,
        entries: page.value.entries.filter((entry) => !entry.isDir && isVisualName(entry.name)),
        folders: page.value.entries.filter((entry) => entry.isDir),
        total: page.value.total,
      })
    })
  })

  handle(CHANNELS.photosPickFolders, async () => {
    const window = focusedWindow()
    const options = { properties: ['openDirectory', 'multiSelections'] as const }
    const chosen =
      window === null
        ? await dialog.showOpenDialog({ properties: [...options.properties] })
        : await dialog.showOpenDialog(window, { properties: [...options.properties] })
    return ok({ folders: chosen.canceled ? [] : chosen.filePaths })
  })

  handle(CHANNELS.photosBackupStart, async (input) => {
    const { sources, destination } = input
    return withDevice((ctx) => backup.start(ctx, { sources, destination }))
  })

  handle(CHANNELS.photosBackupStatus, async () => ok(backup.currentStatus()))

  handle(CHANNELS.photosBackupCancel, async () => ok(backup.cancel()))
}
