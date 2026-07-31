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
import { handle, wireError, withDevice } from './wire'

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

export const registerAppsHandlers = (): void => {
  handle(CHANNELS.appsList, async () => {
    const host = session.activeHost()
    const deviceId = registry.activeDeviceId()
    if (host === null || deviceId === null) {
      return wireError(appError('unauthorized', 'no active device', 'error.signInRequired'))
    }

    const fresh = await withDevice((ctx) => appsApi.listApps(ctx))
    if (fresh.ok) {
      appsCache.write(deviceId, fresh.value)
      return ok({ apps: fresh.value.map((tile) => toWireTile(tile, host)), cachedAtMs: null })
    }

    const cached = appsCache.read(deviceId)
    if (cached === null) {
      // Nothing cached and the device did not answer: the real error goes through. An empty
      // list here would read as "you have no apps installed".
      return fresh
    }
    logger.info('apps.served-from-cache', { deviceId, kind: fresh.error.kind })
    return ok({
      apps: cached.apps.map((tile) => toWireTile(tile, host)),
      cachedAtMs: cached.cachedAtMs,
    })
  })

  handle(CHANNELS.appsSetRunning, async (input) => {
    const { id, running } = input as { id: string; running: boolean }
    return withDevice(async (ctx) => {
      const changed = await appsApi.setAppRunning(ctx, { id, running })
      return isErr(changed) ? changed : ok({ id, running })
    })
  })

  handle(CHANNELS.appsOpenWebUi, async (input) => {
    const { id, external } = input as { id: string; external: boolean }
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
    openInWindow({ url, title: appsApi.preferredTitle(tile, 'en_us') })
    return ok({ opened: 'window' as const })
  })
}
