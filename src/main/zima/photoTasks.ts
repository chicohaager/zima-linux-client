import { z } from 'zod'
import type { PhotoIndexProgress } from '@shared/domain'

/** The 1.8.0-beta2 form of `/v2/photos/progress`, split out of `photos.ts` for size. */

export interface ProgressTask {
  readonly id?: string | undefined
  readonly kind?: string | undefined
  readonly status?: string | undefined
  readonly total?: number | undefined
  readonly completed?: number | undefined
  readonly enabled?: boolean | undefined
  readonly available?: boolean | undefined
  readonly children?: readonly ProgressTask[] | null | undefined
}

export const taskSchema: z.ZodType<ProgressTask> = z.looseObject({
  id: z.string().optional(),
  kind: z.string().optional(),
  status: z.string().optional(),
  total: z.number().optional(),
  completed: z.number().optional(),
  enabled: z.boolean().optional(),
  available: z.boolean().optional(),
  children: z.array(z.lazy(() => taskSchema)).nullable().optional(),
})

/**
 * Reads the 1.8.0-beta2 task tree. Measured 2026-10-08 on a library of 106:
 *
 *   media      running   total 106  children media:images total 95, media:videos total 11
 *   stage:exif completed 106/106
 *   stage:nn   completed 106/106     (text embedding — what search runs on)
 *   ai:cpu     completed 318/318     enabled, available (OCR + object detection)
 *   ai:vlm     idle                  enabled false, available false
 *
 * "Indexed" is the `stage:nn` count: it is the stage search depends on, and the only one
 * with a completed count over all assets. It is not split by type. When it covers every
 * asset the split is exact (all images, all videos); while it is partial the whole count is
 * reported under images — the SUM is what the device said, a per-type split would be a
 * number it never gave.
 *
 * Search readiness: on 1.7 a search without the vision model answered nothing (measured
 * 2026-07-30), so readiness meant "VLM ready". On beta2 it answers without one — measured
 * `person` 25 hits, `car` 2, `food` 2 with `ai:vlm` unavailable — so readiness is the
 * completed `nn` stage. Gating on the VLM here would disable a search that works.
 */
export const fromTaskTree = (status: string, tasks: readonly ProgressTask[]): PhotoIndexProgress => {
  const byId = (id: string): ProgressTask | undefined => tasks.find((task) => task.id === id)
  const media = byId('media')
  const child = (kind: string): ProgressTask | undefined =>
    (media?.children ?? []).find((entry) => entry.kind === kind)
  const nn = byId('stage:nn')
  const vlm = byId('ai:vlm')
  const percentage = (task: ProgressTask): number =>
    task.total !== undefined && task.total > 0 && task.completed !== undefined
      ? Math.round((task.completed / task.total) * 100)
      : task.status === 'completed'
        ? 100
        : 0
  const totalImages = child('images')?.total ?? media?.total ?? 0
  const totalVideos = child('videos')?.total ?? 0
  const indexed = nn?.completed ?? 0
  const complete = indexed > 0 && indexed >= totalImages + totalVideos
  return {
    status,
    totalImages,
    totalVideos,
    processedImages: complete ? totalImages : indexed,
    processedVideos: complete ? totalVideos : 0,
    pendingImages: 0,
    pendingVideos: 0,
    stages: tasks.map((task) => ({
      kind: task.kind ?? '',
      label: task.id ?? '',
      percentage: percentage(task),
      status: task.status ?? '',
    })),
    semanticSearch: {
      ready: nn?.status === 'completed',
      enabled: nn !== undefined,
      missing: [],
      // The device's own word for the stage search runs on; the VLM state is not it.
      status: nn?.status ?? (vlm?.status ?? 'unknown'),
    },
  }
}
