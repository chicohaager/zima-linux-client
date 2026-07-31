import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StartupReport } from '@main/app/startupVerification'

/**
 * The watchdog exists because of a measurement that lied by saying nothing.
 *
 * Cold starts of the packaged payload produced no report at all — which reads as "the
 * package does not start", and was false: the process was alive with a fully rendered
 * window. What had stopped was the verifier, waiting without a time limit on a step that
 * never came back.
 *
 * With the watchdog in place the stall was reproduced from the .deb payload on
 * 2026-07-31 and finally named itself: `capturePage()` had not returned. That is the
 * case the third test below pins down.
 *
 * So these tests are not about a timer. They are about the property that a run always
 * ends in a verdict: silence is the one outcome this tool must never produce.
 */

let dir: string
let exitCode: number | null = null
/** Report path the current test is watching, so `app.exit` can snapshot it. */
let watchedReport: string | null = null
/** What lay on disk at each `app.exit` — see the overtaking test for why that matters. */
let exits: { readonly code: number; readonly onDisk: string | null }[] = []

vi.mock('electron', () => ({
  app: {
    getVersion: (): string => '2.0.0-alpha.1',
    /*
     * `app.exit` is where the real process stops existing, so this mock records what the
     * report file contained AT THAT MOMENT. Asserting on the file after the test has let
     * every pending promise finish would model a process that politely waits — and that
     * is exactly the assumption that hid the overtaking bug.
     */
    exit: (code: number): void => {
      exitCode = code
      let onDisk: string | null = null
      if (watchedReport !== null) {
        try {
          onDisk = readFileSync(watchedReport, 'utf8')
        } catch {
          onDisk = null
        }
      }
      exits.push({ code, onDisk })
    },
  },
}))

vi.mock('@main/logging/logger', () => ({
  logger: {
    debug: (): void => {},
    info: (): void => {},
    warn: (): void => {},
    error: (): void => {},
  },
}))

const arm = async (): Promise<void> => {
  const module = await import('@main/app/startupVerification')
  module.armVerificationWatchdog()
}

/**
 * Waits for a report on the real clock.
 *
 * The report goes out through `fs.promises.writeFile`, which finishes on the thread pool
 * — fake timers never advance it. Without this the write lands in whatever test happens
 * to run next, taking `app.exit` with it: that is how the "not enabled" case first went
 * red, at an assertion that had nothing to do with the code it was testing.
 */
const awaitReport = async (path: string): Promise<StartupReport> => {
  vi.useRealTimers()
  for (let i = 0; i < 300; i++) {
    // Parsed, not merely present: `writeFile` creates the file before it has content, so
    // `existsSync` returns true on an empty file and the test fails on JSON it never saw.
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as StartupReport
    } catch {
      await new Promise<void>((resolve) => setTimeout(resolve, 10))
    }
  }
  throw new Error(`no report at ${path} after 3 s`)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zima-watchdog-'))
  exitCode = null
  watchedReport = null
  exits = []
  vi.resetModules()
  vi.useFakeTimers()
  delete process.env['ZIMA_VERIFY_STARTUP']
  delete process.env['ZIMA_VERIFY_TIMEOUT_MS']
  delete process.env['ZIMA_VERIFY_CAPTURE_MS']
})

afterEach(() => {
  vi.useRealTimers()
  delete process.env['ZIMA_VERIFY_STARTUP']
  delete process.env['ZIMA_VERIFY_TIMEOUT_MS']
  delete process.env['ZIMA_VERIFY_CAPTURE_MS']
  rmSync(dir, { recursive: true, force: true })
})

