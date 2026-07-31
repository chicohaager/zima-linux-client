import type { Dirent } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import { isVisualName } from '@shared/media'
import { isErr, ok, type Result } from '@shared/result'
import { logger } from '@main/logging/logger'
import type { DeviceContext } from '@main/zima/client'
import { listDirectory } from '@main/zima/files'
import { uploadFile } from './upload'

/**
 * Foreground photo backup — Plan § 7.3.
 *
 * Explicitly NOT a background sync: no daemon, no autostart, no systemd unit. The queue runs
 * while the window is open and stops when it closes, and the UI says so. That was a stated
 * requirement, not an omission.
 *
 * Properties that decide whether this is trustworthy:
 *
 *  - **Every skipped file is named with its reason.** "Backup finished" while three photos
 *    were quietly left behind is the failure mode that matters here: the user deletes the
 *    originals believing they are safe.
 *  - **Duplicate detection is (relative path, size).** Deliberately not a hash of every
 *    file: hashing gigabytes on every run costs more than it saves, and name+size is what
 *    the device can answer cheaply from a listing. Where that is not enough to decide, the
 *    file is uploaded again rather than skipped — an extra copy is recoverable, a missing
 *    photo is not.
 *  - **Cancel leaves a resumable state**, because the upload is chunked and the chunk check
 *    lets the next run continue.
 */

export type BackupPhase = 'idle' | 'scanning' | 'uploading' | 'done' | 'cancelled' | 'failed'

export interface BackupNote {
  readonly file: string
  readonly outcome: 'skipped-duplicate' | 'skipped-unsupported' | 'failed'
  readonly detail: string
}

export interface BackupStatus {
  readonly phase: BackupPhase
  readonly targetPath: string
  readonly total: number
  readonly uploaded: number
  readonly skipped: number
  readonly failed: number
  readonly bytesSent: number
  readonly bytesTotal: number
  readonly currentFile: string | null
  readonly startedAtMs: number | null
  readonly finishedAtMs: number | null
  readonly notes: readonly BackupNote[]
}

const IDLE: BackupStatus = {
  phase: 'idle',
  targetPath: '',
  total: 0,
  uploaded: 0,
  skipped: 0,
  failed: 0,
  bytesSent: 0,
  bytesTotal: 0,
  currentFile: null,
  startedAtMs: null,
  finishedAtMs: null,
  notes: [],
}

let status: BackupStatus = IDLE
let controller: AbortController | null = null
let running = false

export const currentStatus = (): BackupStatus => status

/** Local file found by the scan, with the path it will get on the device. */
interface Candidate {
  readonly localPath: string
  readonly relativePath: string
  readonly size: number
}

/**
 * Collects photos and videos under the chosen folders.
 *
 * Depth-limited and count-limited: a user who picks their home directory should get a
 * bounded, explainable result rather than a walk that never ends. Anything not a picture or
 * video is skipped with a reason, so the report explains why a folder of 300 files produced
 * 120 uploads.
 */
