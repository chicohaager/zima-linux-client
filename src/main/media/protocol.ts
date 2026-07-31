import { net, protocol } from 'electron'
import { isErr } from '@shared/result'
import { logger } from '@main/logging/logger'
import { fetchBinary } from '@main/zima/client'
import { BASE, FILES, PHOTOS } from '@main/zima/endpoints'
import * as session from '@main/session'

/**
 * `zima-media://` — how the renderer shows device images without ever holding a token.
 *
 * The problem it solves: a thumbnail needs an `Authorization` header, and an `<img src>`
 * cannot send one. The alternatives were worse:
 *
 *  - Passing the token to the renderer would put a device credential inside a sandboxed
 *    web context, where any XSS in a rendered file name could read it.
 *  - Sending each thumbnail through IPC as base64 inflates every image by a third and
 *    serialises a photo grid of several hundred tiles through one channel.
 *
 * So the main process serves them: the renderer asks for `zima-media://thumbnail/<b64url>`,
 * this handler adds the token, fetches the bytes and streams them back. The renderer sees
 * an opaque URL and nothing else.
 *
 * Three hosts, three sources:
 *   zima-media://thumbnail/<b64url path>  files API thumbnail — works on every device
 *   zima-media://photo/<b64url path>      photos-module thumbnail (better crops, needs module)
 *   zima-media://appicon/<b64url url>     an app icon, fetched credential-free and capped
 */

export const MEDIA_SCHEME = 'zima-media'

/**
 * Caps for a fetch that may go to a host nobody here controls.
 *
 * 🔴 4 MiB, not the 256 KiB this started at. That first figure was reasoning from what an
 * icon *ought* to weigh; the first run against the real app list rejected a legitimate one
 * at **1 499 594 bytes** — a full-resolution PNG someone put in their store entry. The cap
 * exists to stop a hostile answer from filling memory, not to enforce an opinion about
 * image sizes, and 4 MiB still does that.
 *
 * 8 s is long enough for a slow CDN and short enough that a tile does not hang the list.
 */
const MAX_ICON_BYTES = 4 * 1024 * 1024
const ICON_TIMEOUT_MS = 8_000

/**
 * Must run before `app.whenReady`. Without `standard: true` the URL has no host segment and
 * `supportFetchAPI`/`stream` handling differs; without `secure: true` a page under a
 * `file://` origin refuses the images.
 */
export const registerMediaScheme = (): void => {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ])
}

const decode = (segment: string): string | null => {
  try {
    return Buffer.from(segment.replaceAll('-', '+').replaceAll('_', '/'), 'base64').toString('utf8')
  } catch {
    return null
  }
}

const notFound = (reason: string): Response => {
  // A 404 with a reason in the body, not an empty 200. An empty image response renders as a
  // broken tile with no way to find out why.
  //
  // Logged as well as returned: the body of a 404 goes to an <img> tag, which shows a broken
  // tile and discards the text. Three icons failed on 2026-07-30 with nothing in the log to
  // say why, because only the specific rejections logged and the generic exits did not.
  logger.info('media.not-served', { reason: reason.slice(0, 160) })
  return new Response(reason, { status: 404, headers: { 'content-type': 'text/plain' } })
}

/**
 * Serves one media request.
 *
 * Every failure path answers with a status and a reason. A silent transparent pixel would
 * make a missing thumbnail indistinguishable from a photo of a white wall.
 */
