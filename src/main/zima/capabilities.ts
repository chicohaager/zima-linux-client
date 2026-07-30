import type { Capabilities } from '@shared/domain'
import { BASE } from './endpoints'

/**
 * Route table -> capability set.
 *
 * The gateway answers `GET /v1/gateway/routes` over the LAN address without any
 * auth (measured: HTTP 200), which makes it the cheapest and most honest way to
 * learn what a device offers before logging in.
 */

/** Shape of one entry as returned by the gateway. */
export interface GatewayRoute {
  readonly path: string
  readonly target?: string
}

const hasRoute = (routes: readonly string[], base: string): boolean =>
  routes.some((r) => r === base || r.startsWith(`${base}/`))

/**
 * Photo browsing and backup deliberately do NOT depend on the photos module:
 * both are expressed through the files API (listing + `/thumbnail` + upload), so
 * the Photos section stays fully usable on devices where the module is absent.
 * Only semantic search and facets need `/v2/photos`.
 */
export const deriveCapabilities = (routes: readonly string[]): Capabilities => {
  const files = hasRoute(routes, BASE.files)
  return {
    photoLibrary: hasRoute(routes, BASE.photos),
    photoBrowse: files,
    photoBackup: files,
    files,
    apps: hasRoute(routes, BASE.appManagement) || hasRoute(routes, BASE.apps),
    appStore: hasRoute(routes, '/v3/app_store'),
    systemPower: hasRoute(routes, BASE.zimaos),
    zerotier: hasRoute(routes, BASE.zt),
    backup: hasRoute(routes, '/v2/backup'),
    routes,
  }
}

/**
 * Parses the gateway payload defensively. A route table we cannot understand is an
 * error, not an empty list — an empty capability set would silently disable every
 * feature and look like "this device can do nothing".
 */
export const parseRoutes = (payload: unknown): readonly string[] | null => {
  const rows = Array.isArray(payload)
    ? payload
    : typeof payload === 'object' && payload !== null && 'data' in payload
      ? (payload as { data: unknown }).data
      : null

  if (!Array.isArray(rows)) return null

  const paths = rows
    .map((row) =>
      typeof row === 'object' && row !== null && 'path' in row
        ? (row as GatewayRoute).path
        : null,
    )
    .filter((p): p is string => typeof p === 'string' && p.length > 0)

  return paths.length > 0 ? paths : null
}
