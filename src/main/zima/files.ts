import { z } from 'zod'
import type { ConflictPolicy, DirectoryPage, FileTask, TrashEntry, ZimaFile } from '@shared/domain'
import { appError, err, isErr, ok, type Result } from '@shared/result'
import { authed, type DeviceContext } from './client'
import { BASE, FILES, taskById } from './endpoints'

/**
 * The files API — the File Hub's whole surface.
 *
 * Every schema below mirrors an answer measured on 2026-07-30 against a v1.7.0 host and
 * recorded in `reports/verify-live-*.json`. Parsing is strict on the fields we use and
 * tolerant about the rest (`.passthrough()` semantics via `.loose()`), because a server
 * that ADDS a field must not break the client, while a server that RENAMES one we rely on
 * must fail loudly rather than render an empty list.
 *
 * Two device behaviours worth knowing before reading on:
 *
 *  - Delete takes a **bare JSON array** of paths, not an object. Measured: an object body
 *    answers `400 value must be an array`.
 *  - Copy/move need `user_select`, the conflict policy. Its allowed values came from the
 *    validator itself (`value is not one of the allowed values ["overwrite","rename","skip"]`).
 */

const files = (path: string): string => `${BASE.files}${path}`

/** live: `{name,path,is_dir,size,modified,extensions:{…}}` — `modified` is SECONDS. */
const entrySchema = z.looseObject({
  name: z.string(),
  path: z.string(),
  is_dir: z.boolean(),
  size: z.number(),
  modified: z.number(),
})

const listingSchema = z.looseObject({
  all: z.number(),
  content: z.array(entrySchema).nullable(),
  index: z.number(),
  size: z.number(),
  total: z.number(),
})

const toFile = (raw: z.infer<typeof entrySchema>): ZimaFile => ({
  name: raw.name,
  path: raw.path,
  isDir: raw.is_dir,
  size: raw.size,
  // The device sends seconds. Copying the number straight through dated every file to
  // 1970 in the first draft — a unit mistake that a type checker cannot see.
  modifiedMs: raw.modified * 1_000,
})

/**
 * Parses a device answer, turning a shape we do not recognise into a named error.
 *
 * Never returns a partial result: half a directory is worse than a clear failure, because
 * the user cannot tell which half is missing.
 */
const parse = <S extends z.ZodTypeAny>(
  schema: S,
  payload: unknown,
  where: string,
): Result<z.output<S>> => {
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    return err(
      appError('malformed-response', `${where}: ${parsed.error.issues[0]?.message ?? 'unparseable'}`,
        'error.malformedResponse', { where, issues: parsed.error.issues.length }),
    )
  }
  return ok(parsed.data)
}

export type SortField = 'name' | 'size' | 'modified'
export type SortDirection = 'asc' | 'desc'

/**
 * One page of a directory.
 *
 * `index` is 1-based — the device's own convention, kept rather than translated, so a
 * report and a request can be compared without arithmetic.
 */
export const listDirectory = async (
  ctx: DeviceContext,
  params: {
    readonly path: string
    readonly index?: number
    readonly size?: number
    readonly sort?: SortField
    readonly direction?: SortDirection
  },
): Promise<Result<DirectoryPage>> => {
  const answer = await authed<unknown>(ctx, files(FILES.entry), {
    query: {
      path: params.path,
      index: params.index ?? 1,
      size: params.size ?? 200,
      sort: params.sort ?? 'name',
      direction: params.direction ?? 'asc',
    },
  })
  if (isErr(answer)) return answer

  const parsed = parse(listingSchema, answer.value, 'directory listing')
  if (isErr(parsed)) return parsed
  return ok({
    path: params.path,
    // `content: null` is how the device reports an empty directory. Mapping it to [] is
    // fine HERE and only here: the request succeeded and the folder really is empty. A
    // missing path is a 404 and never reaches this line.
    entries: (parsed.value.content ?? []).map(toFile),
    total: parsed.value.total,
    index: parsed.value.index,
    size: parsed.value.size,
  })
}

/**
 * Walks the tree under `root` and returns entries whose name contains `needle`.
 *
 * This is a CLIENT-side search, and the UI says so. ZimaOS v1.7.0 has no server-side file
 * query — `/file/search` is the indexer's status, which is exactly the trap this function
 * exists to avoid. Bounded on purpose: `maxEntries` and `maxDepth` keep it from walking a
 * 4 TB volume, and the result reports whether it was cut short, so "12 hits" is never
 * mistaken for "12 hits in total".
 */
