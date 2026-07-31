/*
 * Icon URLs the device hands out, seen from a client that is NOT on the device's network.
 *
 * 🔴 Measured 2026-07-31 over a Remote-ID connection: 36 tiles had their logo and two showed
 * a bare letter. Those two carry icons served by the apps themselves, and the device names
 * them by its LAN address — an address the laptop on the tunnel can neither reach nor, by
 * `urlPolicy`, is allowed to try.
 *
 * Every URL below is a real one from that session, and the reachability of the rewritten
 * form was measured over the tunnel before this test was written:
 *   http://<device>:8086/static/logo.png -> 200 image/png       1 499 594 bytes
 *   http://<device>:8718/icon.svg        -> 200 image/svg+xml         260 bytes
 */
import { describe, expect, it } from 'vitest'
import { reachableIconUrl } from '@main/zima/apps'

// The tunnel address this client is actually talking to, and the device's own LAN address.
const TUNNEL = '10.147.20.5'
const LAN = '192.168.0.143'

describe('reachableIconUrl', () => {
  it('points an app-hosted icon at the address this client is actually using', () => {
    expect(reachableIconUrl(`http://${LAN}:8086/static/logo.png`, 8086, TUNNEL)).toBe(
      `http://${TUNNEL}:8086/static/logo.png`,
    )
    expect(reachableIconUrl(`http://${LAN}:8718/icon.svg`, 8718, TUNNEL)).toBe(
      `http://${TUNNEL}:8718/icon.svg`,
    )
  })

  it('leaves a CDN icon exactly as it is', () => {
    // 33 of the 36 that worked came from these. Rewriting them would break what works.
    for (const url of [
      'https://cdn.jsdelivr.net/gh/selfhst/icons/png/immich.png',
      'https://raw.githubusercontent.com/selfhst/icons/main/png/n8n.png',
      'https://i.imgur.com/abc123.png',
    ]) {
      expect(reachableIconUrl(url, 8080, TUNNEL)).toBe(url)
    }
  })

  it('does NOT aim some other private address at the device', () => {
    /*
     * The line this rewrite must not cross. An icon field is written by whoever wrote the
     * store entry; `http://192.168.1.1/reboot` is the router, not this app's icon. Because
     * the port does not match the app's published one, it stays untouched — and therefore
     * stays refused by the media policy — instead of being redirected onto the device,
     * which is the one host that policy exempts.
     */
    expect(reachableIconUrl('http://192.168.1.1/reboot', 8086, TUNNEL)).toBe(
      'http://192.168.1.1/reboot',
    )
    expect(reachableIconUrl('http://192.168.0.1:9997/admin', 8086, TUNNEL)).toBe(
      'http://192.168.0.1:9997/admin',
    )
    // No published port at all: nothing to match against, so nothing is vouched for.
    expect(reachableIconUrl(`http://${LAN}:8086/static/logo.png`, null, TUNNEL)).toBe(
      `http://${LAN}:8086/static/logo.png`,
    )
  })

  it('leaves an icon that already names the active host alone', () => {
    const url = `http://${TUNNEL}:8086/static/logo.png`
    expect(reachableIconUrl(url, 8086, TUNNEL)).toBe(url)
  })

  it('hands on something that is not a URL instead of repairing it', () => {
    // The media policy answers this one with a reason. Quietly turning it into a device URL
    // would invent a target the store entry never named.
    expect(reachableIconUrl('logo.png', 8086, TUNNEL)).toBe('logo.png')
    expect(reachableIconUrl('', 8086, TUNNEL)).toBe('')
  })

  it('matches the default port when the URL states none', () => {
    // An app published on 80 whose icon URL omits the port is the same case, written shorter.
    expect(reachableIconUrl(`http://${LAN}/logo.png`, 80, TUNNEL)).toBe(`http://${TUNNEL}/logo.png`)
    expect(reachableIconUrl(`https://${LAN}/logo.png`, 443, TUNNEL)).toBe(
      `https://${TUNNEL}/logo.png`,
    )
    // …and a mismatch still stays put.
    expect(reachableIconUrl(`http://${LAN}/logo.png`, 8086, TUNNEL)).toBe(`http://${LAN}/logo.png`)
  })
})
