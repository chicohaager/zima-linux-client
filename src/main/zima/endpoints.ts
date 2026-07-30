/**
 * ZimaOS endpoint surface.
 *
 * How every path here was obtained, in order of strength:
 *
 *  - `live` — requested against a real device and answered. `npm run verify:live` fires
 *    the whole table and prints `METHOD PATH -> STATUS BYTES` plus the answer's shape.
 *  - `sdk` — read out of the OpenAPI client that the shipped web UI carries
 *    (`/usr/share/casaos/www/assets/vendor-api-*.js`). This is the strongest static source
 *    available: it names the operation, the HTTP method, the **base path it is
 *    instantiated with** and the **query parameter names**. Extracted 2026-07-30 from a
 *    v1.7.0 host.
 *  - `kb` — measured earlier and written down in `~/dev/ZIMAOS-KNOWLEDGE.md` with a date.
 *
 * A path with only `sdk` next to it has a proven spelling and an unproven status. Nothing
 * in this file is here because it looked plausible.
 *
 * 🔴 Three corrections the 2026-07-30 measurement forced, all the same mistake — a path
 * that exists with a meaning I had assumed rather than read:
 *
 *  1. `/v2_1/files/file/search` is not a search. `GET` = `getSearchStatus`,
 *     `PUT ?status=` = `setSearchStatus`: it reads and toggles the *indexer*. The v1.7.0
 *     files API has no server-side file query at all (see `SEARCH_IS_CLIENT_SIDE`).
 *  2. `/v2_1/files/share/link` does not exist. `/share*` is SMB share management; link
 *     sharing is the `/torrent*` family. No substitute path was invented.
 *  3. System, storage and app paths sat under the wrong base. Measured with a valid token:
 *     `/v2/zimaos/sys/hardware`, `/v2/zimaos/storage/stats`, `/v2/zimaos/disk/info`,
 *     `/v2/app_management/myapps` and `/v1/apps` all answer **404**. The SDK shows why:
 *     hardware/utilization live under `/v1`, storage and disks under `/v2/local_storage`,
 *     and the installed-app list is `/installed/list`, not `myapps`.
 *
 * NEVER add a service port here. ZimaOS assigns them from the ephemeral range and they
 * move across restarts (Photos was measured moving 42537 -> 34661). Always go through the
 * gateway.
 */

/** Gateway base paths. `routes` = present in `GET /v1/gateway/routes`. */
export const BASE = {
  /** routes+live: 35 routes on one host, 38 on the other, both v1.7.0 */
  gateway: '/v1/gateway',
  /** routes+live+sdk: ES256 JWT login, token refresh, user info (`UserApi` @ `/v1/users`) */
  users: '/v1/users',
  /**
   * routes+sdk: the CasaOS-era system surface. The SDK instantiates its
   * `SystemMethodsApi` with base `/v1`, and its paths start with `/sys/` — so hardware,
   * utilization and the power state all live here, NOT under `/v2/zimaos`.
   */
  sys: '/v1/sys',
  /**
   * routes: the v1 ZeroTier route exists — and is NOT the door the web UI uses. Measured
   * 2026-07-30 with an access token on two v1.7.0 hosts: `GET /v1/zt/info` -> **404** on
   * one, **500** on the other. The UI calls `ZeroTierMethodsApi` with base `/v2/zimaos`.
   * Kept only so the route table maps completely; it must NOT be used for calls.
   */
  ztLegacyRouteOnly: '/v1/zt',
  /** routes+sdk: container stats (`ContainerMethodsApi` @ `/v1/container`) */
  container: '/v1/container',
  /** routes+sdk: app management — installed list, compose, start/stop */
  appManagement: '/v2/app_management',
  /** routes+sdk: dashboard tiles (`DashboardMethodsApi`) */
  dashboard: '/v2/dashboard',
  /** routes+sdk: disks, storages, mounts (`StorageMethodsApi`, `DiskMethodsApi`, `MountMethodsApi`) */
  localStorage: '/v2/local_storage',
  /** routes+sdk: device info/image, network, ZeroTier, scheduled power-off */
  zimaos: '/v2/zimaos',
  /** routes+sdk+live: the files API the UI actually talks to (`FileApi` @ `/v2_1/files`) */
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
   * FLAT under `data` — unlike /login, which nests them under `data.token`. Reusing one
   * parser for both was a real bug: renewal never worked while 63 tests stayed green.
   */
  refresh: '/refresh',
  /** sdk: `getCurrentUser` */
  current: '/current',
  /** sdk: `getUserStatus` — whether the device has an owner account at all */
  status: '/status',
} as const

