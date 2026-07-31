import { describe, expect, it } from 'vitest'
import { iconFetchAllowed, redirectAllowed } from '../urlPolicy'

/**
 * The icon URL comes from a store entry anyone can write, and the fetch happens in the main
 * process — inside the user's network. These tests are the record of what that is allowed to
 * reach.
 */

const DEVICE = '192.168.77.10'

describe('iconFetchAllowed', () => {
  it('allows ordinary public icon hosts', () => {
    for (const url of [
      'https://cdn.jsdelivr.net/gh/someone/icons/app.png',
      'https://raw.githubusercontent.com/x/y/main/icon.png',
      'http://icon.casaos.io/main/all/immich.png',
      'https://i.imgur.com/abc.png',
    ]) {
      expect(iconFetchAllowed(url, DEVICE), url).toMatchObject({ allowed: true })
    }
  })

  it('allows the device itself, private address and all', () => {
    // The exemption that makes the rule usable: the device lives on exactly the kind of
    // address the rule blocks, and its own icons are the normal case.
    expect(iconFetchAllowed(`http://${DEVICE}/icons/app.png`, DEVICE).allowed).toBe(true)
    expect(iconFetchAllowed(`http://${DEVICE}:8080/i.png`, DEVICE).allowed).toBe(true)
  })

  it('refuses the machine this client runs on', () => {
    for (const url of [
      'http://127.0.0.1:9997/network',
      'http://127.1.2.3/',
      'http://localhost:8080/icon.png',
      'http://app.localhost/icon.png',
      'http://[::1]:631/',
      'http://[::ffff:127.0.0.1]/',
      'http://0.0.0.0/',
    ]) {
      const verdict = iconFetchAllowed(url, DEVICE)
      expect(verdict.allowed, url).toBe(false)
      expect(verdict.reason, url).toBeTruthy()
    }
  })

  it('refuses other machines on the local network', () => {
    for (const url of [
      'http://192.168.99.1/reboot.cgi', // the router's admin page
      'http://10.0.0.5/',
      'http://172.16.4.4/',
      'http://169.254.169.254/latest/meta-data/', // cloud metadata
      'http://100.64.0.7/', // CGNAT — tailnets live here
      'http://[fe80::1]/',
      'http://[fd12:3456::1]/',
    ]) {
      expect(iconFetchAllowed(url, DEVICE).allowed, url).toBe(false)
    }
  })

  it('refuses schemes that are not http(s)', () => {
    // `file:///etc/passwd` in an icon field would ask the main process to read local disk.
    for (const url of ['file:///etc/passwd', 'ftp://host/i.png', 'data:image/png;base64,AAAA']) {
      expect(iconFetchAllowed(url, DEVICE).allowed, url).toBe(false)
    }
  })

  it('names a reason for every refusal', () => {
    // A refusal without a reason cannot be logged usefully, and "icon missing" then looks
    // the same as "icon blocked".
    const verdict = iconFetchAllowed('http://127.0.0.1/x.png', DEVICE)
    expect(verdict.allowed).toBe(false)
    expect(verdict.reason).toMatch(/localhost|private|loopback/i)
  })
})

describe('redirectAllowed', () => {
  const requested = 'https://cdn.example.com/icon.png'

  it('passes when nothing redirected', () => {
    expect(redirectAllowed(requested, requested, DEVICE).allowed).toBe(true)
  })

  it('passes a redirect between public hosts', () => {
    expect(redirectAllowed('https://cdn2.example.com/icon.png', requested, DEVICE).allowed).toBe(true)
  })

  it('catches the redirect into the local network — the way this is actually done', () => {
    // Without this the whole policy is decorative: a public URL that answers
    // `302 -> http://127.0.0.1:9997/…` reaches the local daemon anyway.
    const verdict = redirectAllowed('http://127.0.0.1:9997/network', requested, DEVICE)
    expect(verdict.allowed).toBe(false)
    expect(verdict.reason).toMatch(/redirected/)
  })
})
