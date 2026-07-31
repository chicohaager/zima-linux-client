import { isErr, type Result } from '@shared/result'
import type { DeviceContext } from '@main/zima/client'
import * as apps from '@main/zima/apps'
import * as files from '@main/zima/files'
import * as photos from '@main/zima/photos'
import * as system from '@main/zima/system'

/**
 * Runs the REAL readers against the real device — the check the wire probes cannot make.
 *
 * `liveProbes.ts` measures what the device *says*: method, status, byte count, shape. That
 * is reachability. It is not fitness: a shape can be recorded faithfully while our own
 * parser rejects it. Exactly that happened on 2026-07-30 — `apps.installed-list` was
 * measured at 200 with a clean 18-element shape, and the Apps screen still rendered "the
 * device answered in a form this client does not understand". The probe measured the
 * property next to the one being claimed.
 *
 * So this table calls `listApps`, `listDirectory`, `galleryPage` and friends — the same
 * functions the IPC handlers call — and reports whether they returned a value or an error,
 * with the error text in full. A reader that throws or rejects here is a bug that reaches
 * the user, and it is named before any window opens.
 *
 * Read-only by design: nothing here creates, moves or deletes. The write path has its own
 * confined probes in `liveProbes.ts`.
 *
 * Counting rather than existence-checking: "12 entries" says the listing arrived and
 * parsed, while "no error" is also true of a reader that silently produced nothing.
 */

export interface ParserMeasurement {
  /** Reader under test, as `module.function`. */
  readonly reader: string
  /** What this call proves if it succeeds. */
  readonly asks: string
  readonly ok: boolean
  /** Count summary on success, `kind — message` on failure. Never empty. */
  readonly detail: string
  readonly ms: number | null
  /** Set when the reader was not called, with the reason. Never silently omitted. */
  readonly skipped?: string
}

interface ParserProbe {
  readonly reader: string
  readonly asks: string
  readonly requires?: 'photos'
  /** Returns a short, factual summary of what came back — counts, not prose. */
  readonly call: (ctx: DeviceContext) => Promise<Result<string>>
}

/** Wraps a reader so its success value becomes a countable summary. */
const summarise = <T>(
  result: Result<T>,
  describe: (value: T) => string,
): Result<string> => (isErr(result) ? result : { ok: true, value: describe(result.value) })

/**
 * The directory the listing probe walks.
 *
 * Not hardcoded: the volume list is read first and its first mount point used, so this
 * measures the device that is actually there rather than the one this file was written
 * against. A measured value is not a contract — `/media/ZimaOS-HD` is what one host
 * happened to expose, not a guarantee.
 */
const firstVolumePath = async (ctx: DeviceContext): Promise<Result<string>> => {
  const volumes = await system.listVolumes(ctx)
  if (isErr(volumes)) return volumes
  const first = volumes.value[0]
  if (first === undefined) {
    return {
      ok: false,
      error: {
        kind: 'malformed-response',
        message: 'the device reports no storage volumes — nothing to list',
        i18nKey: 'error.malformedResponse',
      },
    }
  }
  return { ok: true, value: first.path }
}

