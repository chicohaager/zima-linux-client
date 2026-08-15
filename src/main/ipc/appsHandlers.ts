import { shell } from 'electron'
import { CHANNELS } from '@shared/contract'
import type { AppTile } from '@shared/domain'
import { mediaUrl } from '@shared/media'
import { appError, isErr, ok } from '@shared/result'
import * as appsApi from '@main/zima/apps'
import * as appsCache from '@main/cache/appsCache'
import * as registry from '@main/devices/registry'
import * as session from '@main/session'
import { openInWindow } from '@main/app/appWindow'
import { logger } from '@main/logging/logger'
import { handle, wireError, withDevice, type Wire } from './wire'

/**
 * Apps: the installed list, start/stop, and opening an app's web UI.
 *
 * The list is served fresh when the device answers and from the cache when it does not —
 * always with `cachedAtMs` so the UI can date it. Never silently: a stale list presented as
 * current would show a stopped app as running.
 */

/** What the renderer receives: device fields plus URLs it may actually use. */
const toWireTile = (tile: AppTile, host: string): {
  id: string
  name: string
  title: Record<string, string>
  status: string
  installStatus: string
  port: number | null
  scheme: string
  index: string
  appType: string
  iconUrl: string | null
  webUiUrl: string | null
} => {
  // Every icon the metadata names, wherever it lives — requested 2026-07-30, because
  // restricting icons to the device's own host left 16 of 18 tiles showing a bare letter.
  // The fetch itself happens in `media/protocol.ts`, from the main process, without
  // credentials and only for real images; see the note there for the trade-off.
  //
  // Null still means "draw the initial", but now only when there is genuinely nothing to
  // load — an empty field or an unparseable URL, both logged rather than swallowed.
  let iconUrl: string | null = null
  if (tile.iconUrl.length > 0) {
    try {
      // Parsed here purely to reject junk early: an unparseable URL would otherwise travel
      // all the way to the protocol handler to fail there, per tile, on every render.
      new URL(tile.iconUrl)
      iconUrl = mediaUrl('appicon', tile.iconUrl)
    } catch {
      logger.info('apps.icon-unparseable', { app: tile.name })
    }
  }
  return {
    id: tile.id,
    name: tile.name,
    title: tile.title,
    status: tile.status,
    installStatus: tile.installStatus,
    port: tile.port,
    scheme: tile.scheme,
    index: tile.index,
    appType: tile.appType,
    iconUrl,
    webUiUrl: appsApi.webUiUrl(tile, host),
  }
}

/**
 * 🔴 How long the Apps screen may stay empty when there ARE tiles on disk.
 *
 * Reported 2026-07-31: "Apps says loading for ages". The client's own request log named it —
 * `installed/list` took 3 141 ms once and later hit the 8 s limit
 * (`request-failed … ms:8002 … aborted`), and only THEN did the cache get served. The tiles
 * were on disk the whole time; this process was holding them back.
 *
 * The endpoint is not the problem, and that was measured before anything was changed here.
 * `npm run verify:live` over the same tunnel, with the real session token:
 *
 *   installed/list            200   12 ms   22 699 B   <- what this calls
 *   web/appgrid               200  113 ms    6 680 B   <- what the device's own web UI uses
 *   installed/list?mode=async 202    7 ms    9 148 B
 *   installed/list?mode=sync  200    9 ms   22 699 B
 *
 * So switching to the endpoint the web UI uses — the obvious "how do the other clients do
 * it" answer — would have changed nothing and made the common case ten times slower. The
 * stalls are occasional, and their cause is NOT identified.
 *
 * Which is exactly why the fix is here and not there: whatever makes a refresh slow, an app
 * list that is already known must not wait for it. 700 ms is above a healthy answer by a
 * factor of fifty, so a working device still renders fresh data on the first paint and the
 * "as of 09:14" line stays rare.
 */
const FIRST_PAINT_MS = 700