const handle = async (request: Request): Promise<Response> => {
  const url = new URL(request.url)
  const kind = url.hostname
  const encoded = url.pathname.replace(/^\//, '')
  const target = decode(decodeURIComponent(encoded))
  if (target === null || target.length === 0) return notFound('undecodable media reference')

  const ctx = await session.deviceContext()
  if (isErr(ctx)) return notFound(`no session: ${ctx.error.kind}`)

  if (kind === 'appicon') {
    /*
     * App icons are fetched wherever the app's metadata points, including hosts that are
     * not the device — requested 2026-07-30, after 16 of 18 tiles showed a bare letter
     * because their icons live on github, jsdelivr, imgur or icon.casaos.io.
     *
     * What the earlier host restriction was actually good for is worth keeping straight:
     * it did NOT prevent a wrong logo. The "Box.com logo on the Immich tile" came from a
     * store entry naming the wrong icon, and refusing to load it only replaced a wrong
     * picture with no picture. So the restriction cost every legitimate icon and bought
     * nothing against the case it was named after.
     *
     * What a foreign fetch does cost is real and is handled here rather than by refusing:
     *
     *  - it is made from the MAIN process, so the renderer never opens a connection and
     *    the strict img-src CSP stays intact,
     *  - `credentials: 'omit'` — no cookie or auth header travels to a third party, and in
     *    particular the device token never leaves the main process,
     *  - only http/https, so a `file://` in metadata cannot read the local disk,
     *  - the answer must BE an image; a server returning HTML or a script gets rejected
     *    rather than handed to an <img> tag,
     *  - size and time are capped, so one hostile URL cannot stall or exhaust the app.
     *
     * The remaining trade-off is honest and belongs to the user: fetching an icon reveals
     * this machine's IP to whoever hosts it, exactly as the device's own web UI does.
     */
    let icon: URL
    try {
      icon = new URL(target)
    } catch {
      return notFound('app icon is not a URL')
    }
    if (icon.protocol !== 'http:' && icon.protocol !== 'https:') {
      logger.info('media.icon-scheme-rejected', { scheme: icon.protocol })
      return notFound(`app icon scheme ${icon.protocol} is not fetchable`)
    }

    const foreign = icon.hostname !== ctx.value.host
    let fetched: Response
    try {
      fetched = await net.fetch(icon.toString(), {
        // Never send anything identifying to a third-party host.
        credentials: 'omit',
        signal: AbortSignal.timeout(ICON_TIMEOUT_MS),
      })
    } catch (cause) {
      logger.info('media.icon-fetch-failed', { host: icon.hostname, reason: String(cause).slice(0, 120) })
      return notFound(`app icon could not be fetched from ${icon.hostname}`)
    }
    if (!fetched.ok) return notFound(`app icon ${fetched.status}`)

    const contentType = fetched.headers.get('content-type') ?? ''
    if (!contentType.startsWith('image/')) {
      // A tile is the one place where "it answered" must not be confused with "it is an
      // icon": an <img> pointed at text/html renders as a broken tile, and pointing it at
      // anything else is a hole with no upside.
      logger.info('media.icon-not-an-image', { host: icon.hostname, contentType: contentType.slice(0, 60) })
      return notFound(`app icon is ${contentType || 'of unknown type'}, not an image`)
    }

    const declared = Number(fetched.headers.get('content-length') ?? '0')
    if (declared > MAX_ICON_BYTES) {
      return notFound(`app icon is ${declared} bytes, over the ${MAX_ICON_BYTES} limit`)
    }
    // Buffered rather than streamed, so the cap holds even without a content-length.
    const bytes = new Uint8Array(await fetched.arrayBuffer())
    if (bytes.byteLength > MAX_ICON_BYTES) {
      return notFound(`app icon is ${bytes.byteLength} bytes, over the ${MAX_ICON_BYTES} limit`)
    }

    if (foreign) logger.info('media.foreign-icon-fetched', { host: icon.hostname, bytes: bytes.byteLength })
    return new Response(bytes, { status: 200, headers: { 'content-type': contentType } })
  }

  const usePhotosModule = kind === 'photo'
  const path = usePhotosModule ? `${BASE.photos}${PHOTOS.thumbnail}` : `${BASE.files}${FILES.thumbnail}`
  const query = usePhotosModule
    ? // Parameters measured 2026-07-16 and re-measured through the gateway: the photos
      // module wants an explicit size and scene, the files API only a path.
      { path: target, width: 320, height: 320, scene: 'photo', format: 'jpeg', mode: 'best' }
    : { path: target }

  const bytes = await fetchBinary(ctx.value, path, query)
  if (isErr(bytes)) {
    logger.info('media.unavailable', { kind, error: bytes.error.kind })
    return notFound(`thumbnail unavailable: ${bytes.error.kind}`)
  }
  return new Response(bytes.value.bytes, {
    status: 200,
    headers: {
      'content-type': bytes.value.contentType,
      // Thumbnails for a given path do not change without the file changing, and a photo
      // grid re-requests the same tiles constantly while scrolling.
      'cache-control': 'private, max-age=3600',
    },
  })
}

export const registerMediaProtocol = (): void => {
  protocol.handle(MEDIA_SCHEME, (request) =>
    handle(request).catch((cause: unknown) => {
      // A throwing handler otherwise leaves the request hanging forever, which in the
      // renderer looks like a slow network rather than a defect.
      logger.error('media.handler-threw', { cause: String(cause) })
      return notFound('media handler failed')
    }),
  )
}

/** Builds a renderer-safe URL for a device path. */
export const mediaUrl = (kind: 'thumbnail' | 'photo' | 'appicon', target: string): string => {
  const encoded = Buffer.from(target, 'utf8')
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
  return `${MEDIA_SCHEME}://${kind}/${encoded}`
}
