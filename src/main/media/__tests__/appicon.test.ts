/*
 * The app-icon path of `zima-media://`, which had NO test at all — and that is exactly how
 * it could be completely broken while every gate stayed green.
 *
 * 🔴 Measured 2026-07-31 in the running client: 24 icon fetches in one session refused with
 * `app icon refused: redirected to a host that not a URL`, all from legitimate CDNs
 * (jsdelivr, raw.githubusercontent, imgur, github). No redirect was involved. Electron's
 * `net.fetch` returns `response.url === ''` on every answer, the redirect check compared
 * that against the requested URL, decided "landed somewhere else", ran `new URL('')` and
 * refused. The image bytes had already arrived and were thrown away by our own guard.
 *
 * `urlPolicy.test.ts` was green throughout — it feeds the rule well-formed URLs, which is
 * the one thing the real caller never did. The gap was not in the rule, it was in what the
 * rule was fed, so the test has to live at the caller.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const deviceContext = vi.fn()
let handler: ((request: Request) => Promise<Response>) | null = null

vi.mock('electron', () => ({
  protocol: {
    handle: (_scheme: string, fn: (request: Request) => Promise<Response>): void => {
      handler = fn
    },
    registerSchemesAsPrivileged: (): void => {},
  },
  // Present so an accidental return to `net.fetch` fails loudly instead of silently
  // reintroducing the empty-`url` bug this file exists for.
  net: {
    fetch: (): never => {
      throw new Error('net.fetch must not be used for app icons — its response.url is always empty')
    },
  },
}))

vi.mock('@main/logging/logger', () => ({
  logger: { info: (): void => {}, warn: (): void => {}, error: (): void => {}, debug: (): void => {} },
}))

vi.mock('@main/session', () => ({ deviceContext: (): unknown => deviceContext() }))

vi.mock('@main/zima/client', () => ({
  fetchBinary: (): unknown => ({ ok: false, error: { kind: 'internal', message: 'not used here' } }),
}))

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** An answer shaped like the one Node's fetch really produces: `url` is the landing URL. */
const imageResponse = (landedAt: string): Response => {
  const response = new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } })
  Object.defineProperty(response, 'url', { value: landedAt })
  return response
}

const iconRequest = async (target: string): Promise<Response> => {
  const module = await import('@main/media/protocol')
  module.registerMediaProtocol()
  const url = module.mediaUrl('appicon', target)
  if (handler === null) throw new Error('handler was never registered')
  return handler(new Request(url))
}

beforeEach(() => {
  vi.resetModules()
  handler = null
  deviceContext.mockReturnValue(
    Promise.resolve({ ok: true, value: { host: '10.0.0.5', port: 80, token: 'tok' } }),
  )
})

describe('zima-media://appicon', () => {
  it('serves an icon that came back from the host it was asked for', async () => {
    /*
     * The regression guard. With Electron's `net.fetch` this answer carries `url: ''`,
     * the redirect check refuses it, and this test goes red with a 404 whose body reads
     * "redirected to a host that not a URL" — the exact line from the production log.
     */
    const target = 'https://cdn.jsdelivr.net/gh/selfhst/icons/png/immich.png'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(imageResponse(target)))

    const response = await iconRequest(target)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG)
  })

  it('serves an icon that followed a redirect to another public host', async () => {
    // github.com -> raw.githubusercontent.com, measured with Node's fetch on the real URL.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        imageResponse('https://raw.githubusercontent.com/selfhst/icons/main/png/immich.png'),
      ),
    )

    const response = await iconRequest('https://github.com/selfhst/icons/raw/main/png/immich.png')

    expect(response.status).toBe(200)
  })

  it('refuses an icon that redirected into the private network', async () => {
    // The reason the check exists: a public CDN answering 302 -> http://192.168.1.1/reboot
    // would otherwise turn this client into a request generator inside the user's LAN.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(imageResponse('http://192.168.1.1/reboot')))

    const response = await iconRequest('https://cdn.jsdelivr.net/gh/x/y.png')

    expect(response.status).toBe(404)
    expect(await response.text()).toContain('private or loopback range')
  })

  it('refuses — and says so honestly — when the fetch reports no final URL', async () => {
    /*
     * Exactly what Electron's net.fetch produces. Failing closed is right; the assertion
     * that matters is the WORDING: the old message claimed a redirect that never happened
     * and sent the reader looking for one.
     */
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(imageResponse('')))

    const response = await iconRequest('https://cdn.jsdelivr.net/gh/x/y.png')
    const body = await response.text()

    expect(response.status).toBe(404)
    expect(body).toContain('no final URL')
    expect(body).not.toContain('redirected to a host')
  })
})
