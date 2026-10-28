import { describe, expect, it } from 'vitest'
import { waitForJoin, type JoinSnapshot } from '../joinWait'

/**
 * The wrong answer this guards against, measured on 2026-10-28 against a ZimaOS 1.8.0 box:
 * a node with a FRESH identity sat in REQUESTING_CONFIGURATION for 5.2 s after the join, and
 * the client gave up after the network merely appeared in the list — about one second. The
 * user saw "announces no route to derive an address from" on the very first Remote-ID
 * connect, and the same click worked a minute later.
 */

const ID = '0123456789abcdef'

/** A daemon whose answers are scripted, one per read; the last one repeats. */
const scripted = (states: ReadonlyArray<string | null>) => {
  let reads = 0
  const read = async (): Promise<JoinSnapshot> => {
    const state = states[Math.min(reads, states.length - 1)] ?? null
    reads += 1
    return { networks: state === null ? [] : [{ networkId: ID, status: state }] }
  }
  return { read, reads: () => reads }
}

/** Time advances only through `sleep`, so the budgets are tested without waiting for them. */
const clock = () => {
  let now = 0
  return { now: () => now, sleep: async (ms: number) => { now += ms } }
}

describe('waitForJoin', () => {
  it('waits through REQUESTING_CONFIGURATION until the controller answers', async () => {
    // 5.2 s measured; 250 ms steps → about 21 reads in that state before OK.
    const daemon = scripted([null, ...Array<string>(21).fill('REQUESTING_CONFIGURATION'), 'OK'])
    const time = clock()
    const result = await waitForJoin(ID, daemon.read, { ...time, listMs: 3_000, configMs: 30_000, stepMs: 250 })
    expect(result.networks[0]?.status).toBe('OK')
  })

  it('stops at once on a decided state other than OK', async () => {
    // ACCESS_DENIED is an answer, not a delay — waiting longer cannot change it.
    const daemon = scripted(['REQUESTING_CONFIGURATION', 'ACCESS_DENIED', 'OK'])
    const time = clock()
    const result = await waitForJoin(ID, daemon.read, { ...time, listMs: 3_000, configMs: 30_000, stepMs: 250 })
    expect(result.networks[0]?.status).toBe('ACCESS_DENIED')
    expect(daemon.reads()).toBe(2)
  })

  it('gives up after the configuration budget and returns the state it last saw', async () => {
    const daemon = scripted(['REQUESTING_CONFIGURATION'])
    const time = clock()
    const result = await waitForJoin(ID, daemon.read, { ...time, listMs: 3_000, configMs: 30_000, stepMs: 250 })
    expect(result.networks[0]?.status).toBe('REQUESTING_CONFIGURATION')
    expect(time.now()).toBeGreaterThanOrEqual(30_000)
    expect(time.now()).toBeLessThan(31_000)
  })

  it('gives up on an unlisted network after the short listing budget, not the long one', async () => {
    // An id the daemon never lists is a different fault (no capability, see diagnosis.ts);
    // it must not cost the user the configuration budget on top.
    const daemon = scripted([null])
    const time = clock()
    const result = await waitForJoin(ID, daemon.read, { ...time, listMs: 3_000, configMs: 30_000, stepMs: 250 })
    expect(result.networks).toHaveLength(0)
    expect(time.now()).toBeLessThan(3_500)
  })

  it('returns without sleeping when the network is already configured', async () => {
    const daemon = scripted(['OK'])
    const time = clock()
    await waitForJoin(ID, daemon.read, { ...time, listMs: 3_000, configMs: 30_000, stepMs: 250 })
    expect(time.now()).toBe(0)
  })
})