/**
 * Paths relative to BASE.sys — hardware, load and the power state.
 *
 * sdk: `getHardware` (GET /sys/hardware), `getUtilization` (GET /sys/utilization),
 * `getSystemEntry` (GET /sys/entry), `setSystemState` (**PUT** /sys/state/{state}).
 */
export const SYS = {
  hardware: '/hardware',
  utilization: '/utilization',
  entry: '/entry',
} as const

/**
 * Power actions.
 *
 * The shipped UI calls `setSystemState` with exactly two values — `"restart"` and `"off"`
 * — behind a confirmation dialog ("Are you sure to power off ZimaCube"). Those are the
 * only two exposed here; anything else would be invented. The method is **PUT**, read off
 * the SDK, not guessed.
 *
 * Deliberately NOT covered by `verify:live`: measuring this would shut the device down.
 * It is the one endpoint in this file whose status stays unmeasured on purpose, and the UI
 * says so at the point of use.
 */
export const SYSTEM_STATES = ['restart', 'off'] as const
export type SystemState = (typeof SYSTEM_STATES)[number]
export const systemState = (state: SystemState): string => `/state/${encodeURIComponent(state)}`

/** Paths relative to BASE.zimaos. */
export const SYSTEM = {
  /** sdk: `getDeviceInfo` — name, model, arch, cpu, os version */
  deviceInfo: '/device/info',
  /** sdk: `getDeviceImage`, query model,type — the product photo on the dashboard */
  deviceImage: '/device/image',
  /** sdk: `getNetworkInterfaces` */
  networkInterfaces: '/network/interfaces',
  /** sdk: `getConnectionStatus` */
  connectionStatus: '/network/connection-status',
} as const

/** Paths relative to BASE.localStorage. */
export const STORAGE = {
  /** sdk: `getStorageStats` */
  stats: '/storage/stats',
  /** sdk: query all — the volume list behind the "Storage" section */
  storages: '/storages',
  /** sdk: query path,system */
  storage: '/storage',
  /** sdk: query path */
  diskInfo: '/disk/info',
  /** sdk: query customizable,free,single */
  disks: '/disk',
} as const

/**
 * Paths relative to BASE.zimaos — the ZeroTier surface behind "Remote ID".
 *
 * live 2026-07-30, two v1.7.0 hosts, with an access token:
 *   Host A: GET /v2/zimaos/zt/info -> 200 {id, ip, name, status:"online"}
 *   Host B: GET /v2/zimaos/zt/info -> 500 {"message":"… dial tcp 127.0.0.1:9993:
 *           connect: connection refused"}   <- route present, daemon not running
 *
 * That difference is the point: the gateway route `/v1/zt` exists on BOTH hosts, so route
 * presence says nothing about whether ZeroTier is usable. It has to be probed.
 */
export const ZT = {
  /** live: GET -> {id, ip, name, status}. 500 + "connection refused" = daemon down. */
  info: '/zt/info',
  /**
   * sdk: **PUT** {status: "online"|"offline"|"reset"} (`setZerotierNetworkStatus`, enum
   * `SetZerotierNetworkStatusRequestStatusEnum`). NOT measured — calling it changes the
   * device's connectivity, so it stays unverified until a user asks for that.
   */
  status: '/zt/status',
} as const

/** Paths relative to BASE.appManagement. */
export const APPS = {
  /**
   * sdk: `getAppsInstalledList` (GET /installed/list, query mode) — the installed app
   * list. NOT `/myapps`: that path was an assumption and answers 404 with a token.
   */
  installedList: '/installed/list',
  /** sdk: `getAppInstalledItem`, query id */
  installedItem: '/installed/item',
  /** sdk: the tile grid the UI's home screen uses */
  appGrid: '/web/appgrid',
  /** sdk: query container_ids — cpu/memory per app */
  containerUsage: '/installed/container/usage',
  /** sdk: `startUnapp` / `stopUnapp`, POST with a json body */
  start: '/unapp/start',
  stop: '/unapp/stop',
} as const

/**
 * Paths relative to BASE.files.
 *
 * Extracted from the shipped `FileApi`/`FolderApi`/`TaskApi`/`TrashApi`/`PinMethodsApi`/
 * `ShareApi`/`ImageApi`, all instantiated with `/v2_1/files`. 84 operations in total; the
 * query parameter names below are theirs, not ours.
 */
