import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * That the failure path is CONNECTED, not merely present.
 *
 * `appWindowNotice.test.ts` proves the pages and the parser in isolation. Both could be
 * flawless while `openInWindow` listens for nothing — which is exactly the state this
 * client shipped in: the notice-building half did not exist, but neither did the wiring,
 * and only the wiring is what the user meets.
 *
 * Two behaviours are asserted here that were MEASURED against the shipped Electron in a
 * container, because both contradict the obvious guess:
 *
 *   - `loadURL` REJECTS on failure. Loading `http://192.0.2.1:8080/` rejected with
 *     `ERR_FAILED (-2)` and emitted **no events whatsoever** — so a `did-fail-load`
 *     listener on its own leaves that case silent for ever.
 *   - In the refused case BOTH fire (event at 21111 ms, rejection at 21117 ms), so the
 *     handler has to be idempotent or the user gets the page swapped underneath them.
 */

interface Handler {
  (...args: unknown[]): void
}

/** A BrowserWindow stand-in that records what was loaded and hands back its listeners. */
class FakeWindow {
  public readonly loaded: string[] = []
  public readonly listeners = new Map<string, Handler[]>()
  private readonly failFor: (url: string) => Error | null
  public destroyed = false

  constructor(failFor: (url: string) => Error | null) {
    this.failFor = failFor
  }

  public readonly webContents = {
    on: (event: string, handler: Handler): void => {
      const list = this.listeners.get(event) ?? []
      list.push(handler)
      this.listeners.set(event, list)
    },
    once: (event: string, handler: Handler): void => this.webContents.on(event, handler),
    setWindowOpenHandler: (): void => {},
  }

  loadURL(url: string): Promise<void> {
    this.loaded.push(url)
    const failure = this.failFor(url)
    return failure === null ? Promise.resolve() : Promise.reject(failure)
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  emit(event: string, ...args: unknown[]): void {
    for (const handler of this.listeners.get(event) ?? []) handler(...args)
  }
}

let built: FakeWindow[] = []
let failFor: (url: string) => Error | null = () => null

vi.mock('electron', () => ({
  BrowserWindow: class {
    constructor() {
      const w = new FakeWindow((url) => failFor(url))
      built.push(w)
      return w as unknown as object
    }
  },
  shell: { openExternal: vi.fn() },
}))

vi.mock('@main/logging/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const { openInWindow } = await import('../appWindow')

const LABELS = {
  connecting: 'CONNECTING',
  failedTitle: 'FAILED-TITLE',
  failedBody: 'FAILED-BODY',
  reasonLabel: 'REASON',
  hint: 'HINT',
} as const

const APP_URL = 'http://192.0.2.10:7860/'

const decode = (dataUrl: string): string =>
  decodeURIComponent(dataUrl.replace(/^data:text\/html;charset=utf-8,/, ''))

/** Lets the `void start()` chain inside `openInWindow` run to completion. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
}

beforeEach(() => {
  built = []
  failFor = () => null
})

describe('openInWindow wiring', () => {
  it('shows the connecting page BEFORE the app URL, so the gap is never blank', async () => {
    const window = openInWindow({ url: APP_URL, title: 'Immich', labels: LABELS }) as unknown as FakeWindow
    await settle()

    expect(window.loaded.length).toBeGreaterThanOrEqual(2)
    expect(decode(window.loaded[0] ?? '')).toContain('CONNECTING')
    // The measured hang was 21 s of silence with no event to hang a spinner on. The order
    // is the whole point: the page has to be there before the wait starts.
    expect(window.loaded[1]).toBe(APP_URL)
  })

  it('turns a REJECTED loadURL into a notice — the case that emits no events at all', async () => {
    failFor = (url) =>
      url === APP_URL ? new Error("ERR_FAILED (-2) loading 'http://192.0.2.1:8080/'") : null
    const window = openInWindow({ url: APP_URL, title: 'Immich', labels: LABELS }) as unknown as FakeWindow
    await settle()

    const last = decode(window.loaded[window.loaded.length - 1] ?? '')
    expect(last).toContain('FAILED-TITLE')
    expect(last).toContain('REASON: ERR_FAILED (-2)')
    expect(last).toContain(APP_URL)
  })

  it('turns a did-fail-load into a notice', async () => {
    const window = openInWindow({ url: APP_URL, title: 'Immich', labels: LABELS }) as unknown as FakeWindow
    await settle()
    window.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', APP_URL, true)
    await settle()

    const last = decode(window.loaded[window.loaded.length - 1] ?? '')
    expect(last).toContain('FAILED-TITLE')
    expect(last).toContain('REASON: ERR_CONNECTION_REFUSED (-102)')
  })

  it('shows ONE notice when both paths fire, as they did in the measured refusal', async () => {
    failFor = (url) =>
      url === APP_URL ? new Error("ERR_CONNECTION_REFUSED (-102) loading '…'") : null
    const window = openInWindow({ url: APP_URL, title: 'Immich', labels: LABELS }) as unknown as FakeWindow
    await settle()
    const afterRejection = window.loaded.length
    window.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', APP_URL, true)
    await settle()

    expect(window.loaded.length).toBe(afterRejection)
  })

  it('does NOT cover a healthy load when the connecting page is aborted', async () => {
    const window = openInWindow({ url: APP_URL, title: 'Immich', labels: LABELS }) as unknown as FakeWindow
    await settle()
    const beforeAbort = window.loaded.length
    // ERR_ABORTED is what a superseded navigation looks like — it happens on EVERY healthy
    // open, because the connecting page is replaced by the app. Reporting it would have put
    // an error page over every working app.
    window.emit('did-fail-load', {}, -3, 'ERR_ABORTED', APP_URL, true)
    await settle()

    expect(window.loaded.length).toBe(beforeAbort)
  })

  it('leaves the app alone once it has loaded — a sub-frame failure is not our page', async () => {
    const window = openInWindow({ url: APP_URL, title: 'Immich', labels: LABELS }) as unknown as FakeWindow
    await settle()
    const before = window.loaded.length
    window.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', 'http://ads.example/x', false)
    await settle()

    expect(window.loaded.length).toBe(before)
  })

  it('lets its own notice page through the origin guard', async () => {
    failFor = (url) => (url === APP_URL ? new Error("ERR_FAILED (-2) loading '…'") : null)
    const window = openInWindow({ url: APP_URL, title: 'Immich', labels: LABELS }) as unknown as FakeWindow
    await settle()
    const noticeUrl = window.loaded[window.loaded.length - 1] ?? ''

    const event = { preventDefault: vi.fn() }
    window.emit('will-navigate', event, noticeUrl)
    expect(event.preventDefault).not.toHaveBeenCalled()

    // Positive control: a FOREIGN origin still gets pushed out to the browser. Without this
    // the assertion above would also pass against a guard that stopped guarding.
    const foreign = { preventDefault: vi.fn() }
    window.emit('will-navigate', foreign, 'https://elsewhere.example/')
    expect(foreign.preventDefault).toHaveBeenCalled()
  })
})
