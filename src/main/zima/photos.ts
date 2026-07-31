import { z } from 'zod'
import type { PhotoAsset, PhotoHit, PhotoIndexProgress, PhotoPage } from '@shared/domain'
import { appError, err, isErr, ok, type Result } from '@shared/result'
import { authed, type DeviceContext } from './client'
import { BASE, PHOTOS } from './endpoints'

/**
 * The photos module — the half of the Photos section that needs `/v2/photos`.
 *
 * The other half (grid from a folder, thumbnails, backup) runs on the files API and is in
 * `files.ts`, which is why Photos stays fully usable on a device without this module
 * (measured: one of two v1.7.0 hosts has no photos binary at all).
 *
 * Parameter names are measured, not guessed. A first probe used `page`/`page_size`; the
 * server ignored them and returned its default page of 50 — a wrong parameter name that
 * looks like a working call. The real ones are `limit`, `media_types`, `path_prefix`,
 * `collapse_groups`, and paging is by opaque **cursor** (`next_cursor`), not by offset.
 */

const parse = <S extends z.ZodTypeAny>(
  schema: S,
  payload: unknown,
  where: string,
): Result<z.output<S>> => {
  const parsed = schema.safeParse(payload)
  return parsed.success
    ? ok(parsed.data)
    : err(
        appError('malformed-response', `${where}: ${parsed.error.issues[0]?.message ?? 'unparseable'}`,
          'error.malformedResponse', { where }),
      )
}

/** live: `{asset:{file_id,path,width,height,capture_ts,media_type,is_favorite,…}}` */
const assetSchema = z.looseObject({
  file_id: z.string(),
  path: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
  capture_ts: z.number().optional(),
  media_type: z.string().optional(),
  is_favorite: z.boolean().optional(),
})

const streamSchema = z.looseObject({
  items: z
    .array(z.looseObject({ asset: assetSchema.nullable().optional() }))
    .nullable()
    .optional(),
  total: z.number().optional(),
  next_cursor: z.string().nullable().optional(),
})

const toAsset = (raw: z.infer<typeof assetSchema>): PhotoAsset => ({
  fileId: raw.file_id,
  path: raw.path,
  width: raw.width ?? 0,
  height: raw.height ?? 0,
  // `capture_ts` is seconds. The same unit trap as the files API's `modified`.
  captureTsMs: (raw.capture_ts ?? 0) * 1_000,
  mediaType: raw.media_type ?? 'img',
  isFavorite: raw.is_favorite ?? false,
})

/**
 * One page of the gallery.
 *
 * `cursor` continues a previous page. Passing an offset instead would silently restart at
 * the beginning, which reads as "the gallery only has 50 photos".
 */
export const galleryPage = async (
  ctx: DeviceContext,
  params: {
    readonly limit?: number
    readonly cursor?: string | null
    readonly pathPrefix?: string
    readonly mediaTypes?: string
  } = {},
): Promise<Result<PhotoPage>> => {
  const answer = await authed<unknown>(ctx, `${BASE.photos}${PHOTOS.galleryStream}`, {
    query: {
      media_types: params.mediaTypes ?? 'img,video',
      limit: params.limit ?? 60,
      collapse_groups: 'true',
      ...(params.cursor !== undefined && params.cursor !== null ? { cursor: params.cursor } : {}),
      ...(params.pathPrefix !== undefined ? { path_prefix: params.pathPrefix } : {}),
    },
    timeoutMs: 20_000,
  })
  if (isErr(answer)) return answer
  const parsed = parse(streamSchema, answer.value, 'gallery stream')
  if (isErr(parsed)) return parsed

  const assets = (parsed.value.items ?? [])
    .map((item) => item.asset)
    .filter((asset): asset is z.infer<typeof assetSchema> => asset !== null && asset !== undefined)
    .map(toAsset)
  return ok({
    assets,
    total: parsed.value.total ?? assets.length,
    nextCursor: parsed.value.next_cursor ?? null,
  })
}

