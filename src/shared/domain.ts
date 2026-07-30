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

export type ConnectionKind = 'lan' | 'direct' | 'remote-id'

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
}

export interface Device {
  readonly id: string
  readonly displayName: string
  readonly addresses: readonly DeviceAddress[]
  readonly lastSeenIso: string | null
  readonly capabilities: Capabilities | null
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
