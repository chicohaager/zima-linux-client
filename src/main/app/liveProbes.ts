import { APPS, BASE, FILES, PHOTOS, STORAGE, SYS, SYSTEM, USERS, ZT } from '@main/zima/endpoints'

/**
 * The probe table for `npm run verify:live` — Plan § 11.3.
 *
 * Purpose: every path this client talks to must be covered by a run against a real device,
 * so each verification comment in `endpoints.ts` is backed by a measurement instead of by
 * a habit. The tool reports `METHOD PATH -> STATUS BYTES` plus the *shape* of the answer,
 * never its values.
 *
 * Three rules encoded here:
 *
 *  - **Read-only by default.** A probe that changes the device (power state, ZeroTier
 *    status, emptying the trash) is not in this table. Measuring a thing must not be the
 *    thing.
 *  - **Write probes are opt-in and confined.** `verify:live --write` adds probes that
 *    create, list, copy and trash a file inside one scratch folder and then remove it.
 *    They are the only way to learn a request-body shape the shipped SDK does not reveal.
 *  - **Corrections stay measured.** The last group re-fires the paths that were wrong in
 *    an earlier version of `endpoints.ts`. They are expected to answer 404, and keeping
 *    them in the table means the correction is re-proved on every run rather than resting
 *    on a comment.
 */

export interface Probe {
  /** Stable id — also the key in the report, so a diff between runs is readable. */
  readonly id: string
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** Full gateway path, base included. Never a service port. */
  readonly path: string
  readonly query?: Readonly<Record<string, string | number>>
  readonly body?: unknown
  /** Set when the endpoint only exists with an optional module. */
  readonly requires?: 'photos'
  /** What this probe establishes, in one line, for the report. */
  readonly asks: string
  /**
   * Status this probe is expected to produce, when there is a defensible expectation.
   * Used for the report's summary only — an unexpected status is reported, never hidden,
   * and never turned into a tool failure: a status IS the measurement.
   */
  readonly expect?: number
}

const files = (path: string): string => `${BASE.files}${path}`
const zimaos = (path: string): string => `${BASE.zimaos}${path}`
const photos = (path: string): string => `${BASE.photos}${path}`

/**
 * A directory every ZimaOS device has: the storage root the shipped UI itself opens
 * (`/media/ZimaOS-HD` is the root of its folder picker). Only ever listed, never written.
 */
export const PROBE_ROOT = '/media/ZimaOS-HD'

const FILES_PROBES: readonly Probe[] = [
  {
    id: 'files.list-root',
    method: 'GET',
    path: files(FILES.entry),
    query: { path: PROBE_ROOT, index: 1, size: 10, sort: 'name', direction: 'asc' },
    expect: 200,
    asks: 'directory listing shape, and whether index/size/sort/direction are accepted',
  },
  {
    id: 'files.list-nonexistent',
    method: 'GET',
    path: files(FILES.entry),
    query: { path: `${PROBE_ROOT}/zima-client-does-not-exist-4a7f`, index: 1, size: 10 },
    expect: 404,
    asks: 'negative control — a missing path must not answer like an empty folder',
  },
  {
    id: 'files.upload-info',
    method: 'GET',
    path: files(FILES.uploadInfo),
    query: { path: PROBE_ROOT },
    asks: 'upload limits and chunk parameters before the first upload is attempted',
  },
  {
    id: 'files.search-status',
    method: 'GET',
    path: files(FILES.searchStatus),
    expect: 200,
    asks: 'proves /file/search is an indexer status, not a query interface',
  },
  { id: 'files.trash-list', method: 'GET', path: files(FILES.trash), expect: 200, asks: 'trash listing shape' },
  { id: 'files.trash-stats', method: 'GET', path: files(FILES.trashStats), expect: 200, asks: 'trash size/count shape' },
  { id: 'files.pin-list', method: 'GET', path: files(FILES.pin), expect: 200, asks: 'favourites shape' },
  {
    id: 'files.share-list',
    method: 'GET',
    path: files(FILES.shareList),
    query: { path: PROBE_ROOT },
    asks: 'SMB share listing for a path',
  },
  {
    id: 'files.task-list',
    method: 'GET',
    path: files(FILES.tasks),
    query: { visible: 'true' },
    expect: 200,
    asks: 'task list shape — real progress instead of an endless spinner',
  },
]