const progressSchema = z.looseObject({
  status: z.string().optional(),
  total_images: z.number().optional(),
  total_videos: z.number().optional(),
  processed_images: z.number().optional(),
  processed_videos: z.number().optional(),
  pending_images: z.number().optional(),
  pending_videos: z.number().optional(),
  /**
   * The vision-model block. Measured shape 2026-07-30; every field optional because it is
   * absent on a host without the photos module and may be absent on older builds.
   */
  vlm: z
    .looseObject({
      enabled: z.boolean().optional(),
      ready: z.boolean().optional(),
      status: z.string().optional(),
      missing: z.array(z.string()).nullable().optional(),
    })
    .nullable()
    .optional(),
  stage_progress: z
    .array(
      z.looseObject({
        kind: z.string().optional(),
        label: z.string().optional(),
        percentage: z.number().optional(),
        status: z.string().optional(),
      }),
    )
    .nullable()
    .optional(),
})

/**
 * Index progress, shown in the UI as its own line.
 *
 * Necessary because text search is token-exact until the semantic index is built (measured:
 * "flug" hits a file named Chiemseeflug.mp4, "Chiemsee" does not). Without the index state
 * on screen, an empty result set looks like a broken search.
 */
export const readProgress = async (
  ctx: DeviceContext,
): Promise<Result<PhotoIndexProgress>> => {
  const answer = await authed<unknown>(ctx, `${BASE.photos}${PHOTOS.progress}`)
  if (isErr(answer)) return answer
  const parsed = parse(progressSchema, answer.value, 'photo index progress')
  if (isErr(parsed)) return parsed
  const raw = parsed.value
  return ok({
    status: raw.status ?? 'unknown',
    totalImages: raw.total_images ?? 0,
    totalVideos: raw.total_videos ?? 0,
    processedImages: raw.processed_images ?? 0,
    processedVideos: raw.processed_videos ?? 0,
    pendingImages: raw.pending_images ?? 0,
    pendingVideos: raw.pending_videos ?? 0,
    stages: (raw.stage_progress ?? []).map((stage) => ({
      kind: stage.kind ?? '',
      label: stage.label ?? '',
      percentage: stage.percentage ?? 0,
      status: stage.status ?? '',
    })),
    semanticSearch: {
      // Defaults are the CAUTIOUS direction: a device that says nothing about its vision
      // model is treated as not ready, so the interface explains itself rather than
      // promising a search that returns nothing. The opposite default would hide the
      // feature's absence behind an empty result list.
      ready: raw.vlm?.ready ?? false,
      enabled: raw.vlm?.enabled ?? false,
      missing: raw.vlm?.missing ?? [],
      status: raw.vlm?.status ?? 'unknown',
    },
  })
}

const hitSchema = z.looseObject({
  file_id: z.string(),
  path: z.string(),
  name: z.string().optional(),
  type: z.string().optional(),
  score: z.number().optional(),
})

/**
 * Semantic + lexical search.
 *
 * The body must be EXACTLY `{query}`. Measured: adding `limit` yields
 * `400 {"error":"invalid request body"}` because the server sets DisallowUnknownFields — so
 * a result limit cannot be requested and is applied client-side by the caller.
 */
export const search = async (
  ctx: DeviceContext,
  query: string,
): Promise<Result<{ hits: readonly PhotoHit[]; total: number; tookMs: number }>> => {
  const answer = await authed<unknown>(ctx, `${BASE.photos}${PHOTOS.search}`, {
    method: 'POST',
    body: { query },
    timeoutMs: 30_000,
  })
  if (isErr(answer)) return answer
  const parsed = parse(
    z.looseObject({
      hits: z.array(hitSchema).nullable().optional(),
      total: z.number().optional(),
      took_ms: z.number().optional(),
    }),
    answer.value,
    'photo search',
  )
  if (isErr(parsed)) return parsed
  return ok({
    hits: (parsed.value.hits ?? []).map((hit) => ({
      fileId: hit.file_id,
      path: hit.path,
      name: hit.name ?? hit.path.split('/').pop() ?? '',
      type: hit.type ?? 'img',
      score: hit.score ?? 0,
    })),
    total: parsed.value.total ?? 0,
    tookMs: parsed.value.took_ms ?? 0,
  })
}
