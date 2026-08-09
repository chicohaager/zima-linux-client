import { describe, expect, it } from 'vitest'
import { ALLOWED_ADDRESS, findPrivate } from '../../../../scripts/screenshot-guard.mjs'

/**
 * The guard that stands between the screenshot script and the README.
 *
 * 🔴 Why it exists, measured 2026-08-09: the first run of `npm run screenshots` wrote the
 * author's real tailnet into the first picture — its name, three peer hostnames and their
 * 100.x addresses. The device in those pictures is a scrubbed recording, and I took that as
 * covering the screen. It does not: the Tailscale panel asks the LOCAL daemon, which is real.
 * A recording vouches for what it recorded and for nothing else that shares the screen.
 *
 * It was caught by a human looking at a picture. That is not a mechanism, so this is one.
 */
describe('the screenshot privacy guard', () => {
  const TAILSCALE_PANEL = [
    'Tailscale',
    'Detected, not managed. This client uses a tunnel that is already running.',
    'Tailnet: example-tailnet.invalid',
    'some-host',
    '203.0.113.10 · linux',
    'another-host',
    '203.0.113.11 · linux',
  ].join('\n')

  it('catches the panel that leaked — addresses and the tailnet label', () => {
    const found = findPrivate(TAILSCALE_PANEL)
    expect(found.count).toBe(2)
    expect(found.labels).toContain('Tailnet')
  })

  it('never returns the address it caught, only its first octet', () => {
    const found = findPrivate(TAILSCALE_PANEL)
    // The point of masking: this guard reports into a log, and a guard that prints the value
    // writes it into the place it exists to keep it out of.
    expect(found.masked).toEqual(['203.x.x.x'])
    // Not "does it look masked" but "is the original gone": the three octets that identify a
    // machine must not survive anywhere in what the guard hands to a log.
    for (const address of ['203.0.113.10', '203.0.113.11']) {
      const tail = address.split('.').slice(1).join('.')
      expect(found.masked.join(' ')).not.toContain(tail)
    }
  })

  it('passes a screen that only shows the replayed device', () => {
    const replayed = [
      'Device',
      `Connected to ${ALLOWED_ADDRESS}`,
      'ZimaOS 1.7.0',
      'redacted-name-1',
      'redacted-name-2',
    ].join('\n')
    const found = findPrivate(replayed)
    expect(found.count).toBe(0)
    expect(found.labels).toEqual([])
  })

  it('catches an address even when no tailnet label is anywhere near it', () => {
    // The label and the addresses are two independent signals on purpose. A future panel
    // that shows an address without the word "Tailnet" must not walk through.
    const found = findPrivate('Peer reachable at 192.0.2.4')
    expect(found.count).toBe(1)
    expect(found.masked).toEqual(['192.x.x.x'])
  })

  it('catches the label even when every address on screen is the replayed one', () => {
    const found = findPrivate(`Tailnet: example.invalid\nHost ${ALLOWED_ADDRESS}`)
    expect(found.count).toBe(0)
    expect(found.labels).toContain('Tailnet')
  })
})

/**
 * 🔴 The second live source on the same screen, found in the same session.
 *
 * `--user-data-dir` moves Electron's own storage and nothing else. The "take over from the old
 * client" panel reads the running user's `~/.config`, and it rendered three real paths — user
 * name in each — beside the addresses those installations last connected to. A profile of its
 * own was not a home of its own, and the difference was three lines of private data.
 */
describe('the screenshot privacy guard, on home paths', () => {
  const IMPORT_PANEL = [
    'Take over from the old client',
    '/home/someone/.config/zima-client',
    '1 connection(s), 1 backup job(s), last host 192.0.2.5',
    '/home/someone/.config/zimaos-client',
  ].join('\n')

  it('catches the paths the import panel renders', () => {
    const found = findPrivate(IMPORT_PANEL)
    expect(found.homes).toEqual(['/home/<user>'])
  })

  it('never returns the user name it caught', () => {
    const found = findPrivate(IMPORT_PANEL)
    for (const entry of found.homes) expect(entry).not.toContain('someone')
  })

  it('passes a run whose home is the throwaway one under the temp directory', () => {
    const found = findPrivate('Log file\n/tmp/zima-shots-home-abc123/.config/zima-linux-client')
    expect(found.homes).toEqual([])
    expect(found.count).toBe(0)
  })
})
