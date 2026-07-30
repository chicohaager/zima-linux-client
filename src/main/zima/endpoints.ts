/**
 * ZimaOS endpoint surface.
 *
 * Every path here was read off a running device — either from the gateway route
 * table (`GET /v1/gateway/routes`) or from the path literals inside the web UI's
 * own JS bundle, which embeds the generated OpenAPI SDKs. The web UI is the door
 * the user goes through, so it is the most trustworthy source available. The
 * official `@icewhale/*` SDKs are not installable (private registry), so we keep
 * our own thin client instead of depending on a third-party fork.
 *
 * Verification marks below mean: measured 2026-07-30 against two ZimaCube hosts,
 * both ZimaOS v1.7.0. `bundle` = present as a path literal in the shipped UI,
 * `routes` = present in the gateway route table, `live` = requested and answered.
 *
 * NEVER add a service port here. ZimaOS assigns them from the ephemeral range and
 * they move across restarts (Photos was measured moving 42537 -> 34661). Always go
 * through the gateway.
 */

/** Gateway base paths, as registered in the route table. */
export const BASE = {
  /** routes+live: 35 routes on one host, 38 on the other, both v1.7.0 */
  gateway: '/v1/gateway',
  /** routes+live: ES256 JWT login, token refresh, user info */
  users: '/v1/users',
  /** routes: legacy system surface */
  sys: '/v1/sys',
  /** routes: ZeroTier surface used for Remote ID */
  zt: '/v1/zt',
  /** routes: app list (legacy) */
  apps: '/v1/apps',
  /** routes: app management, incl. myapps + compose */
  appManagement: '/v2/app_management',
  /** routes: system/device/disk/network/settings surface */
  zimaos: '/v2/zimaos',
  /** routes: files API the UI actually talks to */
  files: '/v2_1/files',
  /** routes: OPTIONAL — absent on one of two v1.7.0 hosts (binary not installed) */
  photos: '/v2/photos',
} as const

/** Paths relative to BASE.users. */
export const USERS = {
  /** live: POST {username,password} -> data.token.{access_token,refresh_token} */
  login: '/login',
  /**
   * live 2026-07-30: POST {refresh_token} -> data.{access_token,refresh_token,expires_at}
   * FLACH unter `data` — anders als /login, das die Tokens unter `data.token` verschachtelt.
   * Vorher stand hier nur „bundle", und genau diese ungemessene Stelle war falsch geparst.
   */
  refresh: '/refresh',
  /** bundle: current user */
  current: '/current',
} as const

/** Paths relative to BASE.files. */
export const FILES = {
  /** bundle: directory listing and single-file metadata (?path=<urlencoded>) */
  entry: '/file',
  /** bundle: server-side search — the File Hub search feature */
  search: '/file/search',
  download: '/file/download',
  upload: '/file/upload',
  uploadV2: '/file/uploadV2',
  uploadInfo: '/file/upload_info',
  /** bundle: image thumbnails — also lets us render a photo grid without the photos module */
  thumbnail: '/thumbnail',
  /** bundle: poster frame for videos */
  videoPoster: '/file/video/generate/image',
  folder: '/folder',
  /** bundle: favourites */
  pin: '/pin',
  trash: '/trash',
  trashStats: '/trash/stats',
  trashEmpty: '/trash/empty',
  shareList: '/share/list',
  shareLink: '/share/link',
  /** bundle: long-running file operations, polled via TASK_BY_ID */
  taskCopy: '/task/copy',
  taskCut: '/task/cut',
  taskDuplicate: '/task/duplicate',
  taskDecompress: '/task/decompress',
  taskRetry: '/task/retry',
} as const

export const taskById = (id: string): string => `/task/${encodeURIComponent(id)}`

/** Paths relative to BASE.zimaos. */
export const SYSTEM = {
  /** bundle: the device product photo shown on the dashboard */
  deviceImage: '/device/image',
  deviceInfo: '/device/info',
  hardware: '/sys/hardware',
  utilization: '/sys/utilization',
  storageStats: '/storage/stats',
  diskInfo: '/disk/info',
  networkInterfaces: '/network/interfaces',
} as const

/**
 * Power actions. The shipped UI calls setSystemState with exactly two values —
 * "restart" and "off" — so those are the only two we expose. Anything else would
 * be invented.
 */
export const SYSTEM_STATES = ['restart', 'off'] as const
export type SystemState = (typeof SYSTEM_STATES)[number]
export const systemState = (state: SystemState): string =>
  `/sys/state/${encodeURIComponent(state)}`

/** Paths relative to BASE.photos — only reachable when the module is registered. */
export const PHOTOS = {
  /** Body must be exactly {"query": "..."} — extra top-level keys yield HTTP 400 */
  search: '/search',
  galleryStream: '/gallery/stream',
  galleryFacets: '/gallery/facets',
  thumbnail: '/thumbnail',
  /** Index progress — shown in the UI so "0 hits" cannot be mistaken for a bug */
  progress: '/progress',
} as const

/** mDNS service type advertised by ZimaOS: measured in /etc/avahi/services/zimaos.service. */
export const MDNS_SERVICE_TYPE = '_zimaos._tcp'
/** Port from the same avahi record, cross-checked against the SRV answer (0x0050). */
export const MDNS_PORT = 80
