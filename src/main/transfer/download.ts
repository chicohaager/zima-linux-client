import { createWriteStream } from 'node:fs'
import { basename, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { app, dialog, type BrowserWindow } from 'electron'
import { appError, err, fromUnknown, ok, type Result } from '@shared/result'
import { baseUrl, type DeviceContext } from '@main/zima/client'
import { BASE, FILES } from '@main/zima/endpoints'
import { logger } from '@main/logging/logger'

/**
 * Downloading a file from the device to disk.
 *
 * Streamed, not buffered: a 4 GB video would otherwise be held in the main process's heap
 * before the first byte reaches the disk. `pipeline` also means a failure halfway through
 * leaves a partial file AND an error — rather than a silent truncation that looks complete.
 */

export interface DownloadOutcome {
  /** Absolute local path, or null when the user cancelled the dialog. */
  readonly savedTo: string | null
  readonly bytes: number
}

/**
 * Asks where to save, then streams the file there.
 *
 * The dialog is modal to the window that asked, so it cannot end up behind it — a
 * "nothing happens when I click download" report with a dialog hiding in the background.
 */
export const downloadToDisk = async (
  ctx: DeviceContext,
  params: { readonly devicePath: string; readonly window: BrowserWindow | null },
): Promise<Result<DownloadOutcome>> => {
  const suggested = basename(params.devicePath)
  const chosen =
    params.window === null
      ? await dialog.showSaveDialog({ defaultPath: join(app.getPath('downloads'), suggested) })
      : await dialog.showSaveDialog(params.window, {
          defaultPath: join(app.getPath('downloads'), suggested),
        })
  if (chosen.canceled || chosen.filePath === undefined || chosen.filePath.length === 0) {
    // A cancel is a normal outcome and gets its own answer. Returning an error would put a
    // red message on screen for something the user chose to do.
    return ok({ savedTo: null, bytes: 0 })
  }

  const url = new URL(`${baseUrl(ctx.host, ctx.port)}${BASE.files}${FILES.download}`)
  url.searchParams.set('path', params.devicePath)

  try {
    const response = await fetch(url.toString(), {
      headers: { authorization: ctx.token },
      // No overall timeout: a large file legitimately takes minutes. A stalled transfer
      // surfaces as a stream error instead of as a deadline that cancels a healthy download.
      signal: AbortSignal.timeout(6 * 60 * 60 * 1_000),
    })
    if (!response.ok || response.body === null) {
      return err(
        appError('unexpected-status', `download rejected: HTTP ${response.status}`,
          'error.downloadRejected', { path: params.devicePath, status: response.status }),
      )
    }

    let bytes = 0
    const counting = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength
        controller.enqueue(chunk)
      },
    })
    await pipeline(
      Readable.fromWeb(response.body.pipeThrough(counting) as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(chosen.filePath),
    )
    logger.info('download.finished', { bytes, to: chosen.filePath })
    return ok({ savedTo: chosen.filePath, bytes })
  } catch (cause) {
    return err(fromUnknown(cause, { path: params.devicePath }))
  }
}

/**
 * Asks for local files and uploads them into a device directory.
 *
 * Returns counts rather than throwing on the first failure: with ten files selected, the
 * user needs to know that eight arrived and which two did not.
 */
export const pickAndUpload = async (
  ctx: DeviceContext,
  params: {
    readonly destination: string
    readonly window: BrowserWindow | null
    readonly upload: (
      ctx: DeviceContext,
      args: { localPath: string; destination: string },
    ) => Promise<Result<unknown>>
  },
): Promise<Result<{ uploaded: number; failed: number; cancelled: boolean }>> => {
  const chosen =
    params.window === null
      ? await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] })
      : await dialog.showOpenDialog(params.window, {
          properties: ['openFile', 'multiSelections'],
        })
  if (chosen.canceled || chosen.filePaths.length === 0) {
    return ok({ uploaded: 0, failed: 0, cancelled: true })
  }

  let uploaded = 0
  let failed = 0
  for (const localPath of chosen.filePaths) {
    const result = await params.upload(ctx, { localPath, destination: params.destination })
    if (result.ok) uploaded += 1
    else {
      failed += 1
      logger.warn('upload.file-failed', { file: basename(localPath), kind: result.error.kind })
    }
  }
  return ok({ uploaded, failed, cancelled: false })
}