describe('armVerificationWatchdog', () => {
  it('turns a stalled run into a report instead of silence', async () => {
    const reportPath = join(dir, 'stalled.json')
    process.env['ZIMA_VERIFY_STARTUP'] = reportPath
    process.env['ZIMA_VERIFY_TIMEOUT_MS'] = '400'

    await arm()
    expect(existsSync(reportPath)).toBe(false) // nothing written before the limit
    vi.advanceTimersByTime(400)

    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as StartupReport
    expect(report.ok).toBe(false)
    expect(exitCode).toBe(1)
    // The verdict has to name where it got stuck, otherwise it is silence with a
    // timestamp: the run that motivated this was debugged in the wrong component for
    // an hour because "no report" pointed at the package rather than at the verifier.
    expect(report.failures.join(' ')).toContain('timed out after 400 ms')
    expect(report.failures.join(' ')).toContain('waiting for the window to finish loading')
  })

  it('reports the step it was actually in, not the one it started in', async () => {
    // Positive control for the step tracking itself. A watchdog that always names the
    // initial step would pass the test above while pointing at the wrong code — which
    // is exactly the failure mode it is meant to prevent.
    const reportPath = join(dir, 'stalled-later.json')
    process.env['ZIMA_VERIFY_STARTUP'] = reportPath
    process.env['ZIMA_VERIFY_TIMEOUT_MS'] = '400'
    process.env['ZIMA_VERIFY_LOCALE'] = 'de_DE'

    const module = await import('@main/app/startupVerification')
    module.armVerificationWatchdog()

    // A window whose reload event never arrives — the stall that was actually observed.
    const hangingWindow = {
      webContents: {
        on: (): void => {},
        once: (): void => {},
        reload: (): void => {},
        executeJavaScript: (): Promise<string> => Promise.resolve('ok'),
      },
    }
    void module.runStartupVerification(hangingWindow as never)
    await vi.advanceTimersByTimeAsync(400)

    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as StartupReport
    expect(report.failures.join(' ')).toContain('waiting for the reload after switching to de_DE')
    delete process.env['ZIMA_VERIFY_LOCALE']
  })

  it('writes the measurements it already has when the screenshot never comes back', async () => {
    /*
     * The stall that was actually reproduced on the packaged .deb: `capturePage()` never
     * returned. Awaited without a limit it destroyed the whole run — the probe had long
     * since succeeded and every number it produced was lost with it.
     *
     * The assertion that carries the weight is `cssRuleCount`: it can only come from the
     * real report path. A watchdog report has zeros everywhere, so this test would still
     * pass on a build where the capture deadline does nothing and the watchdog cleans up
     * afterwards — unless the measured values are asserted too.
     */
    const reportPath = join(dir, 'no-screenshot.json')
    process.env['ZIMA_VERIFY_STARTUP'] = reportPath
    process.env['ZIMA_VERIFY_TIMEOUT_MS'] = '6000' // capture budget: 1000 ms

    const module = await import('@main/app/startupVerification')
    module.armVerificationWatchdog()

    const window = {
      getBounds: (): { width: number } => ({ width: 1180 }),
      webContents: {
        on: (): void => {},
        once: (): void => {},
        reload: (): void => {},
        executeJavaScript: (): Promise<unknown> =>
          Promise.resolve({
            cssRuleCount: 51,
            resolvedAccent: 'oklch(0.62 0.19 255)',
            navButtons: 5,
            rawI18nKeys: [],
            appliedStyles: {
              bodyBackground: 'oklch(0.98 0 0)',
              navButtonRadius: '12px',
              resolvedTheme: 'light',
              htmlLang: 'de',
            },
            visibleText: 'Geräte',
          }),
        // Exactly the observed failure: a promise that is never settled.
        capturePage: (): Promise<never> => new Promise<never>(() => {}),
      },
    }
    void module.runStartupVerification(window as never)
    await vi.advanceTimersByTimeAsync(1_000)
    const report = await awaitReport(reportPath)

    expect(report.failures.join(' ')).toContain('screenshot capture did not return within 1000 ms')
    expect(report.ok).toBe(false)
    expect(exitCode).toBe(1)
    // The verdict is a real one, not the watchdog's empty form.
    expect(report.cssRuleCount).toBe(51)
    expect(report.navButtons).toBe(5)
    expect(report.locale).toBe('de')
    expect(report.failures.join(' ')).not.toContain('timed out after')
    // …and no screenshot was written, because there was none.
    expect(existsSync(join(dir, 'no-screenshot.png'))).toBe(false)
  })

  it('does not let the watchdog overwrite a verdict the run itself produced', async () => {
    /*
     * Measured on the freshly built AppImage: the run stalled inside the capture past the
     * watchdog's limit, and when the main thread came back BOTH timers were due. Node ran
     * the earlier one first, the real path began an asynchronous write — and the watchdog,
     * writing synchronously, overtook it and called `app.exit`. On disk lay a report full
     * of zeros for a run that had measured everything.
     *
     * The safety net must never be the thing that destroys the measurement.
     */
    const reportPath = join(dir, 'not-overwritten.json')
    watchedReport = reportPath
    process.env['ZIMA_VERIFY_STARTUP'] = reportPath
    // Both deadlines due inside one advance, the capture's first — the constellation the
    // stalled main thread produced by holding everything and then letting go at once.
    process.env['ZIMA_VERIFY_TIMEOUT_MS'] = '50'
    process.env['ZIMA_VERIFY_CAPTURE_MS'] = '10'

    const module = await import('@main/app/startupVerification')
    module.armVerificationWatchdog()

    const window = {
      getBounds: (): { width: number } => ({ width: 1180 }),
      webContents: {
        on: (): void => {},
        once: (): void => {},
        reload: (): void => {},
        executeJavaScript: (): Promise<unknown> =>
          Promise.resolve({
            cssRuleCount: 51,
            resolvedAccent: 'oklch(0.62 0.19 255)',
            navButtons: 5,
            rawI18nKeys: [],
            appliedStyles: {
              bodyBackground: 'oklch(0.98 0 0)',
              navButtonRadius: '12px',
              resolvedTheme: 'light',
              htmlLang: 'de',
            },
            visibleText: 'Geräte',
          }),
        capturePage: (): Promise<never> => new Promise<never>(() => {}),
      },
    }
    void module.runStartupVerification(window as never)
    await vi.advanceTimersByTimeAsync(60)

    // The FIRST exit is the one the real process would have died on.
    expect(exits.length).toBeGreaterThan(0)
    const [first] = exits
    expect(first?.onDisk).not.toBeNull()
    const written = JSON.parse(first?.onDisk ?? 'null') as StartupReport
    expect(written.cssRuleCount).toBe(51)
    expect(written.navButtons).toBe(5)
    expect(written.failures.join(' ')).toContain('screenshot capture did not return')
    // Not the watchdog's form — that one carries the total limit and nothing measured.
    expect(written.failures.join(' ')).not.toContain('timed out after 50 ms')
  })

  it('still reports the measurements when the capture deadline never fires', async () => {
    /*
     * 🔴 Measured on the built AppImage, first cold start after packaging: the capture
     * stalled for real, the capture's own deadline did NOT fire, and 75 s later the
     * watchdog wrote a report of zeros — for a run that had already measured 51 CSS rules
     * and a rendered navigation. `cssRuleCount: 0` does not read as "the screenshot hung",
     * it reads as "the stylesheet never loaded": the safety net accused a part that was
     * working.
     *
     * Why that sub-deadline did not fire is not measured, so this test does not model a
     * reason — it models the OUTCOME: the watchdog wins the race. It must then still say
     * what the run had found.
     *
     * The forced control that was already in the suite (`ZIMA_VERIFY_CAPTURE_MS=1`) cannot
     * catch this: at 1 ms the deadline fires before the capture starts, so the watchdog
     * never gets there. Here the capture budget is deliberately larger than the whole run.
     */
    const reportPath = join(dir, 'watchdog-keeps-values.json')
    process.env['ZIMA_VERIFY_STARTUP'] = reportPath
    process.env['ZIMA_VERIFY_TIMEOUT_MS'] = '200'
    process.env['ZIMA_VERIFY_CAPTURE_MS'] = '100000' // never due within this test

    const module = await import('@main/app/startupVerification')
    module.armVerificationWatchdog()

    const window = {
      getBounds: (): { width: number } => ({ width: 1180 }),
      webContents: {
        on: (): void => {},
        once: (): void => {},
        reload: (): void => {},
        executeJavaScript: (): Promise<unknown> =>
          Promise.resolve({
            cssRuleCount: 51,
            resolvedAccent: 'oklch(0.62 0.19 255)',
            navButtons: 5,
            rawI18nKeys: [],
            appliedStyles: {
              bodyBackground: 'oklch(0.98 0 0)',
              navButtonRadius: '12px',
              resolvedTheme: 'light',
              htmlLang: 'de',
            },
            visibleText: 'Geräte',
          }),
        capturePage: (): Promise<never> => new Promise<never>(() => {}),
      },
    }
    void module.runStartupVerification(window as never)
    await vi.advanceTimersByTimeAsync(250)

    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as StartupReport
    // This IS the watchdog's report — it names the total limit and the step.
    expect(report.failures.join(' ')).toContain('timed out after 200 ms')
    expect(report.failures.join(' ')).toContain('capturing the screenshot')
    expect(report.ok).toBe(false)
    // …and it carries what the run had already measured. Zeros here were the bug.
    expect(report.cssRuleCount).toBe(51)
    expect(report.navButtons).toBe(5)
    expect(report.locale).toBe('de')
    expect(report.theme).toBe('light')
    expect(report.viewportWidth).toBe(1180)
    expect(report.visibleText).toBe('Geräte')
  })

  it('stays out of the way when startup verification is not enabled', async () => {
    // A timer that is not unref'd would hold a normal user session open forever.
    await arm()
    vi.advanceTimersByTime(600_000)
    expect(vi.getTimerCount()).toBe(0)
    expect(exitCode).toBe(null)
  })
})
