/** Domain types shared by main, preload and renderer. No runtime dependencies. */

/**
 * What a specific device can actually do, derived from its gateway route table.
 *
 * This exists because ZimaOS modules are optional: two hosts on the same v1.7.0
 * build were measured with 35 and 38 registered routes, and `/v2/photos` was
 * present on only one of them. The OS version therefore proves nothing about the
 * feature surface — the route table does.
 */
/**
 * What the device says about its own ZeroTier state — the basis for "Remote ID".
 *
 * Measured 2026-07-30 on two v1.7.0 hosts via `GET /v2/zimaos/zt/info`:
 * one answered 200 with `status:"online"` and an IceWhale-managed network, the other 500
 * with `dial tcp 127.0.0.1:9993: connect: connection refused`. Both had the `/v1/zt`
 * gateway route, so the route proved nothing.
 *
 * The cases are kept apart because each needs different words and a different next step:
 * a switched-off daemon is fixable on the device, a missing endpoint is not.
 */
export type ZerotierState =
  | {
      readonly kind: 'online' | 'offline'
      /** ZeroTier network id the device belongs to. */
      readonly networkId: string
      /** The device's address inside that network. */
      readonly ip: string | null
      readonly networkName: string | null
    }
  /** Endpoint answered, daemon behind it is not listening (port 9993 refused). */
  | { readonly kind: 'not-running' }
  /** This device does not offer the endpoint at all. */
  | { readonly kind: 'absent' }
  /** We could not find out — the reason is carried so the UI never invents one. */
  | { readonly kind: 'unreachable'; readonly reason: string }

export interface Capabilities {
  /** Semantic photo search, facets, memories. Needs the photos module. */
  readonly photoLibrary: boolean
  /** Photo grid + preview. Runs off the files API, so it is always available. */
  readonly photoBrowse: boolean
  /** Upload photos to the device. Files API only — always available. */
  readonly photoBackup: boolean
  readonly files: boolean
  readonly apps: boolean
  readonly appStore: boolean
  readonly systemPower: boolean
  /**
   * Measured, never derived. `/v1/zt` sits in the route table of hosts where the ZeroTier
   * daemon is not running, so route presence would report a usable feature that is not.
   * `'unknown'` until `probeZerotier` has asked the device — deliberately not `false`,
   * because "nobody looked yet" and "the device says no" are different statements.
   */
  readonly zerotier: ZerotierState | 'unknown'
  readonly backup: boolean
  /** Raw route paths, kept so the UI can explain exactly what it found. */
  readonly routes: readonly string[]
}

/**
 * `tailscale` is a route the client detects and uses, never one it operates — see
 * `main/tailscale/detect.ts`. It is separate from `direct` so the UI can say where an
 * address came from, and separate from `remote-id` because that one means ZeroTier.
 */
export type ConnectionKind = 'lan' | 'direct' | 'remote-id' | 'tailscale'

/**
 * One entry of a directory listing.
 *
 * Field names are ours; the mapping from the device's own names is done once, in
 * `main/zima/files.ts`, against the measured answer
 * (`{name,path,is_dir,size,modified,extensions{…}}`). `modifiedMs` is milliseconds
 * because the device sends seconds and a raw copy would date every file to 1970.
 */
export interface ZimaFile {
  readonly name: string
  readonly path: string
  readonly isDir: boolean
  readonly size: number
  readonly modifiedMs: number
}

/** One page of a directory. `total` is what the device reports, not what we received. */
export interface DirectoryPage {
  readonly path: string
  readonly entries: readonly ZimaFile[]
  readonly total: number
  readonly index: number
  readonly size: number
}

/** A storage volume as the device describes it. */
export interface StorageVolume {
  readonly name: string
  readonly path: string
  readonly type: string
  readonly sizeBytes: number
  readonly usedBytes: number
  readonly healthy: boolean
}

/**
 * A server-side file operation. ZimaOS runs copy/move/decompress asynchronously and
 * exposes them as tasks, so the UI can show real progress instead of a spinner with no end.
 */
