import { BrowserWindow, shell } from 'electron'
import { logger } from '@main/logging/logger'

/**
 * Opens an app's own web UI — Plan § 7.4, mobile Screen 4.
 *
 * Two ways, both explicit:
 *
 *  - **In a window of its own**, with a separate session partition. The partition is the
 *    point: an app's cookies must not sit in the same jar as the client's device session,
 *    or a compromised app could ride along on it.
 *  - **In the system browser**, when the user prefers that.
 *
 * The window carries no preload and no bridge. It renders a third-party page, so it gets
 * nothing: no `window.zima`, no Node, sandboxed, and navigation is confined to the app's
 * own origin — a redirect to somewhere else opens in the system browser instead of quietly
 * loading inside a window that looks like part of this client.
 *
 * 🔴 **Why this file has a failure path at all.** Reported 2026-08-15 by a tester on PikaOS:
 * "when I try to use an app here it often are only White and dont open the app". It was
 * reproduced against a real device, in a container running the shipped Electron, on an app
 * whose tile says `running` and publishes a port:
 *
 *     3ms      did-start-loading
 *     15ms     did-start-navigation
 *     21111ms  did-fail-load code=-102 ERR_CONNECTION_REFUSED isMainFrame=true
 *     21117ms  loadURL REJECTED  Error: ERR_CONNECTION_REFUSED (-102) loading '…:7860/'
 *     90047ms  document.body.innerText = ""        <- still empty a minute later
 *
 * Twenty-one seconds of nothing, then an empty window for ever. The old code was
 * `void window.loadURL(url)` with no listener: the rejection was discarded and Chromium
 * rendered no error page of its own. The user was told nothing, ever.
 *
 * Three measurements shaped what is below, and each of them contradicted the obvious guess:
 *
 *  1. **`loadURL` rejects on failure.** The discarded promise was itself a lost report.
 *  2. **`did-fail-load` does not always fire.** Loading `http://192.0.2.1:8080/` (an
 *     unroutable address) rejected with `ERR_FAILED (-2)` after 16 ms and emitted **no
 *     events at all**. So the event alone would have left that case silent — both paths
 *     are needed, and both are made idempotent.
 *  3. **`did-finish-load` fires after a failure too** (it followed `did-fail-load` in every
 *     measured case). It is therefore not a success signal and is not used as one.
 */

/** Everything the notice pages say, already translated and interpolated by the renderer. */
export interface AppWindowLabels {
  /** Shown while the app's own page has not answered yet. */
  readonly connecting: string
  /** Headline of the failure page. */
  readonly failedTitle: string
  /** One sentence on what did not happen. */
  readonly failedBody: string
  /** Label in front of Chromium's own error text, e.g. "Reason". */
  readonly reasonLabel: string
  /** What the user can do about it. */
  readonly hint: string
}

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/**
 * The app title and its URL both come from the device, so neither may reach the page as
 * markup. Escaped rather than stripped: a title with an ampersand should still read right.
 */
const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c)

/**
 * `ERR_ABORTED`. Emitted when a navigation is replaced by another one — which happens here
 * by design, because the connecting page is loaded first and the app's URL supersedes it.
 * Treating it as a failure would put an error page over every healthy load.
 */
const ERR_ABORTED = -3

/** Whether a `did-fail-load` is worth telling the user about. */
export const shouldReportFailure = (errorCode: number, isMainFrame: boolean): boolean =>
  isMainFrame && errorCode !== ERR_ABORTED

/**
 * Chromium's own words for what went wrong, pulled out of the rejected `loadURL`.
 *
 * The measured shape is `Error: ERR_CONNECTION_REFUSED (-102) loading 'http://…:7860/'`.
 * The URL is cut off because it is already on the page, and because a device-supplied URL
 * has no business being pasted twice.
 */
export const failureReason = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : String(error)
  const withoutUrl = raw.split(' loading ')[0] ?? raw
  const trimmed = withoutUrl.replace(/^Error:\s*/, '').trim()
  return trimmed.length > 0 ? trimmed : 'unknown error'
}

/**
 * A self-contained notice page.
 *
 * No stylesheet, no font, no image — it has to render on a machine where the thing we were
 * trying to reach is exactly what is unreachable. It follows the system theme so it does
 * not flash white on a dark desktop, which is the very complaint that led here.
 */
