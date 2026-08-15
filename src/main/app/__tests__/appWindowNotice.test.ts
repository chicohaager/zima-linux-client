import { describe, expect, it } from 'vitest'
import { failureReason, noticePage, shouldReportFailure } from '../appWindow'

/**
 * What the app window is allowed to leave unsaid.
 *
 * 🔴 Written after the defect a tester reported as "when I try to use an app here it often
 * are only White and dont open the app". Reproduced against a real device in a container
 * running the shipped Electron, on a tile whose status is `running`:
 *
 *     15ms     did-start-navigation
 *     21111ms  did-fail-load code=-102 ERR_CONNECTION_REFUSED isMainFrame=true
 *     90047ms  document.body.innerText = ""
 *
 * The window never said anything, because `openInWindow` discarded the `loadURL` promise
 * and listened for nothing. These are the pure halves of the repair; the wiring that uses
 * them is asserted in `appWindowWiring.test.ts`.
 *
 * The strings below are the MEASURED ones, copied out of the runs above rather than
 * invented — a parser tested against a message shape nobody has seen is a parser tested
 * against my imagination.
 */

describe('shouldReportFailure', () => {
  it('reports the measured failure: a refused main-frame load', () => {
    expect(shouldReportFailure(-102, true)).toBe(true)
  })

  it('reports the second measured shape too: ERR_FAILED on an unroutable address', () => {
    expect(shouldReportFailure(-2, true)).toBe(true)
  })

  it('stays quiet about ERR_ABORTED — the connecting page being superseded', () => {
    // This is the one that would put an error page over every HEALTHY load: the notice
    // page is loaded first by design, and the app's own URL aborts it a moment later.
    expect(shouldReportFailure(-3, true)).toBe(false)
  })

  it('stays quiet about a sub-frame — an iframe inside the app is the app problem', () => {
    expect(shouldReportFailure(-102, false)).toBe(false)
  })
})

describe('failureReason', () => {
  it('keeps Chromium words and drops the URL — measured message, verbatim', () => {
    const measured = new Error("ERR_CONNECTION_REFUSED (-102) loading 'http://192.0.2.10:7860/'")
    expect(failureReason(measured)).toBe('ERR_CONNECTION_REFUSED (-102)')
  })

  it('handles the other measured shape', () => {
    const measured = new Error("ERR_FAILED (-2) loading 'http://192.0.2.1:8080/'")
    expect(failureReason(measured)).toBe('ERR_FAILED (-2)')
  })

  it('never returns an empty string — an empty reason line reads as "no reason"', () => {
    expect(failureReason(new Error(''))).toBe('unknown error')
    expect(failureReason(undefined)).toBe('undefined')
  })
})

describe('noticePage', () => {
  const page = (over: Partial<Parameters<typeof noticePage>[0]> = {}): string =>
    noticePage({
      heading: 'Immich did not answer',
      body: 'This app’s web interface could not be loaded.',
      url: 'http://192.0.2.10:7860/',
      detail: 'Reason: ERR_CONNECTION_REFUSED (-102)',
      hint: 'The app may be stopped.',
      ...over,
    })

  it('puts every part the user needs on the page', () => {
    const html = page()
    expect(html).toContain('Immich did not answer')
    expect(html).toContain('http://192.0.2.10:7860/')
    expect(html).toContain('ERR_CONNECTION_REFUSED (-102)')
    expect(html).toContain('The app may be stopped.')
  })

  it('escapes the title, which comes from the DEVICE and is not ours to trust', () => {
    const html = page({ heading: '<img src=x onerror="alert(1)">' })
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
    // The quotes matter as much as the angle brackets: unescaped, the payload could break
    // out of an attribute in the <title> further up.
    expect(html).not.toContain('onerror="alert(1)"')
  })

  it('escapes the URL too — it is device metadata, not a constant', () => {
    const html = page({ url: 'http://x/"><script>bad()</script>' })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('omits the optional lines instead of printing empty boxes', () => {
    const html = page({ detail: null, hint: null })
    expect(html).not.toContain('class="dim"')
    // Positive control alongside: with them set, the element IS there — otherwise this
    // assertion would pass against a page that can never show them at all.
    expect(page()).toContain('class="dim"')
  })

  it('carries its own colours, including a dark one', () => {
    // The complaint was a white rectangle. A notice page that is white on a dark desktop
    // would be a quieter version of the same thing.
    expect(page()).toContain('prefers-color-scheme: dark')
  })
})
