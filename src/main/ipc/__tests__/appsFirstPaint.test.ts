/*
 * How long the Apps screen stays empty when there are tiles on disk.
 *
 * 🔴 Reported 2026-07-31 ("Apps sagt ewig: wird geladen") and named by the client's own
 * request log: `installed/list` took 3 141 ms once and later hit the 8 s limit
 * (`request-failed … ms:8002 … aborted`) — and only after that did `apps.served-from-cache`
 * appear. The tiles had been on disk the whole time.
 *
 * Measured BEFORE changing anything, with the real session token over the same tunnel
 * (`npm run verify:live`): installed/list 12 ms, web/appgrid 113 ms, mode=async 7 ms,
 * mode=sync 9 ms. The endpoint is not the cause, so this file does not test an endpoint —
 * it tests that a known app list is never held hostage by a refresh, whatever makes the
 * refresh slow.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppTile } from '@shared/domain'

const handlers = new Map<string, (input: unknown) => Promise<unknown>>()
const listApps = vi.fn()
const cacheRead = vi.fn()
const cacheWrite = vi.fn()

vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }))
vi.mock('@main/logging/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('@main/app/appWindow', () => ({ openInWindow: vi.fn() }))
vi.mock('@main/devices/registry', () => ({ activeDeviceId: (): string => 'device-1' }))
vi.mock('@main/session', () => ({ activeHost: (): string => '10.147.20.5' }))
vi.mock('@main/zima/apps', () => ({
  listApps: (): unknown => listApps(),
  webUiUrl: (): null => null,
  setAppRunning: vi.fn(),
}))
vi.mock('@main/cache/appsCache', () => ({
  read: (): unknown => cacheRead(),
  write: (...args: unknown[]): unknown => cacheWrite(...args),
}))
vi.mock('@main/ipc/wire', () => ({
  handle: (channel: string, fn: (input: unknown) => Promise<unknown>): void => {
    handlers.set(channel, fn)
  },
  wireError: (error: unknown): unknown => ({ ok: false, error }),
  // The real one resolves a device context first; here the body is simply run, so the test
  // exercises this module's own logic rather than the session plumbing.
  withDevice: async (body: (ctx: unknown) => Promise<unknown>): Promise<unknown> =>
    body({ host: '10.147.20.5', port: 80, token: 'tok' }),
}))

const tile = (name: string): AppTile => ({
  id: `zimaapp://v2app/${name}`,
  name,
  title: {},
  iconUrl: '',
  status: 'running',
  installStatus: 'completed',
  port: 8080,
  scheme: 'http',
  index: '/',
  appType: 'v2app',
})

interface ListAnswer {
  readonly ok: boolean
  readonly value?: { readonly apps: readonly { readonly name: string }[]; readonly cachedAtMs: number | null }
}

/*
 * Registration is awaited SEPARATELY from the call on purpose. Under fake timers a helper
 * that imports and calls in one await hands control back before the module is loaded, so
 * `advanceTimersByTime` runs before the deadline timer exists — the timer is then scheduled
 * into a clock that has already moved on and never fires. The first version of this file
 * failed that way, and the symptom (a five-second test timeout) looked exactly like the bug
 * under test.
 */
const registerHandlers = async (): Promise<(input: unknown) => Promise<ListAnswer>> => {
  const module = await import('@main/ipc/appsHandlers')
  module.registerAppsHandlers()
  const handler = handlers.get('apps:list')
  if (handler === undefined) throw new Error(`apps:list not registered — got ${[...handlers.keys()].join(', ')}`)
  return handler as (input: unknown) => Promise<ListAnswer>
}

const callList = async (): Promise<ListAnswer> => (await registerHandlers())({})

beforeEach(() => {
  vi.resetModules()
  handlers.clear()
  listApps.mockReset()
  cacheRead.mockReset()
  cacheWrite.mockReset()
  vi.useFakeTimers()
})

describe('apps:list first paint', () => {
  it('answers from the cache instead of waiting out a slow refresh', async () => {
    /*
     * 🔴 The regression guard. With the old order — await the refresh, fall back to the
     * cache only after it fails — this call cannot resolve at all while the device is
     * silent, and the test fails on the timeout: exactly the eight seconds the user saw.
     */
    listApps.mockReturnValue(new Promise(() => {})) // a device that never answers
    cacheRead.mockReturnValue({ apps: [tile('immich'), tile('n8n')], cachedAtMs: 1_700_000_000_000 })

    const handler = await registerHandlers()
    const pending = handler({})
    await vi.advanceTimersByTimeAsync(750)
    const answer = await pending

    expect(answer.ok).toBe(true)
    expect(answer.value?.apps.map((a) => a.name)).toEqual(['immich', 'n8n'])
    // Dated, and says so — a cache presented as live state would report a stopped app as
    // running. That rule is older than this change and has to survive it.
    expect(answer.value?.cachedAtMs).toBe(1_700_000_000_000)
  })

  it('still answers fresh when the device is healthy', async () => {
    // The common case measured at 12 ms. It must not be pushed onto the cache path, or the
    // UI would permanently show "as of …" for a device that is answering perfectly.
    listApps.mockResolvedValue({ ok: true, value: [tile('immich')] })
    cacheRead.mockReturnValue({ apps: [tile('stale')], cachedAtMs: 1 })

    const answer = await callList()

    expect(answer.value?.apps.map((a) => a.name)).toEqual(['immich'])
    expect(answer.value?.cachedAtMs).toBeNull()
    expect(cacheWrite).toHaveBeenCalledTimes(1)
  })

  it('waits when there is nothing cached, rather than claiming there are no apps', async () => {
    // An empty list here would read as "you have no apps installed" — a statement about the
    // user's device instead of about this client's knowledge.
    listApps.mockResolvedValue({ ok: true, value: [tile('immich')] })
    cacheRead.mockReturnValue(null)

    const answer = await callList()

    expect(answer.value?.apps.map((a) => a.name)).toEqual(['immich'])
    expect(answer.value?.cachedAtMs).toBeNull()
  })

  it('passes the device error through when there is no cache to fall back to', async () => {
    listApps.mockResolvedValue({ ok: false, error: { kind: 'timeout', message: 'aborted' } })
    cacheRead.mockReturnValue(null)

    const answer = await callList()

    expect(answer.ok).toBe(false)
  })

  it('shares one refresh between callers instead of stacking requests on a slow device', async () => {
    /*
     * The renderer polls while it is showing dated tiles. Without single-flight, every poll
     * would open another request against a device that is already struggling — the failure
     * mode this fix must not create while removing the wait.
     */
    listApps.mockReturnValue(new Promise(() => {}))
    cacheRead.mockReturnValue({ apps: [tile('immich')], cachedAtMs: 5 })

    const handler = await registerHandlers()
    const first = handler({})
    const second = handler({})
    await vi.advanceTimersByTimeAsync(750)
    await Promise.all([first, second])

    expect(listApps).toHaveBeenCalledTimes(1)
  })
})
