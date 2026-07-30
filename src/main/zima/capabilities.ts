import type { Capabilities, ZerotierState } from '@shared/domain'
import { isErr, type Result } from '@shared/result'
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
    // Deliberately NOT derived from the route table. `/v1/zt` is present on hosts where
    // the ZeroTier daemon is not running at all — measured 2026-07-30: one host answered
    // `/v2/zimaos/zt/info` with 200 and status "online", the other with 500 and
    // "dial tcp 127.0.0.1:9993: connect: connection refused". Route presence was a proxy
    // signal, and it showed a green "available" for a feature that could not be used.
    // 'unknown' means nobody has asked the device yet; `probeZerotier` replaces it.
    zerotier: 'unknown',
    backup: hasRoute(routes, '/v2/backup'),
    routes,
  }
}

/**
 * Asks the device whether ZeroTier actually works, instead of inferring it.
 *
 * Needs an access token, so it runs after sign-in — the route table alone cannot answer
 * this. The three outcomes are kept apart because they call for different words in the UI:
 * "connected", "installed but switched off", "this device does not offer it".
 */
export const probeZerotier = async (
  fetchInfo: () => Promise<Result<unknown>>,
): Promise<ZerotierState> => {
  const result = await fetchInfo()
  if (isErr(result)) {
    // A 500 whose message names port 9993 is the daemon being down — a different statement
    // from "the endpoint is missing", and the user can act on it (enable it on the device).
    const text = `${result.error.message} ${JSON.stringify(result.error.context ?? {})}`
    if (text.includes('9993') || text.includes('connection refused')) return { kind: 'not-running' }
    if (result.error.kind === 'unexpected-status') return { kind: 'absent' }
    return { kind: 'unreachable', reason: result.error.i18nKey }
  }

  const info = result.value as Partial<Record<'id' | 'ip' | 'name' | 'status', unknown>> | null
  const id = typeof info?.id === 'string' ? info.id : null
  const ip = typeof info?.ip === 'string' ? info.ip : null
  const name = typeof info?.name === 'string' ? info.name : null
  const status = typeof info?.status === 'string' ? info.status : null
  if (id === null || status === null) {
    // Answering 200 with a shape we do not know must not read as "online".
    return { kind: 'unreachable', reason: 'error.malformedResponse' }
  }
  return { kind: status === 'online' ? 'online' : 'offline', networkId: id, ip, networkName: name }
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
