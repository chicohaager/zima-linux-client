import { z } from 'zod'
import type { AppTile } from '@shared/domain'
import { appError, err, isErr, ok, type Result } from '@shared/result'
import { authed, type DeviceContext } from './client'
import { APPS, BASE } from './endpoints'
import { isPrivateHostLiteral } from '@main/media/urlPolicy'

/**
 * The installed apps.
 *
 * live 2026-07-30: `GET /v2/app_management/installed/list` -> `{data:[{id,name,title{…},
 * icon,port,scheme,status,install_status,index,app_type,containers:[…]}]}` — 18 apps on the
 * measured host. `/myapps`, which the plan named, answers **404 "no matching operation was
 * found"**: it never existed.
 *
 * `title` is a locale map (`{en_us, de_de, custom}`), so a German session can show the
 * app's own German title. Falling back to the English one is a deliberate, visible choice
 * in `preferredTitle` rather than an accident of key order.
 */

const appSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  title: z.record(z.string(), z.string()).nullable().optional(),
  icon: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  install_status: z.string().nullable().optional(),
  port: z.union([z.string(), z.number()]).nullable().optional(),
  scheme: z.string().nullable().optional(),
  index: z.string().nullable().optional(),
  app_type: z.string().nullable().optional(),
})

const port = (value: string | number | null | undefined): number | null => {
  if (value === null || value === undefined) return null
  const numeric = typeof value === 'number' ? value : Number.parseInt(value, 10)
  return Number.isInteger(numeric) && numeric > 0 && numeric <= 65_535 ? numeric : null
}

/**
 * An icon URL the device hands out, made reachable from wherever this client actually sits.
 *
 * 🔴 Measured 2026-07-31 over a Remote-ID connection: two tiles showed a bare letter while
 * the rest had logos. Their icons are hosted by the apps themselves and the device names
 * them by its **LAN** address (`http://<device-lan>:8086/static/logo.png`,
 * `…:8718/icon.svg`). From a laptop on the tunnel that address is both refused — a foreign
 * private host, see `urlPolicy` — and genuinely unreachable. Same fact, two independent
 * reasons to fail.
 *
 * So the host is replaced by the one this client is actually talking to, exactly as
 * `webUiUrl` below already does for the "open in browser" button and for the same reason:
 * the device writes those URLs for a browser standing on its own network.
 *
 * **Only when the port matches the app's own published port.** That is what makes this a
 * rewrite of *this app's* icon rather than a general redirect of any private address onto
 * the device — an icon field saying `http://192.168.1.1/reboot` (the router) keeps pointing
 * at the router and stays refused, instead of being aimed at the device.
 *
 * Verified over the tunnel before this was written: both rewritten URLs answer 200 with
 * `image/png` (1 499 594 bytes) and `image/svg+xml` (260 bytes).
 */
export const reachableIconUrl = (
  rawIcon: string,
  tilePort: number | null,
  deviceHost: string,
): string => {
  if (rawIcon.length === 0) return rawIcon
  let url: URL
  try {
    url = new URL(rawIcon)
  } catch {
    // Not a URL at all — handed on untouched so the media policy refuses it and says so,
    // rather than being silently repaired into something that was never meant.
    return rawIcon
  }
  if (url.hostname.toLowerCase() === deviceHost.toLowerCase()) return rawIcon
  if (!isPrivateHostLiteral(url.hostname)) return rawIcon
  if (tilePort === null) return rawIcon
  const iconPort = url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port)
  if (iconPort !== tilePort) return rawIcon
  url.hostname = deviceHost
  return url.toString()
}

const toTile = (raw: z.infer<typeof appSchema>, deviceHost: string): AppTile => ({
  id: raw.id,
  name: raw.name,
  title: raw.title ?? {},
  // A full URL on the device, often pointing at a CDN. Never loaded by the renderer — it
  // goes through the media protocol, so a broken or hostile icon URL cannot reach the
  // renderer's network context. Only the host is touched, and only in the narrow case
  // `reachableIconUrl` documents.
  iconUrl: reachableIconUrl(raw.icon ?? '', port(raw.port), deviceHost),
  status: raw.status ?? 'unknown',
  installStatus: raw.install_status ?? 'unknown',
  port: port(raw.port),
  scheme: raw.scheme ?? 'http',
  index: raw.index ?? '/',
  appType: raw.app_type ?? '',
})

/**
 * Picks the title for a locale.
 *
 * Order: the user's exact locale (`de_de`), then a custom name the owner set on the device,
 * then English, then the container name. Never an empty string — an app tile with no label
 * is unusable, and the container name is a real fact rather than a placeholder.
 */
export const preferredTitle = (tile: AppTile, locale: string): string => {
  const key = locale.toLowerCase().replace('-', '_')
  return (
    tile.title[key] ??
    tile.title['custom'] ??
    tile.title['en_us'] ??
    Object.values(tile.title)[0] ??
    tile.name
  )
}

export const listApps = async (ctx: DeviceContext): Promise<Result<readonly AppTile[]>> => {
  const answer = await authed<unknown>(ctx, `${BASE.appManagement}${APPS.installedList}`)
  if (isErr(answer)) return answer
  const parsed = z.array(appSchema).nullable().safeParse(answer.value)
  if (!parsed.success) {
    return err(
      appError('malformed-response', `app list: ${parsed.error.issues[0]?.message ?? 'unparseable'}`,
        'error.malformedResponse', { where: 'app list' }),
    )
  }
  return ok((parsed.data ?? []).map((raw) => toTile(raw, ctx.host)))
}

/**
 * The address of an app's own web UI, as seen from the client.
 *
 * Built from the device host plus the app's published port — NOT from any URL the device
 * hands out, because those are written for a browser sitting on the device's own network
 * name. Returns null when the app publishes no port: an app without a web UI must show no
 * button rather than a link that leads nowhere.
 */
export const webUiUrl = (tile: AppTile, host: string): string | null => {
  if (tile.port === null) return null
  const scheme = tile.scheme === 'https' ? 'https' : 'http'
  const path = tile.index.startsWith('/') ? tile.index : `/${tile.index}`
  return `${scheme}://${host}:${tile.port}${path}`
}

/** sdk: POST /unapp/start | /unapp/stop with a json body naming the app. */
export const setAppRunning = async (
  ctx: DeviceContext,
  params: { readonly id: string; readonly running: boolean },
): Promise<Result<void>> => {
  const answer = await authed<unknown>(
    ctx,
    `${BASE.appManagement}${params.running ? APPS.start : APPS.stop}`,
    { method: 'POST', body: { id: params.id }, timeoutMs: 30_000 },
  )
  return isErr(answer) ? answer : ok(undefined)
}