export const searchDirectory = async (
  ctx: DeviceContext,
  params: {
    readonly root: string
    readonly needle: string
    readonly maxEntries?: number
    readonly maxDepth?: number
  },
): Promise<Result<{ hits: readonly ZimaFile[]; scanned: number; truncated: boolean }>> => {
  const needle = params.needle.trim().toLowerCase()
  if (needle.length === 0) return ok({ hits: [], scanned: 0, truncated: false })

  const maxEntries = params.maxEntries ?? 4_000
  const maxDepth = params.maxDepth ?? 6
  const hits: ZimaFile[] = []
  const queue: { path: string; depth: number }[] = [{ path: params.root, depth: 0 }]
  let scanned = 0
  let truncated = false

  while (queue.length > 0) {
    const next = queue.shift()
    if (next === undefined) break
    const page = await listDirectory(ctx, { path: next.path, size: 500 })
    if (isErr(page)) {
      // A folder we may not read must not abort the whole search, but it must not be
      // silently skipped either — 'forbidden-path' and 'not-found' are expected while
      // walking, anything else is reported to the caller.
      if (page.error.kind === 'forbidden-path' || page.error.kind === 'not-found') continue
      return page
    }
    for (const entry of page.value.entries) {
      scanned += 1
      if (entry.name.toLowerCase().includes(needle)) hits.push(entry)
      if (entry.isDir && next.depth < maxDepth) queue.push({ path: entry.path, depth: next.depth + 1 })
      if (scanned >= maxEntries) {
        truncated = true
        break
      }
    }
    if (truncated) break
  }

  return ok({ hits, scanned, truncated })
}

/** live: POST {path} -> 200. Creates the folder and answers with its path. */
export const createFolder = async (ctx: DeviceContext, path: string): Promise<Result<void>> => {
  const answer = await authed<unknown>(ctx, files(FILES.folder), { method: 'POST', body: { path } })
  return isErr(answer) ? answer : ok(undefined)
}

/** live: POST {path} -> 200. Creates an empty file. */
export const createFile = async (ctx: DeviceContext, path: string): Promise<Result<void>> => {
  const answer = await authed<unknown>(ctx, files(FILES.entry), { method: 'POST', body: { path } })
  return isErr(answer) ? answer : ok(undefined)
}

/**
 * Renames a folder. sdk: `putFolderName` — PUT /folder?path=<old> with a json body.
 *
 * The body field is NOT measured yet, so this sends the whole candidate and reports the
 * device's rejection verbatim if it is wrong, instead of pretending the rename worked.
 */
export const renameFolder = async (
  ctx: DeviceContext,
  params: { readonly path: string; readonly name: string },
): Promise<Result<void>> => {
  const answer = await authed<unknown>(ctx, files(FILES.folder), {
    method: 'PUT',
    query: { path: params.path },
    body: { name: params.name },
  })
  return isErr(answer) ? answer : ok(undefined)
}

const taskSchema = z.looseObject({
  id: z.number(),
  type: z.string(),
  status: z.string(),
  err_msg: z.string().nullable().optional(),
  created_utc: z.number().optional(),
  finished_utc: z.number().optional(),
})

const toTask = (raw: z.infer<typeof taskSchema>): FileTask => ({
  id: raw.id,
  type: raw.type,
  status: raw.status,
  errorMessage: raw.err_msg === undefined || raw.err_msg === null || raw.err_msg === '' ? null : raw.err_msg,
  createdUtc: raw.created_utc ?? 0,
  finishedUtc: raw.finished_utc ?? 0,
})

/**
 * Starts a copy or move. live 2026-07-30:
 * `POST /task/copy {src:[…], dst, user_select}` -> 200 with the task object.
 */
export const startTransferTask = async (
  ctx: DeviceContext,
  params: {
    readonly kind: 'copy' | 'move'
    readonly sources: readonly string[]
    readonly destination: string
    readonly onConflict: ConflictPolicy
  },
): Promise<Result<FileTask>> => {
  if (params.sources.length === 0) {
    return err(appError('internal', 'no sources given', 'error.internal'))
  }
  const answer = await authed<unknown>(
    ctx,
    files(params.kind === 'copy' ? FILES.taskCopy : FILES.taskCut),
    {
      method: 'POST',
      body: { src: params.sources, dst: params.destination, user_select: params.onConflict },
    },
  )
  if (isErr(answer)) return answer
  const parsed = parse(taskSchema, answer.value, 'transfer task')
  return isErr(parsed) ? parsed : ok(toTask(parsed.value))
}

