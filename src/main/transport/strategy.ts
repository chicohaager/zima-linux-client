import type { ConnectionKind, DeviceAddress, DiscoveredDevice, ProbeResult } from '@shared/domain'
import { appError, err, isErr, ok, type Result } from '@shared/result'
import { discover } from '@main/discovery/mdns'
import * as zerotier from '@main/zerotier/daemon'
import { candidateAddresses, readRuntime as readTailscale } from '@main/tailscale/detect'
import { MDNS_PORT } from '@main/zima/endpoints'
import { probe } from './probe'
import { byPriority } from '@main/devices/ordering'

/**
 * The three ways to reach a device, behind one interface.
 *
 * Each strategy only produces *candidate addresses*; whether a candidate actually works
 * is decided by a real request in `probe`. Nothing here infers reachability from a name,
 * a subnet or a configuration entry.
 */

export interface StrategyOutcome {
  readonly kind: ConnectionKind
  readonly candidates: readonly DeviceAddress[]
  /** Set when the strategy itself could not run — distinct from "found nothing". */
  readonly unavailableReason: string | null
}

/** mDNS/DNS-SD: `_zimaos._tcp`, measured on the wire, not guessed. */
export const lanStrategy = async (timeoutMs = 3_000): Promise<StrategyOutcome> => {
  const found: readonly DiscoveredDevice[] = await discover(timeoutMs)
  return {
    kind: 'lan',
    candidates: found.map((device, index) => ({
      kind: 'lan' as const,
      host: device.host,
      port: device.port,
      priority: index,
    })),
    unavailableReason: null,
  }
}

/** A host the user typed. Validated, then probed — never assumed to be a ZimaOS box. */
export const directStrategy = (host: string, port = MDNS_PORT): Result<StrategyOutcome> => {
  const trimmed = host.trim()
  if (trimmed.length === 0) {
    return err(appError('parameters', 'empty host', 'error.parameters'))
  }
  // Reject anything that is not a plausible host or IP. This is input validation, not a
  // reachability claim.
  if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
    return err(appError('parameters', `invalid host "${trimmed}"`, 'error.invalidHost', { host: trimmed }))
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return err(appError('parameters', `invalid port ${port}`, 'error.invalidPort', { port }))
  }

  return ok({
    kind: 'direct',
    candidates: [{ kind: 'direct', host: trimmed, port, priority: 0 }],
    unavailableReason: null,
  })
}

/**
 * Peers on an already-running Tailscale tunnel.
 *
 * Detection only: nothing is started, no DNS is touched, no route is claimed. The reason
 * is a reported user complaint about the official client — it takes ZeroTier over for its
 * remote access, which displaces the user's own DNS, so their AdGuard filtering stops
 * working and they have to pick one or the other. Using a tunnel that is already up costs
 * the user nothing they had before.
 *
 * Peers are candidates, not devices. `probe` decides, exactly as it does for LAN and
 * direct addresses — measured 2026-07-30 on a real tailnet: of four online peers, three
 * answered as ZimaOS (including one named "ZimaBoard", which a hostname filter would have
 * dropped) and `homeassistant` was refused.
 */
export const tailscaleStrategy = async (port = MDNS_PORT): Promise<StrategyOutcome> => {
  const runtime = await readTailscale()
  if (isErr(runtime)) {
    return { kind: 'tailscale', candidates: [], unavailableReason: runtime.error.message }
  }
  if (!runtime.value.installed) {
    // Not installed is a state, not a fault. Named anyway, so the UI can say why the route
    // is missing instead of showing an empty list that reads as "no device found".
    return { kind: 'tailscale', candidates: [], unavailableReason: 'tailscale is not installed' }
  }
  if (runtime.value.problem !== null) {
    return { kind: 'tailscale', candidates: [], unavailableReason: runtime.value.problem }
  }

  const addresses = candidateAddresses(runtime.value)
  return {
    kind: 'tailscale',
    candidates: addresses.map((host, index) => ({
      kind: 'tailscale' as const,
      host,
      port,
      priority: index,
    })),
    // An empty list with a Running backend means the tailnet has no other online peer —
    // a fact about the tailnet, not a failure of this strategy.
    unavailableReason:
      addresses.length === 0
        ? `tailscale is ${runtime.value.backendState ?? 'in an unknown state'} with no online peers`
        : null,
  }
}

/**
 * Remote ID over ZeroTier — the third way in, alongside the LAN scan and a typed address.
 *
 * The user's mental model, and the one the 0.9 client implemented: **type the Remote ID,
 * then sign in.** Joining a ZeroTier network is machinery, not a step the user performs —
 * an earlier version of this client exposed network join/leave as its own panel, which is
 * the wrong shape entirely.
 *
 * Measured 2026-07-30 on a real ZimaOS host:
 *
 *   the Remote ID IS the device's ZeroTier network id   `<remote-id>`
 *   the device reports its own address in that network  `ip: <x.y.0.1>`
 *   the network route is                                `<x.y>.0.0/16`
 *
 * So the device takes the first host address of its own network — which is also what the
 * 0.9 client derived, independently. Both agree, and the address is still only a candidate:
 * it goes through the same probe as every other route, because the device cannot be asked
 * where it is until it can be reached.
 */