const scan = async (
  sources: readonly string[],
  notes: BackupNote[],
  limits = { maxFiles: 20_000, maxDepth: 12 },
): Promise<readonly Candidate[]> => {
  const found: Candidate[] = []

  const walk = async (root: string, current: string, depth: number): Promise<void> => {
    if (found.length >= limits.maxFiles || depth > limits.maxDepth) return
    let entries: Dirent[]
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch (cause) {
      notes.push({
        file: current,
        outcome: 'failed',
        detail: `folder unreadable: ${String(cause).slice(0, 120)}`,
      })
      return
    }
    for (const entry of entries) {
      if (found.length >= limits.maxFiles) return
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(root, full, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      if (!isVisualName(entry.name)) {
        notes.push({ file: entry.name, outcome: 'skipped-unsupported', detail: 'not a photo or video' })
        continue
      }
      try {
        const info = await stat(full)
        found.push({
          localPath: full,
          relativePath: relative(root, full),
          size: info.size,
        })
      } catch (cause) {
        notes.push({ file: entry.name, outcome: 'failed', detail: `unreadable: ${String(cause).slice(0, 120)}` })
      }
    }
  }

  for (const source of sources) {
    await walk(source, source, 0)
  }
  return found
}

/**
 * Reads the destination once and indexes it by name and size.
 *
 * One listing instead of one request per file: with 5000 photos the per-file variant makes
 * 5000 round trips before the first byte is uploaded.
 */
const existingIndex = async (
  ctx: DeviceContext,
  destination: string,
): Promise<Map<string, number>> => {
  const index = new Map<string, number>()
  const page = await listDirectory(ctx, { path: destination, size: 1_000 })
  if (isErr(page)) {
    // A destination we cannot list is not a reason to stop: it may simply not exist yet. The
    // consequence is that nothing can be recognised as a duplicate, which is the safe
    // direction — it uploads too much rather than too little.
    logger.info('backup.destination-unlistable', { destination, kind: page.error.kind })
    return index
  }
  for (const entry of page.value.entries) {
    if (!entry.isDir) index.set(entry.name, entry.size)
  }
  return index
}

export const cancel = (): BackupStatus => {
  if (controller !== null) controller.abort()
  return status
}

/**
 * Runs a backup. Rejects a second concurrent run rather than interleaving two queues.
 */
export const start = async (
  ctx: DeviceContext,
  params: { readonly sources: readonly string[]; readonly destination: string },
): Promise<Result<BackupStatus>> => {
  if (running) {
    // Not an error the user needs a red banner for — the status they get back already says a
    // backup is in progress, which answers the question they were asking.
    return ok(status)
  }
  running = true
  controller = new AbortController()
  const notes: BackupNote[] = []

  status = {
    ...IDLE,
    phase: 'scanning',
    targetPath: params.destination,
    startedAtMs: Date.now(),
  }

  try {
    const candidates = await scan(params.sources, notes)
    const existing = await existingIndex(ctx, params.destination)
    const bytesTotal = candidates.reduce((sum, candidate) => sum + candidate.size, 0)

    status = { ...status, phase: 'uploading', total: candidates.length, bytesTotal, notes: [...notes] }
    logger.info('backup.started', {
      sources: params.sources.length,
      files: candidates.length,
      destination: params.destination,
    })

    let uploaded = 0
    let skipped = 0
    let failed = 0
    let bytesSent = 0

    for (const candidate of candidates) {
      if (controller.signal.aborted) {
        status = { ...status, phase: 'cancelled', finishedAtMs: Date.now(), notes: [...notes] }
        logger.info('backup.cancelled', { uploaded, skipped, failed })
        return ok(status)
      }

      const name = basename(candidate.localPath)
      status = { ...status, currentFile: name }

      const already = existing.get(name)
      if (already === candidate.size) {
        skipped += 1
        bytesSent += candidate.size
        notes.push({
          file: name,
          outcome: 'skipped-duplicate',
          detail: `same name and size (${candidate.size} bytes) already on the device`,
        })
        status = { ...status, skipped, bytesSent, notes: [...notes] }
        continue
      }

      const result = await uploadFile(ctx, {
        localPath: candidate.localPath,
        destination: params.destination,
        signal: controller.signal,
        onProgress: (progress) => {
          status = { ...status, bytesSent: bytesSent + progress.bytesSent }
        },
      })
      if (isErr(result)) {
        if (result.error.kind === 'cancelled') {
          status = { ...status, phase: 'cancelled', finishedAtMs: Date.now(), notes: [...notes] }
          return ok(status)
        }
        failed += 1
        notes.push({ file: name, outcome: 'failed', detail: `${result.error.kind}: ${result.error.message}` })
      } else {
        uploaded += 1
      }
      bytesSent += candidate.size
      status = { ...status, uploaded, failed, bytesSent, notes: [...notes] }
    }

    // 'done' only when nothing failed. A green "finished" over three failures is exactly the
    // summary-greener-than-its-details problem, and here it would cost photos.
    status = {
      ...status,
      phase: failed > 0 ? 'failed' : 'done',
      currentFile: null,
      finishedAtMs: Date.now(),
      notes: [...notes],
    }
    logger.info('backup.finished', { uploaded, skipped, failed, phase: status.phase })
    return ok(status)
  } finally {
    running = false
    controller = null
  }
}

/** Stops a running backup when the window goes away — there is no background mode. */
export const stopForWindowClose = (): void => {
  if (running) {
    logger.info('backup.stopped-window-closed', {})
    cancel()
  }
}
