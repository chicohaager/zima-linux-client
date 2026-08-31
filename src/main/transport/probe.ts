import type { DeviceAddress, ProbeResult } from '@shared/domain'
import { isOk } from '@shared/result'
import { fetchLiveness } from '@main/zima/client'

/**
 * Reachability is measured, never inferred.
 *
 * A bind address, a ping or an open socket somewhere else is not evidence that this
 * client can talk to this device. So a probe is a real request to the real gateway
 * from this process, and the three failure shapes stay distinct: 'refused' (someone
 * answered, nothing is listening), 'timeout' (nothing answered — likely dropped by a
 * firewall) and 'unexpected-status' (a service answered, but not ZimaOS).
 *
 * 🔴 The endpoint must be one that cannot demand a token, and that is not a detail — it is
 * the whole correctness of this file. A probe runs before the login by construction, so
 * against an authenticating endpoint it reports the state of the *authentication* while
 * claiming to report reachability, and a 401 becomes 'unexpected-status': "a service
 * answered, but not ZimaOS" — about a ZimaOS device that answered in 282 ms.
 *
 * That is not hypothetical. This probe called `fetchRoutes` (`/v1/gateway/routes`) until
 * 2026-08-31, when ZimaOS v1.7.1-beta1 started requiring a token there. Measured from the
 * user's own log, with the tunnel demonstrably up:
 *
 *     09:19:41 zerotier.joined {"networkId":"…"}
 *     09:19:41 /v1/gateway/routes status=401 ms=282        ← the path worked
 *     09:19:41 session.resume-no-path ["<lan>=timeout","<zerotier>=unexpected-status"]
 *
 * Every route in `session.ts` funnels through here, so a healthy device became unreachable
 * on all of them at once, with no way around it in the UI. Nothing in this repository had
 * changed — which is the point: an endpoint that *may* authenticate is a probe that may
 * start lying after somebody else's release.
 */
export const probe = async (
  host: string,
  port = 80,
  timeoutMs = 2_500,
): Promise<ProbeResult> => {
  const startedAt = performance.now()
  const result = await fetchLiveness(host, port)
  const elapsed = Math.round(performance.now() - startedAt)

  if (isOk(result)) {
    return { host, reachable: true, latencyMs: elapsed, failure: null, httpStatus: 200 }
  }

  const kind = result.error.kind
  const failure =
    kind === 'refused' || kind === 'timeout' || kind === 'dns'
      ? kind
      : 'unexpected-status'
  const status = result.error.context?.status
  void timeoutMs

  return {
    host,
    reachable: false,
    latencyMs: null,
    failure,
    httpStatus: typeof status === 'number' ? status : null,
  }
}

/**
 * Probes every address at once and returns them ordered by measured latency, using
 * the user's priority only to break ties.
 *
 * Returns the full list rather than just the winner: the UI shows why a path was
 * chosen, and an unreachable address keeps its failure reason so "port closed" and
 * "no answer at all" stay different pieces of advice.
 */
export const selectBestAddress = async (
  addresses: readonly DeviceAddress[],
): Promise<{ best: DeviceAddress | null; results: readonly ProbeResult[] }> => {
  if (addresses.length === 0) return { best: null, results: [] }

  const results = await Promise.all(addresses.map((a) => probe(a.host, a.port)))
  return { best: rankReachable(addresses, results)[0] ?? null, results }
}

/**
 * The ranking rule, separated from the measuring so it can be tested exactly.
 *
 * It was inline until a test tried to pin the tie-break by making two fakes answer "after
 * 5 ms" — real timers made that 5.1 and 5.3, latency decided, and the test went red on a
 * later run for no reason anyone could see. A property that only holds for *equal* values
 * cannot be tested through a stopwatch; it needs the values handed in.
 *
 * Unreachable addresses are dropped rather than sorted last: "slowest" and "did not answer"
 * are different things, and a list that ends in something unreachable invites picking it.
 */
export const rankReachable = (
  addresses: readonly DeviceAddress[],
  results: readonly ProbeResult[],
): readonly DeviceAddress[] =>
  addresses
    .map((address, i) => ({ address, result: results[i] }))
    .filter(
      (entry): entry is { address: DeviceAddress; result: ProbeResult } =>
        entry.result !== undefined && entry.result.reachable,
    )
    .sort((a, b) => {
      const byLatency = (a.result.latencyMs ?? Infinity) - (b.result.latencyMs ?? Infinity)
      return byLatency !== 0 ? byLatency : a.address.priority - b.address.priority
    })
    .map((entry) => entry.address)