export interface FileTask {
  readonly id: number
  readonly type: string
  readonly status: string
  readonly errorMessage: string | null
  readonly createdUtc: number
  readonly finishedUtc: number
}

/**
 * The two power actions the device offers.
 *
 * Mirrors `SYSTEM_STATES` in `main/zima/endpoints.ts` — the shipped web UI calls
 * `setSystemState` with exactly these two values and nothing else.
 */
export type SystemStateAction = 'restart' | 'off'

/** How a copy or move resolves a name collision. Values measured off the API validator. */
export const CONFLICT_POLICIES = ['skip', 'rename', 'overwrite'] as const
export type ConflictPolicy = (typeof CONFLICT_POLICIES)[number]

export interface TrashEntry {
  readonly name: string
  readonly path: string
  readonly rawPath: string
  readonly size: number
  readonly isDir: boolean
  readonly deletedAtMs: number
}

/** Live load figures for the device screen. */
export interface Utilization {
  readonly cpuPercent: number
  readonly cpuModel: string
  readonly cpuCores: number
  readonly cpuTemperature: number | null
  /**
   * Derived from two readings of the device's energy counter — null until a second one
   * exists. Never the raw counter: that is `cpuEnergyMicrojoules`.
   */
  readonly cpuPowerWatt: number | null
  /** Cumulative CPU energy in microjoules, verbatim. Only meaningful as a difference. */
  readonly cpuEnergyMicrojoules: number | null
  /** Unix seconds the counter was read at, as the device reports it. */
  readonly cpuPowerTimestamp: number | null
  readonly memoryTotal: number
  readonly memoryUsed: number
  readonly memoryPercent: number
  readonly systemDiskSize: number
  readonly systemDiskUsed: number
  readonly systemDiskHealthy: boolean
}

export interface DeviceInfo {
  readonly name: string
  readonly model: string
  readonly osVersion: string
  readonly arch: string
  readonly cpuModel: string
  readonly cpuCores: number
  readonly memoryTotal: number
}

/**
 * An installed app.
 *
 * `title` is a locale map on the device (`{en_us, de_de, custom}`), so the client can show
 * the app's own German name instead of falling back to English.
 */
export interface AppTile {
  readonly id: string
  readonly name: string
  readonly title: Readonly<Record<string, string>>
  readonly iconUrl: string
  readonly status: string
  readonly installStatus: string
  readonly port: number | null
  readonly scheme: string
  readonly index: string
  readonly appType: string
}

/** One photo or video in the gallery. */
export interface PhotoAsset {
  readonly fileId: string
  readonly path: string
  readonly width: number
  readonly height: number
  readonly captureTsMs: number
  readonly mediaType: string
  readonly isFavorite: boolean
}

export interface PhotoPage {
  readonly assets: readonly PhotoAsset[]
  readonly total: number
  /** Opaque cursor for the next page. Null when the device sent none. */
  readonly nextCursor: string | null
}

/**
 * How far the photos module has got with indexing.
 *
 * Shown in the UI on purpose: without the semantic index, text search is token-exact
 * (measured), so "0 hits" would look like a broken search rather than an unfinished index.
 */
export interface PhotoIndexProgress {
  readonly status: string
  readonly totalImages: number
  readonly totalVideos: number
  readonly processedImages: number
  readonly processedVideos: number
  readonly pendingImages: number
  readonly pendingVideos: number
  readonly stages: readonly {
    readonly kind: string
    readonly label: string
    readonly percentage: number
    readonly status: string
  }[]
  /**
   * Whether semantic search can answer at all.
   *
   * Measured 2026-07-30: `/v2/photos/progress` carries a `vlm` block with `ready`,
   * `enabled` and a `missing` list. On a host where the vision model is not installed,
   * `POST /v2/photos/search` still answers **200 with `{hits:[], total:0}` in 2 ms** — a
   * successful request over an empty index. Without this field the interface can only say
   * "nothing found", which is a claim about the pictures rather than about the feature.
   */
  readonly semanticSearch: {
    readonly ready: boolean
    readonly enabled: boolean
    /** Verbatim names of what the device says is missing, e.g. model, mmproj, runtime. */
    readonly missing: readonly string[]
    /** The device's own word for the state, kept unmapped. */
    readonly status: string
  }
}