/**
 * One refresh in flight per device, shared by every caller.
 *
 * Without this the renderer's polling (it asks again while it is showing dated tiles) would
 * start a second request against a device that is already struggling to answer the first.
 */
let refreshing: Promise<Wire<readonly AppTile[]>> | null = null

const refreshApps = (deviceId: string): Promise<Wire<readonly AppTile[]>> => {
  if (refreshing !== null) return refreshing
  refreshing = withDevice((ctx) => appsApi.listApps(ctx))
    .then((answer) => {
      // Written even when nobody is waiting any more: that is what makes the NEXT first
      // paint current instead of dated.
      if (answer.ok) appsCache.write(deviceId, answer.value)
      return answer
    })
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

/** Resolves to `null` after `ms`, and never keeps the process alive on its own. */
const after = (ms: number): Promise<null> =>
  new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), ms).unref()
  })

export const registerAppsHandlers = (): void => {
  handle(CHANNELS.appsList, async () => {
    const host = session.activeHost()
    const deviceId = registry.activeDeviceId()
    if (host === null || deviceId === null) {
      return wireError(appError('unauthorized', 'no active device', 'error.signInRequired'))
    }

    const refresh = refreshApps(deviceId)
    const cached = appsCache.read(deviceId)

    if (cached === null) {
      // First run on this device: there is nothing to show, so waiting is the only honest
      // option. An empty list here would read as "you have no apps installed".
      const fresh = await refresh
      if (!fresh.ok) return fresh
      return ok({ apps: fresh.value.map((tile) => toWireTile(tile, host)), cachedAtMs: null })
    }

    const winner = await Promise.race([refresh, after(FIRST_PAINT_MS)])
    if (winner !== null && winner.ok) {
      return ok({ apps: winner.value.map((tile) => toWireTile(tile, host)), cachedAtMs: null })
    }
    /*
     * Dated tiles, and dated is what the UI will say — `cachedAtMs` travels with them and
     * becomes "as of 09:14". A cache shown as live state would report a stopped app as
     * running; that rule is older than this change and survives it.
     *
     * `kind` separates the two cases in the log, because they need different answers: a
     * refresh that is merely still running is the normal fast path doing its job, a refresh
     * that failed is a device problem.
     */
    logger.info('apps.served-from-cache', {
      deviceId,
      kind: winner === null ? 'still-refreshing' : winner.error.kind,
    })
    return ok({
      apps: cached.apps.map((tile) => toWireTile(tile, host)),
      cachedAtMs: cached.cachedAtMs,
    })
  })

  handle(CHANNELS.appsSetRunning, async (input) => {
    const { id, running } = input
    return withDevice(async (ctx) => {
      const changed = await appsApi.setAppRunning(ctx, { id, running })
      return isErr(changed) ? changed : ok({ id, running })
    })
  })

  handle(CHANNELS.appsOpenWebUi, async (input) => {
    const { id, external, labels } = input
    const host = session.activeHost()
    if (host === null) {
      return wireError(appError('unauthorized', 'no active device', 'error.signInRequired'))
    }

    // The address is resolved from the CURRENT list, not from anything the renderer sent.
    // A URL passed across IPC would let the renderer ask the main process to open any page.
    const listed = await withDevice((ctx) => appsApi.listApps(ctx))
    if (!listed.ok) return listed

    const tile = listed.value.find((candidate) => candidate.id === id)
    if (tile === undefined) {
      return wireError(appError('not-found', `no app with id ${id}`, 'error.appNotFound', { id }))
    }
    const url = appsApi.webUiUrl(tile, host)
    if (url === null) {
      return wireError(
        appError('capability-missing', `app ${id} publishes no web ui`, 'error.appHasNoWebUi', { id }),
      )
    }

    if (external) {
      await shell.openExternal(url)
      return ok({ opened: 'browser' as const })
    }
    openInWindow({ url, title: appsApi.preferredTitle(tile, 'en_us'), labels })
    return ok({ opened: 'window' as const })
  })
}
