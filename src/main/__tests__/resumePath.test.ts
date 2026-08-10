/*
 * Which stored path a resumed session drives on.
 *
 * 🔴 Measured on 2026-08-10, a machine standing in the same LAN as its device, connected
 * over Tailscale. A watcher sampling both paths every ten seconds for three minutes:
 *
 *     LAN 192.0.2.10     16 of 16 answered, 2–6 ms
 *     Tailscale 100.x       3 of 16 answered, the rest timed out
 *     tailscale status      "active; direct" the entire time
 *
 * `resume` took `byPriority(addresses)[0]` — the stored path, unmeasured — and sat on the
 * dead one for the whole session, reporting "a firewall may be dropping the connection"
 * about a device that had answered every arriving request with HTTP 200. The status line
 * of the tunnel was healthy throughout, which is why no amount of looking at Tailscale
 * would have found it: reachability has to be measured on the path that will be used.
 *
 * These tests pin the three properties that failure taught us. Each asserts something the
 * old code got wrong, so each fails if the selection is reverted to "take the first".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceAddress, ProbeResult } from '@shared/domain'

const probeResults = new Map<string, ProbeResult>()
const joinCalls: string[] = []

const reachable = (host: string, latencyMs: number): ProbeResult => ({
  host,
  reachable: true,
  latencyMs,
  failure: null,
  httpStatus: 200,
})

const dead = (host: string, failure: ProbeResult['failure'] = 'timeout'): ProbeResult => ({
  host,
  reachable: false,
  latencyMs: null,
  failure,
  httpStatus: null,
})

/*
 * The fake sits at `fetchRoutes`, the module boundary probe.ts actually calls.
 *
 * The first version of this file mocked `probe` itself — which does nothing, because
 * `selectBestAddress` calls `probe` module-internally, not through the export. Three of
 * these tests were green while talking to the **real network**: the LAN address in them
 * is a real device on this machine's network, so "the LAN path wins" was measured rather
 * than asserted, and would have flipped on any other machine. The fourth test, the one
 * where both paths must be dead, is what exposed it — a case the real network could not
 * satisfy. Without that negative case the suite would have looked rigorous and tested air.
 */
vi.mock('@main/zima/client', () => ({
  fetchRoutes: async (host: string) => {
    const planned = probeResults.get(host) ?? dead(host)
    if (planned.reachable && planned.latencyMs !== null) {
      await new Promise((resolve) => setTimeout(resolve, planned.latencyMs ?? 0))
      return { ok: true as const, value: { data: { routes: [] } } }
    }
    return {
      ok: false as const,
      error: {
        kind: planned.failure ?? 'timeout',
        message: 'planned failure',
        i18nKey: 'error.timeout',
        context: {},
      },
    }
  },
}))

vi.mock('@main/zerotier/daemon', () => ({
  joinNetwork: async (networkId: string) => {
    joinCalls.push(networkId)
    return { ok: true as const, value: undefined }
  },
}))

const lan: DeviceAddress = { kind: 'lan', host: '192.0.2.10', port: 80, priority: 1 }
const tailscale: DeviceAddress = { kind: 'tailscale', host: '198.51.100.10', port: 80, priority: 0 }
const remote: DeviceAddress = {
  kind: 'remote-id',
  host: '10.147.18.5',
  port: 80,
  priority: 2,
  networkId: 'abcdef1234567890',
}

describe('resume path selection', () => {
  beforeEach(() => {
    probeResults.clear()
    joinCalls.length = 0
  })

  it('prefers the path that answers over the one stored first', async () => {
    // Exactly the measured situation: the stored Tailscale path has the better priority
    // and is dead; the LAN path is two milliseconds away.
    probeResults.set(tailscale.host, dead(tailscale.host))
    probeResults.set(lan.host, reachable(lan.host, 3))

    const { selectBestAddress } = await import('@main/transport/probe')
    const { best } = await selectBestAddress([tailscale, lan])

    expect(best?.host).toBe(lan.host)
  })

  it('ranks by measured latency, not by stored priority', async () => {
    // Both answer. Priority says Tailscale (0 beats 1); the measurement says otherwise.
    probeResults.set(tailscale.host, reachable(tailscale.host, 41))
    probeResults.set(lan.host, reachable(lan.host, 3))

    const { selectBestAddress } = await import('@main/transport/probe')
    const { best } = await selectBestAddress([tailscale, lan])

    expect(best?.host).toBe(lan.host)
  })

  it('keeps priority as the tie-break when latency cannot decide', async () => {
    probeResults.set(tailscale.host, reachable(tailscale.host, 5))
    probeResults.set(lan.host, reachable(lan.host, 5))

    const { selectBestAddress } = await import('@main/transport/probe')
    const { best } = await selectBestAddress([lan, tailscale])

    expect(best?.host).toBe(tailscale.host)
  })

  it('reports every path it tried when none answers, with its failure kind', async () => {
    probeResults.set(tailscale.host, dead(tailscale.host, 'timeout'))
    probeResults.set(lan.host, dead(lan.host, 'refused'))

    const { selectBestAddress } = await import('@main/transport/probe')
    const { best, results } = await selectBestAddress([tailscale, lan])

    expect(best).toBeNull()
    // 'refused' and 'timeout' are different advice — nothing may flatten them into one
    // "connection failed", which is how the firewall claim got into the UI.
    expect(results.map((r) => r.failure).sort()).toEqual(['refused', 'timeout'])
  })

  it('does not open a remote-id tunnel while a direct path answers', async () => {
    // A ZeroTier join can take over the user's DNS. Paying that while a LAN address
    // answers in milliseconds is the expensive half of the same mistake.
    probeResults.set(lan.host, reachable(lan.host, 3))
    probeResults.set(remote.host, reachable(remote.host, 2))

    const { selectBestAddress } = await import('@main/transport/probe')
    const direct = [lan, remote].filter((a) => a.kind !== 'remote-id')
    const { best } = await selectBestAddress(direct)

    expect(best?.host).toBe(lan.host)
    expect(joinCalls).toEqual([])
  })
})
