import type { ConnectionKind, DeviceAddress, DiscoveredDevice, ProbeResult } from '@shared/domain'
import { appError, err, isErr, ok, type Result } from '@shared/result'
import { discover } from '@main/discovery/mdns'
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
 * Remote ID over ZeroTier.
 *
 * NOT wired up yet. It needs the bundled zerotier-one lifecycle, which is phase 3b of docs/V2-PLAN.md.
 * It returns an explicit `unavailableReason` rather than an empty candidate list,
 * because an empty list would render as "no device found" — a different statement from
 * "this route does not exist yet in this build".
 */
export const remoteIdStrategy = (remoteId: string): StrategyOutcome => ({
  kind: 'remote-id',
  candidates: [],
  unavailableReason: `remote-id not implemented in this build (requested: ${remoteId.slice(0, 16)})`,
})

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