export const FILES = {
  /**
   * sdk+live: directory listing. Query `path,index,size,sort,direction,sfz`.
   * live: 200 -> `{all:int, content:[{name,path,is_dir,size,modified,extensions{…}}]}`;
   * a missing path answers **404 {"message":…}**, not 400 and not an empty folder.
   * POST creates a file, PUT renames, DELETE removes irreversibly.
   */
  entry: '/file',
  /**
   * sdk+live: `getSearchStatus` (GET) / `setSearchStatus` (PUT ?status=) — the state of
   * the *indexer*, not a query interface. live: 200 -> `{data:{status:string}}`.
   */
  searchStatus: '/file/search',
  /** sdk: `getFileDownload`, query path */
  download: '/file/download',
  /** sdk: `postUploadFile` (multipart); GET with chunkNumber,filename,path,relativePath,totalChunks asks whether a chunk already arrived */
  upload: '/file/upload',
  uploadV2: '/file/uploadV2',
  /** sdk+live: `getUploadInfo`, query path,pretty. live: **204 with an empty body**. */
  uploadInfo: '/file/upload_info',
  /** sdk: `getThumbnail`, query path — renders a photo grid without the photos module */
  thumbnail: '/thumbnail',
  /** sdk: `postVideoThumbnail`, POST json body */
  videoPoster: '/file/video/generate/image',
  /** sdk: POST create, PUT ?path= rename, DELETE remove, GET ?path&size info */
  folder: '/folder',
  /** sdk+live: favourites. live: 200 -> a bare array `[{name,path,type,index,font}]` — no envelope. */
  pin: '/pin',
  /** sdk: `moveFilesToTrash` — DELETE with a json body. The reversible delete. */
  moveToTrash: '/file/trash',
  /** sdk+live: `getTrashFileList` (GET ?filter) -> `{data:[{name,path,raw_path,size,is_dir,deleted_at}]}` */
  trash: '/trash',
  /** sdk+live: 200 -> `{data:[{storage_name,total_size}]}` */
  trashStats: '/trash/stats',
  trashEmpty: '/trash/empty',
  /** sdk+live: `getShareList`, query path -> `{name,path,status,permission:[{user,read,write}]}` */
  shareList: '/share/list',
  /** sdk+live: `getTaskList` (GET ?order&visible) -> `{data:[…], message}`; DELETE cancels/hides */
  tasks: '/tasks',
  /** sdk: long-running operations, tracked through `tasks` */
  taskCopy: '/task/copy',
  taskCut: '/task/cut',
  taskDuplicate: '/task/duplicate',
  taskDecompress: '/task/decompress',
  taskRetry: '/task/retry',
} as const

/**
 * There is no server-side file search on ZimaOS v1.7.0.
 *
 * Established by extracting every operation of the shipped files SDK — 84 of them, none a
 * query. The File Hub search therefore walks directories through `FILES.entry` and names
 * its scope in the UI. A search box wired to `/file/search` would have returned indexer
 * metadata and looked like a broken search.
 */
export const SEARCH_IS_CLIENT_SIDE = true

export const taskById = (id: string): string => `/task/${encodeURIComponent(id)}`

/**
 * Paths relative to BASE.photos — only reachable when the module is registered.
 *
 * Parameters measured 2026-07-16 (KB "ZimaOS Photos — HTTP-API") and re-measured
 * 2026-07-30 through the gateway. `limit`/`media_types`/`path_prefix` are the real names:
 * a first probe using `page`/`page_size` was silently ignored and returned the default
 * page — a wrong parameter name that looks like a working call is exactly the failure this
 * file exists to prevent.
 */
export const PHOTOS = {
  /**
   * live: POST body must be exactly `{"query": "…"}` -> `{total,took_ms,hits:[…]}`.
   * Any extra top-level key (`limit`, `filters`) -> **400 {"error":…}**, measured as a
   * negative control, because the server sets DisallowUnknownFields.
   */
  search: '/search',
  /** live+kb: query media_types,path_prefix,limit,collapse_groups -> `{items:[{asset:{…}}]}` */
  galleryStream: '/gallery/stream',
  /** live+kb: query media_types,lang,locale -> facet buckets with a cover asset each */
  galleryFacets: '/gallery/facets',
  /** kb: query path,width,height,scene,format,mode — answers binary JPEG, not JSON */
  thumbnail: '/thumbnail',
  /** live: index progress, shown in the UI so "0 hits" cannot be mistaken for a bug */
  progress: '/progress',
  /** kb: which source folders are indexed */
  indexPaths: '/index/paths',
} as const

/** mDNS service type advertised by ZimaOS: measured in /etc/avahi/services/zimaos.service. */
export const MDNS_SERVICE_TYPE = '_zimaos._tcp'
/** Port from the same avahi record, cross-checked against the SRV answer (0x0050). */
export const MDNS_PORT = 80