const SYSTEM_PROBES: readonly Probe[] = [
  {
    id: 'sys.hardware',
    method: 'GET',
    path: `${BASE.sys}${SYS.hardware}`,
    asks: 'CPU/memory/board fields for the dashboard — under /v1/sys, not /v2/zimaos',
  },
  {
    id: 'sys.utilization',
    method: 'GET',
    path: `${BASE.sys}${SYS.utilization}`,
    asks: 'live CPU/RAM/temperature values for the dashboard',
  },
  {
    id: 'system.device-info',
    method: 'GET',
    path: zimaos(SYSTEM.deviceInfo),
    expect: 200,
    asks: 'device name, model, arch and OS version',
  },
  {
    id: 'system.network-interfaces',
    method: 'GET',
    path: zimaos(SYSTEM.networkInterfaces),
    expect: 200,
    asks: 'interface list — the honest source for "which address am I reachable on"',
  },
  {
    id: 'storage.stats',
    method: 'GET',
    path: `${BASE.localStorage}${STORAGE.stats}`,
    asks: 'used/total bytes for the storage card — under /v2/local_storage',
  },
  {
    id: 'storage.storages',
    method: 'GET',
    path: `${BASE.localStorage}${STORAGE.storages}`,
    query: { all: 'true' },
    asks: 'volume list behind the storage section',
  },
  {
    id: 'users.current',
    method: 'GET',
    path: `${BASE.users}${USERS.current}`,
    asks: 'account fields — avatar, nickname, role — for the dashboard header',
  },
  {
    id: 'zt.info',
    method: 'GET',
    path: zimaos(ZT.info),
    asks: 'ZeroTier state — 200 with a network, or 500 when the daemon is down',
  },
]

const APPS_PROBES: readonly Probe[] = [
  {
    id: 'apps.installed-list',
    method: 'GET',
    path: `${BASE.appManagement}${APPS.installedList}`,
    asks: 'installed app list shape: status, icon, web ui — NOT /myapps',
  },
  {
    id: 'apps.app-grid',
    method: 'GET',
    path: `${BASE.appManagement}${APPS.appGrid}`,
    asks: 'the tile grid the web UI home screen uses',
  },
]

const PHOTOS_PROBES: readonly Probe[] = [
  {
    id: 'photos.progress',
    method: 'GET',
    path: photos(PHOTOS.progress),
    requires: 'photos',
    expect: 200,
    asks: 'index progress, so "0 hits" can be explained instead of looking like a bug',
  },
  {
    id: 'photos.gallery-stream',
    method: 'GET',
    path: photos(PHOTOS.galleryStream),
    query: { media_types: 'img,video', limit: 10, collapse_groups: 'true' },
    requires: 'photos',
    expect: 200,
    asks: 'gallery page shape with the MEASURED parameter names (limit, not page_size)',
  },
  {
    id: 'photos.gallery-facets',
    method: 'GET',
    path: photos(PHOTOS.galleryFacets),
    query: { media_types: 'img,video', lang: 'de-DE', locale: 'de_DE' },
    requires: 'photos',
    expect: 200,
    asks: 'facet buckets for the filter row',
  },
  {
    id: 'photos.search',
    method: 'POST',
    path: photos(PHOTOS.search),
    body: { query: 'sunset' },
    requires: 'photos',
    expect: 200,
    asks: 'semantic search result shape for a body of exactly {query}',
  },
  {
    id: 'photos.search-extra-key',
    method: 'POST',
    path: photos(PHOTOS.search),
    body: { query: 'sunset', limit: 5 },
    requires: 'photos',
    expect: 400,
    asks: 'negative control — an extra top-level key is rejected (DisallowUnknownFields)',
  },
]

/**
 * The paths an earlier version of this client believed in. Each one is expected to answer
 * 404, which is what exposed them. They stay in the table so the correction is re-measured
 * instead of remembered.
 */
const CORRECTED_PROBES: readonly Probe[] = [
  {
    id: 'corrected.zimaos-sys-hardware',
    method: 'GET',
    path: zimaos('/sys/hardware'),
    expect: 404,
    asks: 'hardware is NOT under /v2/zimaos — this must stay 404',
  },
  {
    id: 'corrected.zimaos-storage-stats',
    method: 'GET',
    path: zimaos('/storage/stats'),
    expect: 404,
    asks: 'storage stats are NOT under /v2/zimaos',
  },
  {
    id: 'corrected.app-myapps',
    method: 'GET',
    path: `${BASE.appManagement}/myapps`,
    expect: 404,
    asks: 'there is no /myapps — the installed list is /installed/list',
  },
  {
    id: 'corrected.v1-apps',
    method: 'GET',
    path: '/v1/apps',
    expect: 404,
    asks: 'the v1 app list does not exist on v1.7.0',
  },
]