export const noticePage = (params: {
  readonly heading: string
  readonly body: string
  readonly url: string
  readonly detail: string | null
  readonly hint: string | null
}): string => `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(params.heading)}</title>
<style>
:root { color-scheme: light dark; --fg: #1c1c1e; --dim: #6b6b70; --bg: #f6f6f7; --line: #dcdce0 }
@media (prefers-color-scheme: dark) {
  :root { --fg: #ececee; --dim: #9a9aa0; --bg: #1a1a1c; --line: #34343a }
}
body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
  background: var(--bg); color: var(--fg);
  font: 15px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif }
main { max-width: 34rem; padding: 2rem }
h1 { font-size: 1.15rem; margin: 0 0 .6rem }
p { margin: 0 0 .6rem }
.dim { color: var(--dim) }
code { font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all;
  display: block; margin: .9rem 0; padding: .6rem .7rem; border: 1px solid var(--line);
  border-radius: .5rem }
</style></head>
<body><main>
<h1>${escapeHtml(params.heading)}</h1>
<p>${escapeHtml(params.body)}</p>
<code>${escapeHtml(params.url)}</code>
${params.detail === null ? '' : `<p class="dim">${escapeHtml(params.detail)}</p>`}
${params.hint === null ? '' : `<p class="dim">${escapeHtml(params.hint)}</p>`}
</main></body></html>`

const dataUrl = (html: string): string => `data:text/html;charset=utf-8,${encodeURIComponent(html)}`

export const openInBrowser = async (url: string): Promise<void> => {
  await shell.openExternal(url)
}

export const openInWindow = (params: {
  readonly url: string
  readonly title: string
  readonly labels: AppWindowLabels
}): BrowserWindow => {
  const origin = new URL(params.url).origin
  const window = new BrowserWindow({
    width: 1_100,
    height: 780,
    title: params.title,
    autoHideMenuBar: true,
    // Painted before the first frame arrives, so the gap between opening the window and the
    // app answering is not a bright white rectangle on a dark desktop.
    backgroundColor: '#1a1a1c',
    webPreferences: {
      /*
       * A per-app partition, not the default session: separate cookies, cache and storage.
       *
       * Keyed on the ORIGIN, not on the display title. The title is metadata from the device
       * and it is neither unique nor stable: two apps called "Dashboard" would have shared one
       * cookie jar — the isolation this line exists for, silently absent — and renaming an app
       * would have moved it to a fresh partition, logging the user out of it for no visible
       * reason. The origin is what the browser's own security model is keyed on, so it is what
       * the partition should follow.
       */
      partition: `persist:zima-app-${encodeURIComponent(origin)}`,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  })

  /** The exact address of a page this process put there itself. */
  let ownPage: string | null = null
  let noticeShown = false

  const show = (page: string): Promise<void> => {
    if (window.isDestroyed()) return Promise.resolve()
    ownPage = dataUrl(page)
    return window.loadURL(ownPage)
  }

  const showFailure = (reason: string): void => {
    // Both the rejected promise and `did-fail-load` land here, and in the refused case both
    // of them fire. Whichever arrives first is the one the user reads.
    if (noticeShown || window.isDestroyed()) return
    noticeShown = true
    logger.info('app-window.load-failed', { origin, reason })
    void show(
      noticePage({
        heading: params.labels.failedTitle,
        body: params.labels.failedBody,
        url: params.url,
        detail: `${params.labels.reasonLabel}: ${reason}`,
        hint: params.labels.hint,
      }),
    )
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    // Measured: this does NOT fire for a `loadURL` issued by the main process, so the notice
    // pages never reach it. The check is here anyway, because the alternative — relying on
    // that — would hand our own `data:` page to the system browser if it ever changed.
    if (url === ownPage) return
    if (new URL(url).origin === origin) return
    // Leaving the app's origin inside this window would present a foreign page in a frame
    // the user reads as "my ZimaOS app". Hand it to the browser, where the address bar says
    // where they are.
    event.preventDefault()
    logger.info('app-window.navigation-externalised', { to: new URL(url).origin })
    void shell.openExternal(url)
  })

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
    if (!shouldReportFailure(errorCode, isMainFrame)) return
    showFailure(`${errorDescription} (${errorCode})`)
  })

  const start = async (): Promise<void> => {
    // The connecting page goes up FIRST. A load that never answers emits no event at all
    // (measured: 21 s of silence), so there is nothing to hang a spinner on afterwards —
    // the only way to have something on screen during that gap is to put it there before.
    //
    // Deliberately not a timer that swaps in a "taking too long" page later: navigating
    // would cancel the pending load, and an app that is merely slow would be killed by the
    // very thing meant to explain it.
    try {
      await show(
        noticePage({
          heading: params.title,
          body: params.labels.connecting,
          url: params.url,
          detail: null,
          hint: null,
        }),
      )
    } catch {
      // A `data:` page cannot fail to load; if it somehow did, the app's own URL still gets
      // its turn below rather than the window being left blank.
    }
    if (window.isDestroyed()) return
    ownPage = null
    try {
      await window.loadURL(params.url)
    } catch (error) {
      showFailure(failureReason(error))
    }
  }
  void start()

  return window
}
