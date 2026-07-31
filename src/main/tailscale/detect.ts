import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { appError, err, ok, type Result } from '@shared/result'
import { logger } from '@main/logging/logger'

/**
 * Tailscale — a connection route the client DETECTS but never operates.
 *
 * Measured 2026-07-30 (Tailscale 1.98.9, as an ordinary unprivileged desktop user):
 *
 *   /usr/bin/tailscale, /usr/sbin/tailscaled     both present
 *   /var/run/tailscale/tailscaled.sock           srw-rw-rw-  (mode 0666)
 *   `tailscale status --json` as a normal user   exit 0 — NO root required
 *   BackendState                                 "Running"
 *   Self.TailscaleIPs                            ["100.64.x.x", "fd7a:115c:a1e0::x"]  (masked)
 *   CurrentTailnet                               {Name, MagicDNSSuffix, MagicDNSEnabled:true}
 *   Peer[…]                                      {HostName, TailscaleIPs, Online, OS}
 *
 * 🔴 **Why this is detection and not management.** The ZeroTier route runs its own bundled
 * daemon, because the system one keeps its auth token behind root. Doing the same for
 * Tailscale would be wrong, and a reported user complaint says exactly why: the official
 * Zima client takes ZeroTier over for its remote access, which displaces the DNS the user
 * had configured — their AdGuard filtering stops working, and they have to choose between
 * remote access and their own resolver. A client that seizes the tunnel makes that choice
 * for the user.
 *
 * So: if a tunnel is already up, we USE it. Nothing is started, stopped, reconfigured, and
 * no DNS setting is touched. Tailscale needs no privilege for this because the local socket
 * is world-readable by design — measured above, not assumed.
 *
 * **A peer named "ZimaOS" is not evidence of a ZimaOS device.** Two peers on this tailnet
 * carry that hostname and one is a board; a name is what someone typed, not a property.
 * The peers are offered as CANDIDATES, and the existing probe decides — the same probe that
 * already qualifies LAN and direct-IP addresses. That keeps the "measure the property, not
 * the label" rule intact at the one place where a hostname is tempting.
 */

const run = promisify(execFile)

export interface TailscalePeer {
  readonly hostName: string
  /** Verbatim from the daemon; IPv4 first, as the CLI orders them. */
  readonly addresses: readonly string[]
  readonly online: boolean
  readonly os: string
}

export interface TailscaleRuntime {
  /** `false` when the binary is absent — the common case, and not an error. */
  readonly installed: boolean
  /** Verbatim `BackendState`: Running, Stopped, NeedsLogin, NoState, Starting. */
  readonly backendState: string | null
  readonly selfAddresses: readonly string[]
  readonly magicDnsSuffix: string | null
  readonly tailnetName: string | null
  readonly peers: readonly TailscalePeer[]
  /**
   * Why the state could not be determined. Null when it could.
   *
   * "Not installed" and "installed but I could not ask" are different statements; only the
   * second one is worth showing as a problem.
   */
  readonly problem: string | null
}

const ABSENT: TailscaleRuntime = {
  installed: false,
  backendState: null,
  selfAddresses: [],
  magicDnsSuffix: null,
  tailnetName: null,
  peers: [],
  problem: null,
}

/**
 * Shape of the parts of `tailscale status --json` this client reads.
 *
 * Deliberately narrow: every field below was seen in a real answer. Anything absent is
 * treated as absent rather than defaulted to something that looks like a measurement.
 */
interface StatusJson {
  BackendState?: unknown
  TailscaleIPs?: unknown
  MagicDNSSuffix?: unknown
  CurrentTailnet?: { Name?: unknown; MagicDNSSuffix?: unknown } | null
  Self?: { TailscaleIPs?: unknown } | null
  Peer?: Record<string, unknown> | null
}

const stringsOf = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null)

const toPeer = (raw: unknown): TailscalePeer | null => {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  const hostName = asString(record['HostName'])
  const addresses = stringsOf(record['TailscaleIPs'])
  // A peer without an address cannot be connected to; listing it would be an entry that
  // does nothing when clicked.
  if (hostName === null || addresses.length === 0) return null
  return {
    hostName,
    addresses,
    online: record['Online'] === true,
    os: asString(record['OS']) ?? 'unknown',
  }
}

/**
 * Reads the local Tailscale state.
 *
 * Never throws and never guesses: a missing binary yields `installed: false` with no
 * problem, anything else yields a problem with the reason in it.
 */
export const readRuntime = async (): Promise<Result<TailscaleRuntime>> => {
  let raw: string
  try {
    // `tailscale` is resolved through PATH rather than from a hardcoded location: the
    // binary sits in /usr/bin on Debian, /usr/local/bin on a manual install and elsewhere
    // under Nix. A measured path is not a contract.
    const { stdout } = await run('tailscale', ['status', '--json'], {
      timeout: 5_000,
      maxBuffer: 4 * 1024 * 1024,
    })
    raw = stdout
  } catch (cause) {
    const code = (cause as { code?: unknown }).code
    if (code === 'ENOENT') {
      // Not installed. A normal situation on most machines, so it is a state and not a
      // failure — the UI simply does not offer the route.
      return ok(ABSENT)
    }
    // Installed but unreadable: daemon down, socket missing, permissions changed. Named,
    // because "no tunnel" and "could not ask" must not look alike.
    const reason = cause instanceof Error ? cause.message : String(cause)
    logger.info('tailscale.unreadable', { reason: reason.slice(0, 200) })
    return ok({ ...ABSENT, installed: true, problem: `tailscale status failed: ${reason}` })
  }

  let parsed: StatusJson
  try {
    parsed = JSON.parse(raw) as StatusJson
  } catch {
    return err(
      appError(
        'malformed-response',
        'tailscale status --json did not return JSON',
        'error.malformedResponse',
        { where: 'tailscale status' },
      ),
    )
  }

  const peers = Object.values(parsed.Peer ?? {})
    .map(toPeer)
    .filter((peer): peer is TailscalePeer => peer !== null)

  return ok({
    installed: true,
    backendState: asString(parsed.BackendState),
    // `Self.TailscaleIPs` and the top-level `TailscaleIPs` both appear; Self is the
    // authoritative one and the top level is the fallback.
    selfAddresses:
      stringsOf(parsed.Self?.TailscaleIPs).length > 0
        ? stringsOf(parsed.Self?.TailscaleIPs)
        : stringsOf(parsed.TailscaleIPs),
    magicDnsSuffix: asString(parsed.CurrentTailnet?.MagicDNSSuffix) ?? asString(parsed.MagicDNSSuffix),
    tailnetName: asString(parsed.CurrentTailnet?.Name),
    peers,
    problem: null,
  })
}

/**
 * Peers worth offering as device candidates.
 *
 * Only online ones, and only their IPv4 address — the probe connects to a host:port, and an
 * IPv6 literal would have to be bracketed everywhere downstream for no gain here. NOT
 * filtered by hostname: see the note at the top of this file.
 */
export const candidateAddresses = (runtime: TailscaleRuntime): readonly string[] =>
  runtime.peers
    .filter((peer) => peer.online)
    .flatMap((peer) => peer.addresses.filter((address) => address.includes('.')))