export interface PhotoHit {
  readonly fileId: string
  readonly path: string
  readonly name: string
  readonly type: string
  readonly score: number
}

/** Outcome of an actual request against a candidate address — never inferred. */
export interface ProbeResult {
  readonly host: string
  readonly reachable: boolean
  /** Round-trip time in ms for the request that answered. */
  readonly latencyMs: number | null
  /**
   * Distinguished on purpose: 'refused' means something answered and nothing is
   * listening, 'timeout' means nothing answered at all (a firewall may be
   * dropping). Collapsing them into "offline" hides which problem to fix.
   */
  readonly failure: 'refused' | 'timeout' | 'dns' | 'unexpected-status' | null
  readonly httpStatus: number | null
}

export interface DiscoveredDevice {
  readonly host: string
  /** mDNS instance name, e.g. "ZimaOS" or "ZimaOS-2". */
  readonly name: string
  readonly port: number
  /** TXT records from the advertisement, e.g. { os: "ZimaOS" }. */
  readonly txt: Readonly<Record<string, string>>
}

export interface DeviceAddress {
  readonly kind: ConnectionKind
  readonly host: string
  readonly port: number
  /** Lower number wins when several addresses answer. User-sortable. */
  readonly priority: number
  /**
   * For `remote-id` addresses: the ZeroTier network this host only exists inside.
   *
   * 🔴 A remote-id address is not reachable by itself. This client stops its ZeroTier
   * daemon when the window closes — deliberately, there is no background mode — so on the
   * next start the stored `10.x.y.1` points into a tunnel that no longer exists. Without
   * the network id there is nothing to rebuild it from, and every request runs into its
   * full timeout behind a "loading" label. Measured 2026-07-30: a resumed session spent
   * 10 s on `/v1/users/refresh` and then failed, while the same request over the LAN
   * answered in 3 ms.
   */
  readonly networkId?: string | undefined
}

export interface Device {
  readonly id: string
  readonly displayName: string
  readonly addresses: readonly DeviceAddress[]
  readonly lastSeenIso: string | null
  readonly capabilities: Capabilities | null
  /**
   * `device_code` from `GET /v2/zimaos/device/info` — how this device is recognised again
   * at an address nobody stored yet.
   *
   * Null for entries written before this existed, and for devices that were never reached.
   * Null must never match anything: see `sameDevice` in `main/zima/identity.ts`. Measured
   * stable across a real reboot and different between two devices (2026-08-10).
   */
  readonly deviceCode?: string | null | undefined
}

/**
 * Which secret store Electron actually selected. `basic_text` means the OS has no
 * keyring and safeStorage falls back to a hardcoded plaintext password — that must
 * be shown to the user, never assumed away.
 */
export type SecretBackend =
  | 'gnome_libsecret'
  | 'kwallet'
  | 'kwallet5'
  | 'kwallet6'
  | 'basic_text'
  | 'unknown'

export interface SecretStoreStatus {
  readonly backend: SecretBackend
  readonly encryptionAvailable: boolean
  /** True when storing credentials would not actually protect them. */
  readonly plaintextRisk: boolean
}

export const SUPPORTED_LOCALES = [
  'ca_ES',
  'cs_CZ',
  'da_DK',
  'de_DE',
  'el_GR',
  'en_GB',
  'en_US',
  'es_ES',
  'fr_FR',
  'ga_IE',
  'hr_HR',
  'hu_HU',
  'it_IT',
  'ja_JP',
  'ko_KR',
  'ml_IN',
  'nb_NO',
  'nl_NL',
  'pl_PL',
  'pt_BR',
  'pt_PT',
  'ro_RO',
  'ru_RU',
  'sk_SK',
  'sv_SE',
  'tr_TR',
  'zh_CN',
  'zh_TW',
] as const

export type Locale = (typeof SUPPORTED_LOCALES)[number]
export const FALLBACK_LOCALE: Locale = 'en_US'