export const READ_PROBES: readonly Probe[] = [
  ...FILES_PROBES,
  ...SYSTEM_PROBES,
  ...APPS_PROBES,
  ...PHOTOS_PROBES,
  ...CORRECTED_PROBES,
]

/**
 * Write probes, only with `--write`.
 *
 * Everything happens inside `<PROBE_ROOT>/zima-client-verify-<stamp>`, so the run cannot
 * touch anything the user cares about, and the folder is removed at the end. The stamp
 * comes from outside because a fixed name would collide with an interrupted earlier run.
 *
 * Each body below is a *candidate* shape: the shipped SDK proves the path and the method
 * but carries no request schema, so the shape is what the measurement decides. A 400 here
 * is a result, not a failure — it tells us the field names are different, and the report
 * says so instead of the client shipping a guess.
 */
export const writeProbes = (scratch: string, fileName: string): readonly Probe[] => [
  {
    id: 'write.create-folder',
    method: 'POST',
    path: files(FILES.folder),
    body: { path: scratch },
    asks: 'body shape of folder creation (measured call site in the UI: {path})',
  },
  {
    id: 'write.create-file',
    method: 'POST',
    path: files(FILES.entry),
    body: { path: `${scratch}/${fileName}` },
    asks: 'body shape of file creation',
  },
  {
    id: 'write.list-scratch',
    method: 'GET',
    path: files(FILES.entry),
    query: { path: scratch, index: 1, size: 10 },
    expect: 200,
    asks: 'positive control — the created entry must actually appear in the listing',
  },
  {
    id: 'write.copy-task-enum-probe',
    method: 'POST',
    path: files(FILES.taskCopy),
    // Deliberately invalid `user_select`: the OpenAPI validator answers with the list of
    // values it accepts, which is a far better source for an enum than picking the string
    // that sounds right. Expected to be rejected — that rejection IS the measurement.
    body: {
      src: [`${scratch}/${fileName}`],
      dst: scratch,
      user_select: 'zima-client-invalid-on-purpose',
    },
    expect: 400,
    asks: 'the allowed values of user_select, read off the validator instead of guessed',
  },
  {
    id: 'write.copy-task',
    method: 'POST',
    path: files(FILES.taskCopy),
    // Measured 2026-07-30, two rejections deep: `{src_files, dst}` answered `Error at
    // "/src": property "src" is missing`, then `{src, dst}` answered `Error at
    // "/user_select": property "user_select" is missing`. The gateway validates against
    // its OpenAPI schema and names the field it wants, so this shape was read off the
    // device rather than invented. `user_select` is the conflict policy.
    body: { src: [`${scratch}/${fileName}`], dst: scratch, user_select: 'skip' },
    asks: 'body shape of the copy task, and the task id it returns',
  },
  {
    id: 'write.move-to-trash',
    method: 'DELETE',
    path: files(FILES.moveToTrash),
    // Measured: an object body answers `value must be an array`. The body is a bare array
    // of paths — worth having in a comment, because "delete takes an object" is the
    // assumption every other endpoint here would suggest.
    body: [`${scratch}/${fileName}`],
    asks: 'body shape for moving to trash rather than deleting outright',
  },
  {
    id: 'write.delete-folder',
    method: 'DELETE',
    path: files(FILES.folder),
    body: [scratch],
    asks: 'cleanup — and the body shape of folder deletion (also a bare array)',
  },
]

/**
 * Deletes folders left behind by an interrupted run.
 *
 * Exists because the first `--write` run could not clean up: its delete body was the wrong
 * shape, so two scratch folders stayed on the device. A measurement tool that can litter
 * needs a way to tidy up through the same API it is measuring — deleting them by hand over
 * SSH would have hidden the fact that the client's delete path was broken.
 */
export const cleanupProbes = (paths: readonly string[]): readonly Probe[] =>
  paths.map((path, index) => ({
    id: `cleanup.folder-${index}`,
    method: 'DELETE' as const,
    path: files(FILES.folder),
    body: [path],
    expect: 200,
    asks: 'removes a scratch folder from an earlier interrupted run',
  }))