export const remoteIdStrategy = async (
  remoteId: string,
  port = MDNS_PORT,
): Promise<StrategyOutcome> => {
  const networkId = remoteId.trim().toLowerCase()
  // 16 hex characters — the ZeroTier network id format. Validated before anything is
  // started, so a typo does not spawn a daemon and join nothing.
  if (!/^[0-9a-f]{16}$/.test(networkId)) {
    return {
      kind: 'remote-id',
      candidates: [],
      unavailableReason: `"${remoteId.trim().slice(0, 24)}" is not a 16-character Remote ID`,
    }
  }

  const joined = await zerotier.joinNetwork(networkId)
  if (isErr(joined)) {
    return { kind: 'remote-id', candidates: [], unavailableReason: joined.error.message }
  }

  const network = joined.value.networks.find((entry) => entry.networkId === networkId)
  if (network === undefined) {
    // The symptom is "accepted but absent". The cause is usually a daemon without
    // CAP_NET_ADMIN, which is checkable — so say that instead of restating the symptom.
    const blocked = await zerotier.joinBlockedReason()
    return {
      kind: 'remote-id',
      candidates: [],
      unavailableReason:
        blocked ??
        // `problem` carries why the network list could not be read at all. Dropping it left
        // "the daemon does not list it" standing in for an unreadable API — the symptom
        // wearing the cause's clothes.
        (joined.value.problem === null
          ? `joined ${networkId} but the daemon does not list it`
          : `joined ${networkId} but its state is unreadable: ${joined.value.problem}`),
    }
  }
  // ACCESS_DENIED is the one state worth naming on its own: it means a PRIVATE network
  // whose owner has not authorised this machine, and no amount of probing will help.
  if (network.status === 'ACCESS_DENIED') {
    return {
      kind: 'remote-id',
      candidates: [],
      unavailableReason: `network ${networkId} refused this machine (ACCESS_DENIED)`,
    }
  }

  const hosts = zerotier.deviceCandidates(network)
  return {
    kind: 'remote-id',
    candidates: hosts.map((host, index) => ({
      kind: 'remote-id' as const,
      host,
      port,
      priority: index,
    })),
    unavailableReason:
      hosts.length === 0
        ? `network ${networkId} is ${network.status} and announces no route to derive an address from`
        : null,
  }
}

/**
 * Probes every candidate concurrently and returns them ranked by measured latency, with
 * the user's priority as the tiebreak.
 *
 * The full probe list is returned, not just the winner: the UI shows why a path was
 * chosen, and a failed candidate keeps its distinct reason so "port closed" and "no
 * answer at all" remain different pieces of advice.
 */
export const rank = async (
  candidates: readonly DeviceAddress[],
): Promise<Result<{ best: DeviceAddress; probes: readonly ProbeResult[] }>> => {
  if (candidates.length === 0) {
    return err(appError('timeout', 'no candidate addresses to probe', 'device.nothingAnswered'))
  }

  const ordered = byPriority(candidates)
  const probes = await Promise.all(ordered.map((a) => probe(a.host, a.port)))
  const reachable = ordered
    .map((address, index) => ({ address, result: probes[index] }))
    .filter(
      (entry): entry is { address: DeviceAddress; result: ProbeResult } =>
        entry.result !== undefined && entry.result.reachable,
    )
    .sort((a, b) => (a.result.latencyMs ?? Infinity) - (b.result.latencyMs ?? Infinity))

  const winner = reachable[0]
  if (winner === undefined) {
    // Report the most informative failure rather than a generic one: a refused port and
    // a dropped packet call for different action from the user.
    const first = probes.find((p) => p?.failure !== null)
    return err(
      appError(
        first?.failure === 'refused' ? 'refused' : 'timeout',
        `no candidate answered (${probes.map((p) => p?.failure ?? '?').join(', ')})`,
        first?.failure === 'refused' ? 'error.refused' : 'error.timeout',
        { candidates: candidates.length },
      ),
    )
  }

  return ok({ best: winner.address, probes })
}

/** Convenience: run a strategy and rank its candidates in one step. */
export const connectVia = async (
  outcome: StrategyOutcome,
): Promise<Result<{ best: DeviceAddress; probes: readonly ProbeResult[] }>> => {
  if (outcome.unavailableReason !== null) {
    return err(
      appError('capability-missing', outcome.unavailableReason, 'error.strategyUnavailable', {
        kind: outcome.kind,
      }),
    )
  }
  const ranked = await rank(outcome.candidates)
  return isErr(ranked) ? ranked : ranked
}
