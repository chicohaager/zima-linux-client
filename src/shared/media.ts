/**
 * The `zima-media://` URL scheme — shared by the main process (which serves it) and the
 * renderer (which asks for it).
 *
 * Deliberately in `shared/`: when the builder lived in the main process and the renderer
 * built the same string by hand, the two encodings could drift apart and a photo grid would
 * show broken tiles for exactly those paths whose encoding differed — a bug that appears
 * only for names with spaces or umlauts, i.e. late and in someone else's library.
 *
 * No credential is involved: the URL names a path, and the main process attaches the token
 * when it fetches the bytes. That is the whole point of the scheme (see main/media/protocol).
 */

export const MEDIA_SCHEME = 'zima-media'

export type MediaKind = 'thumbnail' | 'photo' | 'appicon'

/**
 * base64url of a UTF-8 string, using only APIs that exist in both Node and Chromium.
 *
 * Padding is stripped; `Buffer.from(…, 'base64')` on the receiving side accepts that.
 */
const base64url = (text: string): string => {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

/** A renderer-safe URL for a device path (or, for `appicon`, a device-served icon URL). */
export const mediaUrl = (kind: MediaKind, target: string): string =>
  `${MEDIA_SCHEME}://${kind}/${base64url(target)}`

/**
 * Extensions the thumbnail endpoint can render.
 *
 * Used to decide whether a tile even asks for a thumbnail. Asking for one for a .zip would
 * produce a 404 per file — a wall of failed requests that looks like a broken device.
 */
const IMAGE_EXTENSIONS = [
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif', 'tif', 'tiff', 'avif',
] as const

const VIDEO_EXTENSIONS = ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'mpg', 'mpeg'] as const

const extensionOf = (name: string): string => {
  const at = name.lastIndexOf('.')
  return at === -1 ? '' : name.slice(at + 1).toLowerCase()
}

export const isImageName = (name: string): boolean =>
  (IMAGE_EXTENSIONS as readonly string[]).includes(extensionOf(name))

export const isVideoName = (name: string): boolean =>
  (VIDEO_EXTENSIONS as readonly string[]).includes(extensionOf(name))

/** True for anything the Photos section should show — pictures and videos alike. */
export const isVisualName = (name: string): boolean => isImageName(name) || isVideoName(name)