/** live: GET /tasks?visible=true -> `{data:[…]}`. `data` is null when nothing runs. */
export const listTasks = async (ctx: DeviceContext): Promise<Result<readonly FileTask[]>> => {
  const answer = await authed<unknown>(ctx, files(FILES.tasks), { query: { visible: 'true' } })
  if (isErr(answer)) return answer
  const parsed = parse(z.array(taskSchema).nullable(), answer.value, 'task list')
  return isErr(parsed) ? parsed : ok((parsed.value ?? []).map(toTask))
}

/** sdk: GET /task/{id} — a single task, for following one operation to its end. */
export const readTask = async (ctx: DeviceContext, id: number): Promise<Result<FileTask>> => {
  const answer = await authed<unknown>(ctx, files(taskById(String(id))))
  if (isErr(answer)) return answer
  const parsed = parse(taskSchema, answer.value, 'task')
  return isErr(parsed) ? parsed : ok(toTask(parsed.value))
}

/**
 * Moves entries to the trash — the reversible delete.
 *
 * live: `DELETE /file/trash` with a **bare array** of paths -> 200
 * `{data:[{path,status}], result:"success"}`. The per-path status is passed through so a
 * partial failure cannot be reported as success.
 */
export const moveToTrash = async (
  ctx: DeviceContext,
  paths: readonly string[],
): Promise<Result<readonly { path: string; status: string }[]>> => {
  const answer = await authed<unknown>(ctx, files(FILES.moveToTrash), {
    method: 'DELETE',
    body: paths,
  })
  if (isErr(answer)) return answer
  const parsed = parse(
    z.array(z.looseObject({ path: z.string(), status: z.string() })).nullable(),
    answer.value,
    'move to trash',
  )
  return isErr(parsed) ? parsed : ok(parsed.value ?? [])
}

/** live: `DELETE /folder` with a bare array -> 200. Irreversible for folders. */
export const deleteFolders = async (
  ctx: DeviceContext,
  paths: readonly string[],
): Promise<Result<void>> => {
  const answer = await authed<unknown>(ctx, files(FILES.folder), { method: 'DELETE', body: paths })
  return isErr(answer) ? answer : ok(undefined)
}

const trashSchema = z.looseObject({
  name: z.string(),
  path: z.string(),
  raw_path: z.string(),
  size: z.number(),
  is_dir: z.boolean(),
  deleted_at: z.number(),
})

/** live: GET /trash -> `{data:[{name,path,raw_path,size,is_dir,deleted_at}]}` */
export const listTrash = async (ctx: DeviceContext): Promise<Result<readonly TrashEntry[]>> => {
  const answer = await authed<unknown>(ctx, files(FILES.trash))
  if (isErr(answer)) return answer
  const parsed = parse(z.array(trashSchema).nullable(), answer.value, 'trash listing')
  if (isErr(parsed)) return parsed
  return ok(
    (parsed.value ?? []).map((raw) => ({
      name: raw.name,
      path: raw.path,
      rawPath: raw.raw_path,
      size: raw.size,
      isDir: raw.is_dir,
      deletedAtMs: raw.deleted_at * 1_000,
    })),
  )
}

/** sdk: POST /trash with a json body restores entries. Body shape not measured yet. */
export const restoreFromTrash = async (
  ctx: DeviceContext,
  paths: readonly string[],
): Promise<Result<void>> => {
  const answer = await authed<unknown>(ctx, files(FILES.trash), { method: 'POST', body: paths })
  return isErr(answer) ? answer : ok(undefined)
}

const pinSchema = z.looseObject({ name: z.string(), path: z.string(), type: z.string() })

/** live: GET /pin -> a BARE array (no envelope) of favourites. */
export const listPins = async (
  ctx: DeviceContext,
): Promise<Result<readonly { name: string; path: string; type: string }[]>> => {
  const answer = await authed<unknown>(ctx, files(FILES.pin))
  if (isErr(answer)) return answer
  const parsed = parse(z.array(pinSchema).nullable(), answer.value, 'favourites')
  return isErr(parsed) ? parsed : ok(parsed.value ?? [])
}
