import { open, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { appError, err, fromUnknown, ok, type Result } from '@shared/result'
import { baseUrl, type DeviceContext } from '@main/zima/client'
import { BASE, FILES } from '@main/zima/endpoints'
import { logger } from '@main/logging/logger'

/**
 * Uploading one file to the device.
 *
 * The protocol is resumable and chunked. Evidence for the field names: the shipped SDK has
 * `GET /file/upload` (`checkUploadChunk`) with query parameters
 * `chunkNumber, filename, path, relativePath, totalChunks` — unprefixed, so the server is a
 * flow.js-style receiver without the `flow` prefix. The POST uses the same names as form
 * fields, which is the only part not readable from the SDK and is therefore verified by an
 * actual upload (`npm run verify:live -- --upload <file>:<dir>`), not assumed.
 *
 * Why chunked at all, when most photos are a few megabytes: the check endpoint lets an
 * interrupted upload continue instead of starting over, and Plan § 7.3 asks for resume
 * after a cancel. Single-shot uploads cannot offer that.
 */

/** 8 MiB: large enough that a 4 MB photo is one chunk, small enough to resume usefully. */
const CHUNK_BYTES = 8 * 1024 * 1024

export interface UploadProgress {
  readonly file: string
  readonly bytesSent: number
  readonly bytesTotal: number
}

export interface UploadOutcome {
  readonly bytes: number
  /** Chunks that the device already had — the measure of what resume actually saved. */
  readonly chunksSkipped: number
  readonly chunksSent: number
}

const uploadUrl = (ctx: DeviceContext): string =>
  `${baseUrl(ctx.host, ctx.port)}${BASE.files}${FILES.upload}`

/**
 * Asks whether a chunk is already on the device.
 *
 * A 200 means "already there". Anything else — including an error — is treated as "send it":
 * a false negative costs one upload, a false positive would silently produce a corrupt file.
 */
const chunkAlreadyThere = async (
  ctx: DeviceContext,
  params: {
    readonly destination: string
    readonly filename: string
    readonly chunkNumber: number
    readonly totalChunks: number
  },
): Promise<boolean> => {
  const url = new URL(uploadUrl(ctx))
  url.searchParams.set('path', params.destination)
  url.searchParams.set('filename', params.filename)
  url.searchParams.set('relativePath', params.filename)
  url.searchParams.set('chunkNumber', String(params.chunkNumber))
  url.searchParams.set('totalChunks', String(params.totalChunks))
  try {
    const response = await fetch(url.toString(), {
      headers: { authorization: ctx.token },
      signal: AbortSignal.timeout(10_000),
    })
    return response.status === 200
  } catch {
    return false
  }
}

/**
 * Uploads one local file into a device directory.
 *
 * `signal` cancels between chunks — the point at which a cancel leaves a resumable state
 * rather than a half-written chunk.
 */
export const uploadFile = async (
  ctx: DeviceContext,
  params: {
    readonly localPath: string
    readonly destination: string
    /** Name on the device; defaults to the local basename. */
    readonly asName?: string
    readonly signal?: AbortSignal
    readonly onProgress?: (progress: UploadProgress) => void
  },
): Promise<Result<UploadOutcome>> => {
  const filename = params.asName ?? basename(params.localPath)

  let size: number
  try {
    const stats = await stat(params.localPath)
    if (!stats.isFile()) {
      return err(
        appError('internal', `not a regular file: ${filename}`, 'error.uploadNotAFile', { filename }),
      )
    }
    size = stats.size
  } catch (cause) {
    return err(fromUnknown(cause, { filename }))
  }

  // A zero-byte file still has one chunk. Math.ceil(0 / n) is 0, which would upload nothing
  // and report success — the file would be missing on the device while the log said "done".
  const totalChunks = Math.max(1, Math.ceil(size / CHUNK_BYTES))
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(params.localPath, 'r')
  } catch (cause) {
    return err(fromUnknown(cause, { filename }))
  }

  let bytesSent = 0
  let chunksSkipped = 0
  let chunksSent = 0
  try {
    for (let chunkNumber = 1; chunkNumber <= totalChunks; chunkNumber += 1) {
      if (params.signal?.aborted === true) {
        return err(appError('cancelled', 'upload cancelled', 'error.cancelled', { filename }))
      }

      const offset = (chunkNumber - 1) * CHUNK_BYTES
      const length = Math.min(CHUNK_BYTES, size - offset)
      const buffer = Buffer.alloc(length)
      if (length > 0) await handle.read(buffer, 0, length, offset)

      if (
        totalChunks > 1 &&
        (await chunkAlreadyThere(ctx, { destination: params.destination, filename, chunkNumber, totalChunks }))
      ) {
        chunksSkipped += 1
        bytesSent += length
        params.onProgress?.({ file: filename, bytesSent, bytesTotal: size })
        continue
      }

      const form = new FormData()
      form.set('path', params.destination)
      form.set('filename', filename)
      form.set('relativePath', filename)
      form.set('chunkNumber', String(chunkNumber))
      form.set('totalChunks', String(totalChunks))
      form.set('chunkSize', String(CHUNK_BYTES))
      form.set('currentChunkSize', String(length))
      form.set('totalSize', String(size))
      // The identifier ties the chunks of one upload together for the receiver. Derived
      // from size and name so a resumed upload of the same file reuses the same id.
      form.set('identifier', `${size}-${filename.replaceAll(/[^A-Za-z0-9]/g, '')}`)
      form.set('file', new Blob([buffer]), filename)

      let response: Response
      try {
        response = await fetch(uploadUrl(ctx), {
          method: 'POST',
          headers: { authorization: ctx.token },
          body: form,
          signal: params.signal ?? AbortSignal.timeout(120_000),
        })
      } catch (cause) {
        return err(fromUnknown(cause, { filename, chunk: chunkNumber }))
      }

      if (!response.ok) {
        const text = (await response.text()).slice(0, 300)
        // The device's own words go into the log and the error context. An upload that
        // failed for "invalid path" and one that failed for "disk full" need different
        // reactions from the user, and only the message distinguishes them.
        logger.warn('upload.chunk-rejected', {
          filename,
          chunk: chunkNumber,
          status: response.status,
          body: text,
        })
        return err(
          appError('unexpected-status', `upload rejected: HTTP ${response.status} ${text}`,
            'error.uploadRejected', { filename, status: response.status }),
        )
      }

      chunksSent += 1
      bytesSent += length
      params.onProgress?.({ file: filename, bytesSent, bytesTotal: size })
    }
  } finally {
    await handle.close()
  }

  return ok({ bytes: size, chunksSkipped, chunksSent })
}
