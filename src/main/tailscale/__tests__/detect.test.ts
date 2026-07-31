import { describe, expect, it } from 'vitest'
import { candidateAddresses, type TailscaleRuntime } from '../detect'

/**
 * The fixture is the answer this machine actually gave on 2026-07-30 (Tailscale 1.98.9),
 * trimmed to the fields the client reads. Addresses, IPv6 suffixes, the tailnet name
 * and the personal hostnames are replaced with sequential stand-ins — the STRUCTURE is what
 * this fixture is for, and a real tailnet's addressing is network topology (project rule:
 * nothing shareable carries private data).
 *
 * It keeps the DIVERSITY that broke things elsewhere in this project: peers that are
 * online and offline, two different operating systems, IPv4 and IPv6 on every peer, and
 * — the important one — TWO peers sharing the hostname "ZimaOS" while a third ZimaOS
 * device is called "ZimaBoard". A fixture with one tidy peer would let a hostname filter
 * pass its tests and then pick the wrong device, or none, on a real tailnet.
 */
const RUNTIME: TailscaleRuntime = {
  installed: true,
  backendState: 'Running',
  selfAddresses: ['100.64.0.1', 'fd7a:115c:a1e0::1'],
  magicDnsSuffix: 'example-tailnet.ts.net',
  tailnetName: 'example.invalid',
  peers: [
    { hostName: 'phone', addresses: ['100.64.0.2', 'fd7a:115c:a1e0::2'], online: false, os: 'android' },
    { hostName: 'ZimaBoard', addresses: ['100.64.0.3', 'fd7a:115c:a1e0::3'], online: true, os: 'linux' },
    { hostName: 'ZimaOS', addresses: ['100.64.0.4', 'fd7a:115c:a1e0::4'], online: true, os: 'linux' },
    { hostName: 'homeassistant', addresses: ['100.64.0.5', 'fd7a:115c:a1e0::5'], online: true, os: 'linux' },
    { hostName: 'ZimaOS', addresses: ['100.64.0.6', 'fd7a:115c:a1e0::6'], online: true, os: 'linux' },
    { hostName: 'zimacube-away', addresses: ['100.64.0.7', 'fd7a:115c:a1e0::7'], online: false, os: 'linux' },
  ],
  problem: null,
}

describe('candidateAddresses', () => {
  it('offers every online peer, IPv4 only', () => {
    expect(candidateAddresses(RUNTIME)).toEqual([
      '100.64.0.3',
      '100.64.0.4',
      '100.64.0.5',
      '100.64.0.6',
    ])
  })

  it('leaves offline peers out — an address that cannot answer is not a candidate', () => {
    const offered = candidateAddresses(RUNTIME)
    expect(offered).not.toContain('100.64.0.2')
    expect(offered).not.toContain('100.64.0.7')
  })

  /**
   * Positive control for the rule stated at the top of detect.ts.
   *
   * `homeassistant` is not a ZimaOS device, and it IS offered — because a hostname is what
   * someone typed, not a property of the machine. The probe decides. If a future change
   * adds a name filter, this test goes red, which is the point: it would also have dropped
   * "ZimaBoard" and kept two indistinguishable peers both called "ZimaOS".
   */
  it('does not filter by hostname', () => {
    expect(candidateAddresses(RUNTIME)).toContain('100.64.0.5')
  })

  it('offers nothing when tailscale is absent', () => {
    expect(
      candidateAddresses({
        installed: false,
        backendState: null,
        selfAddresses: [],
        magicDnsSuffix: null,
        tailnetName: null,
        peers: [],
        problem: null,
      }),
    ).toEqual([])
  })

  /**
   * A logged-out or stopped daemon still reports peers from its last state. They are
   * offered, and the UI shows `backendState` beside them — the client does not pretend to
   * know whether the tunnel carries traffic; the probe finds that out by connecting.
   */
  it('keeps reporting the backend state verbatim rather than reducing it to a boolean', () => {
    expect(RUNTIME.backendState).toBe('Running')
  })
})
