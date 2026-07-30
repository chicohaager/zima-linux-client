/**
 * Real gateway route tables, captured 2026-07-30 from two ZimaCube hosts that were
 * BOTH running ZimaOS v1.7.0.
 *
 * They are checked in as two separate fixtures on purpose. A single-device fixture
 * would build a simpler world than production: the whole point of these two is that
 * the same OS version can expose a different feature surface. `withoutPhotos` is not
 * a hypothetical — it is a real host where /usr/bin/zimaos-photos does not exist.
 */

/** Host A: 35 routes, no /v2/photos, no /v2/zfw, no /cron. */
export const ROUTES_WITHOUT_PHOTOS: readonly string[] = [
  '/.well-known/jwks.json',
  '/doc/v2/backup',
  '/doc/v2/files',
  '/doc/v2/message_bus',
  '/v1/app-categories',
  '/v1/apps',
  '/v1/container',
  '/v1/gateway',
  '/v1/other',
  '/v1/sys',
  '/v1/users',
  '/v1/zt',
  '/v2/app_management',
  '/v2/backup',
  '/v2/dashboard',
  '/v2/file',
  '/v2/filedrop',
  '/v2/files',
  '/v2/folder',
  '/v2/installer',
  '/v2/local_storage',
  '/v2/message_bus',
  '/v2/migration',
  '/v2/mod_management',
  '/v2/pin',
  '/v2/settings',
  '/v2/share',
  '/v2/trash',
  '/v2/users',
  '/v2/virt_management',
  '/v2/vm_extras',
  '/v2/zimaos',
  '/v2_1/files',
  '/v3/app_store',
  '/v3/file',
]

/** Host B: 38 routes — same OS build, plus /v2/photos, /v2/zfw and /cron. */
export const ROUTES_WITH_PHOTOS: readonly string[] = [
  ...ROUTES_WITHOUT_PHOTOS,
  '/v2/photos',
  '/v2/zfw',
  '/cron',
]

/** Raw gateway payload shape, as the endpoint really returns it. */
export const rawPayload = (paths: readonly string[]): unknown =>
  paths.map((path, i) => ({ path, target: `http://127.0.0.1:${32000 + i}` }))