const PROBES: readonly ParserProbe[] = [
  {
    reader: 'apps.listApps',
    asks: 'the installed-app list parses into tiles the Apps screen can render',
    call: async (ctx) =>
      summarise(
        await apps.listApps(ctx),
        (tiles) =>
          `${tiles.length} app(s); ${tiles.filter((t) => t.port !== null).length} with a published port`,
      ),
  },
  {
    reader: 'system.readDeviceInfo',
    asks: 'the dashboard identity fields parse',
    call: async (ctx) =>
      summarise(await system.readDeviceInfo(ctx), (info) => `model=${info.model || '(empty)'}`),
  },
  {
    reader: 'system.readUtilization',
    asks: 'the dashboard load figures parse',
    call: async (ctx) =>
      summarise(
        await system.readUtilization(ctx),
        (u) => `cpu=${Math.round(u.cpuPercent)}% mem=${Math.round(u.memoryPercent)}%`,
      ),
  },
  {
    reader: 'system.listVolumes',
    asks: 'the storage list parses',
    call: async (ctx) =>
      summarise(await system.listVolumes(ctx), (v) => `${v.length} volume(s)`),
  },
  {
    reader: 'system.powerSample',
    asks: 'cpu watts are derived from two counter readings and land in a plausible range',
    call: async (ctx) => {
      // The dashboard once printed "10251150514 W" because a cumulative microjoule counter
      // was labelled as power. This probe asserts the fix at both ends: the counter still
      // grows, and the derived figure is a wattage a CPU could actually draw.
      const first = await system.readUtilization(ctx)
      if (isErr(first)) return first
      await new Promise((resolve) => setTimeout(resolve, 4_000))
      const second = await system.readUtilization(ctx)
      if (isErr(second)) return second

      const e1 = first.value.cpuEnergyMicrojoules
      const e2 = second.value.cpuEnergyMicrojoules
      if (e1 === null || e2 === null) return { ok: true, value: 'device reports no cpu energy' }

      const watts = second.value.cpuPowerWatt
      const firstWatts = first.value.cpuPowerWatt
      const plausible = watts !== null && watts > 0 && watts < 1_000
      const detail =
        `counter ${e1} -> ${e2} (delta ${e2 - e1} uJ); ` +
        `first reading watts=${String(firstWatts)}; second=${watts === null ? 'null' : watts.toFixed(1) + ' W'}`

      // A wattage outside anything a CPU draws is the failure this exists to catch — and so
      // is a number on the FIRST reading, which would mean it was invented from one sample.
      if (firstWatts !== null) {
        return {
          ok: false,
          error: {
            kind: 'malformed-response',
            message: `power reported from a single counter reading: ${detail}`,
            i18nKey: 'error.malformedResponse',
          },
        }
      }
      if (!plausible) {
        return {
          ok: false,
          error: {
            kind: 'malformed-response',
            message: `implausible cpu power: ${detail}`,
            i18nKey: 'error.malformedResponse',
          },
        }
      }
      return { ok: true, value: detail }
    },
  },
  {
    reader: 'files.listDirectory',
    asks: 'a real directory listing parses into rows',
    call: async (ctx) => {
      const root = await firstVolumePath(ctx)
      if (isErr(root)) return root
      return summarise(
        await files.listDirectory(ctx, { path: root.value }),
        (page) => `${page.entries.length} entr(ies) under ${root.value}`,
      )
    },
  },
  {
    reader: 'files.listTasks',
    asks: 'the transfer-task list parses (empty is a valid answer)',
    call: async (ctx) =>
      summarise(await files.listTasks(ctx), (tasks) => `${tasks.length} task(s)`),
  },
  {
    reader: 'files.listTrash',
    asks: 'the trash listing parses',
    call: async (ctx) =>
      summarise(await files.listTrash(ctx), (entries) => `${entries.length} entr(ies)`),
  },
  {
    reader: 'files.listPins',
    asks: 'the favourites list parses',
    call: async (ctx) => summarise(await files.listPins(ctx), (pins) => `${pins.length} pin(s)`),
  },
  {
    reader: 'photos.galleryPage',
    asks: 'a gallery page parses into thumbnails',
    requires: 'photos',
    call: async (ctx) =>
      summarise(
        await photos.galleryPage(ctx, { limit: 24 }),
        (page) => `${page.assets.length} asset(s) of ${page.total}`,
      ),
  },
  {
    reader: 'photos.search',
    asks: 'semantic search returns hits for a plain everyday word',
    requires: 'photos',
    call: async (ctx) =>
      summarise(
        await photos.search(ctx, 'sunset'),
        // Counting, because 200-with-zero-hits is exactly how a working endpoint over an
        // empty semantic index looks — indistinguishable from a broken query unless the
        // number is written down.
        (r) => `${r.hits.length} hit(s) of ${r.total} for "sunset" in ${r.tookMs}ms`,
      ),
  },
  {
    reader: 'photos.readProgress',
    asks: 'the index-progress figures parse',
    requires: 'photos',
    call: async (ctx) =>
      summarise(
        await photos.readProgress(ctx),
        (p) =>
          `status=${p.status} ${p.processedImages}/${p.totalImages} images; ` +
          `semantic search ready=${p.semanticSearch.ready} enabled=${p.semanticSearch.enabled} ` +
          `state=${p.semanticSearch.status} missing=[${p.semanticSearch.missing.join(',')}]`,
      ),
  },
]

export const runParserProbes = async (
  ctx: DeviceContext,
  options: { readonly photosModule: boolean },
  report: (line: string) => void,
): Promise<readonly ParserMeasurement[]> => {
  const measurements: ParserMeasurement[] = []

  for (const probe of PROBES) {
    if (probe.requires === 'photos' && !options.photosModule) {
      measurements.push({
        reader: probe.reader,
        asks: probe.asks,
        ok: true,
        detail: 'not applicable on this device',
        ms: null,
        skipped: 'photos module not registered on this device',
      })
      report(`  SKIP  ${probe.reader.padEnd(24)} (no photos module)`)
      continue
    }

    const started = Date.now()
    // A reader that throws instead of returning an error is itself the finding: the
    // Result contract says it must not. Caught here so one broken reader cannot hide
    // the verdict of every reader after it.
    let outcome: Result<string>
    try {
      outcome = await probe.call(ctx)
    } catch (cause) {
      outcome = {
        ok: false,
        error: {
          kind: 'internal',
          message: `reader threw instead of returning an error: ${String(cause)}`,
          i18nKey: 'error.internal',
        },
      }
    }
    const ms = Date.now() - started

    if (isErr(outcome)) {
      measurements.push({
        reader: probe.reader,
        asks: probe.asks,
        ok: false,
        detail: `${outcome.error.kind} — ${outcome.error.message}`,
        ms,
      })
      report(`  FAIL  ${probe.reader.padEnd(24)} ${outcome.error.kind}: ${outcome.error.message}`)
      continue
    }

    measurements.push({
      reader: probe.reader,
      asks: probe.asks,
      ok: true,
      detail: outcome.value,
      ms,
    })
    report(`   ok   ${probe.reader.padEnd(24)} ${outcome.value}  ${ms}ms`)
  }

  return measurements
}
