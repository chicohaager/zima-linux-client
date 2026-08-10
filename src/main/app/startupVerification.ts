import { writeFileSync } from 'node:fs'
import type { BrowserWindow } from 'electron'
import { app } from 'electron'
import { logger } from '@main/logging/logger'
import { RAW_KEY_SCAN } from './catalogueKeys'
import { parseScenario, runScenario, type ScenarioResult } from './scenarios'

/**
 * Proves the app actually starts and renders — the acceptance test for every distro
 * in the packaging matrix.
 *
 * Enabled with ZIMA_VERIFY_STARTUP=<report.json>. It captures a screenshot and, more
 * importantly, asks the *running engine* rather than the source files:
 *
 *  - How many CSS rules did the stylesheet parser actually accept? A single unclosed
 *    block makes a CSS parser swallow everything after it without any error, so a file
 *    that "contains" the rules proves nothing. Counting beats existence-checking:
 *    "121 instead of 308" is visible, "it is in there" is not.
 *  - Did a token resolve to a real computed value?
 *  - Is the navigation present, and is any raw i18n key on screen?
 *
 * Two more knobs exist because this tool once failed by saying nothing at all:
 * `ZIMA_VERIFY_TIMEOUT_MS` bounds the whole run (default 90 000) and
 * `ZIMA_VERIFY_CAPTURE_MS` bounds the screenshot alone. See `armVerificationWatchdog`.
 */

export interface StartupReport {
  readonly ok: boolean
  readonly version: string
  readonly electron: string
  readonly platform: string
  readonly sessionType: string
  readonly viewportWidth: number
  readonly theme: string
  readonly locale: string
  /** Reported, not thresholded: a drop between releases is visible as a number. */
  readonly cssRuleCount: number
  readonly resolvedAccent: string
  readonly appliedStyles: Readonly<Record<string, string>>
  readonly navButtons: number
  readonly rawI18nKeys: readonly string[]
  readonly visibleText: string
  /** Present only when ZIMA_VERIFY_SCENARIO asked for a scripted interaction. */
  readonly scenario: ScenarioResult | null
  /**
   * Renderer console output, errors and warnings only.
   *
   * Added after a run where the window was blank and the report could only say
   * `visibleText: ''`. The reason was one line in the renderer's console — invisible to
   * every check we had. A verifier that cannot see the console is guessing.
   */
  readonly consoleErrors: readonly string[]
  readonly failures: readonly string[]
}

const PROBE = `(() => {
  const sheets = Array.from(document.styleSheets)
  let cssRuleCount = 0
  for (const sheet of sheets) {
    try { cssRuleCount += sheet.cssRules.length } catch { /* cross-origin sheet */ }
  }
  const root = document.documentElement
  const resolvedAccent = getComputedStyle(root).getPropertyValue('--accent').trim()
  const navButtons = document.querySelectorAll('nav button').length

  // Ask for the properties we actually claim, not for a rule count. A stylesheet can
  // be present and still not apply; these are the computed values that prove it did.
  const body = getComputedStyle(document.body)
  const deviceButton = document.querySelector('nav button:last-of-type')
  const appliedStyles = {
    bodyBackground: body.backgroundColor,
    bodyFontFamily: body.fontFamily.split(',')[0].trim(),
    // Tailwind utility on a real element — proves the utility layer reached the DOM.
    navButtonRadius: deviceButton ? getComputedStyle(deviceButton).borderRadius : '',
    // Which theme actually took effect, read from the resolved background rather than
    // from the attribute we set — the attribute is our own request, not the result.
    resolvedTheme: (() => {
      // Parsed without a regex on purpose: this code lives inside a template string, so
      // a backslash escape would be consumed by the string and the pattern would arrive
      // at the runtime meaning something else. ESLint caught that as a "useless escape".
      const bg = body.backgroundColor
      const after = bg.split('oklch(')[1]
      if (!after) return 'unknown'
      const lightness = parseFloat(after)
      if (Number.isNaN(lightness)) return 'unknown'
      return lightness < 0.5 ? 'dark' : 'light'
    })(),
    htmlLang: document.documentElement.lang || 'unset',
    layout: document.querySelector('nav[aria-label]')
      ? (getComputedStyle(document.querySelector('nav[aria-label]')).position === 'fixed' ? 'pill' : 'sidebar')
      : 'none',
  }

  const text = document.body.innerText || ''
  // A raw key is one the catalogue defines and that reached the screen untranslated.
  // Asked against the real key list rather than a dotted-word pattern — see
  // catalogueKeys.ts for the run where the pattern accused two real files.
  const rawI18nKeys = ${RAW_KEY_SCAN}
  return { cssRuleCount, resolvedAccent, navButtons, rawI18nKeys, appliedStyles, visibleText: text.slice(0, 400) }
})()`

export const isEnabled = (): boolean =>
  typeof process.env['ZIMA_VERIFY_STARTUP'] === 'string' &&
  process.env['ZIMA_VERIFY_STARTUP'].length > 0

/** What the renderer probe hands back — the raw measurement, before any judgement. */
export interface ProbeResult {
  readonly cssRuleCount: number
  readonly resolvedAccent: string
  readonly navButtons: number
  readonly rawI18nKeys: readonly string[]
  readonly appliedStyles: Readonly<Record<string, string>>
  readonly visibleText: string
}

/**
 * A window always renders more than this. The number rules out **blank**, not "short".
 *
 * The navigation alone carries four labels, and the smallest screen adds a heading. Twenty
 * characters is far below anything the app can legitimately produce and far above zero —
 * chosen so the check has no opinion about layout, only about emptiness.
 */
export const MIN_VISIBLE_CHARS = 20

/**
 * The judgement, separated from the plumbing so it can be tested without a BrowserWindow.
 *
 * 🔴 The last rule here exists because of a green report on a blank screen. Measured
 * 2026-08-09, `dist/matrix/opensuse.json`:
 *
 *     "ok": true, "navButtons": 8, "visibleText": "", "failures": []
 *
 * Eight buttons in the DOM, a parsed stylesheet, resolved design tokens — and not one word
 * to read. Every check above measures the machinery; none of them looked at the one thing a
 * person notices first, so the gate said the run was fine. The proxy was measured well and
 * the thing itself was never asked.
 *
 * Extracted as a pure function on purpose: as long as this block sat inside a function that
 * takes an Electron window, no test could reach it, and the only way to find out what it
 * asserts was to read it.
 */
export const probeFailures = (
  probe: ProbeResult,
  consoleErrors: readonly string[],
): readonly string[] => {
  const failures: string[] = []

  // No invented rule-count threshold: the number depends on how many utilities the build
  // actually emitted (measured: 37 rules from a 36-block stylesheet, bracket balance 0 —
  // nothing truncated). A magic minimum would have been a guess dressed up as a check. What
  // IS asserted is that the parser accepted something and that the claimed properties really
  // compute.
  if (probe.cssRuleCount === 0) {
    failures.push('no CSS rules applied at all — the stylesheet did not load')
  }
  if (probe.resolvedAccent === '') {
    failures.push('design token --accent did not resolve at runtime')
  }
  if (probe.appliedStyles['bodyBackground'] === 'rgba(0, 0, 0, 0)') {
    failures.push('body background not applied — token styles did not reach the DOM')
  }
  if (
    (probe.appliedStyles['navButtonRadius'] ?? '') === '' ||
    probe.appliedStyles['navButtonRadius'] === '0px'
  ) {
    failures.push('Tailwind utility layer did not apply to the navigation button')
  }
  if (probe.navButtons < 4) {
    failures.push(`expected at least 4 navigation buttons, found ${probe.navButtons}`)
  }
  if (probe.rawI18nKeys.length > 0) {
    failures.push(`raw i18n keys visible: ${probe.rawI18nKeys.join(', ')}`)
  }

  const visible = probe.visibleText.trim()
  if (visible.length < MIN_VISIBLE_CHARS) {
    failures.push(
      visible.length === 0
        ? 'the window rendered no text at all — a blank screen with a working stylesheet'
        : `only ${visible.length} characters of text rendered (expected at least ${MIN_VISIBLE_CHARS}): ${JSON.stringify(visible)}`,
    )
  }

  // An error in the renderer's console is a failure even when the screen looks fine: it is
  // how a swallowed exception announces itself, and nothing else in this report would see it.
  if (consoleErrors.length > 0) {
    failures.push(`renderer console errors: ${consoleErrors.slice(0, 3).join(' | ')}`)
  }

  return failures
}

/**
 * Where the run currently is, so a stall can be named instead of being silence.
 * Updated by `step()` and read by the watchdog.
 */
let currentStep = 'waiting for the window to finish loading'
let watchdog: NodeJS.Timeout | null = null

/**
 * 🔴 Everything the run has measured so far, so the watchdog can report a partial verdict
 * instead of a blank one.
 *
 * Measured 2026-07-31 on the built AppImage, first cold start: the capture stalled, the
 * capture's own deadline did **not** fire, and the watchdog wrote its report at exactly
 * `limitMs` — all zeros, for a run that had already measured 51 CSS rules and a rendered
 * navigation. Why that sub-deadline did not fire is NOT measured (see `limits`); this
 * makes the outcome survivable either way. A safety net that discards the measurement it
 * was meant to protect is worse than no net: it does not just lose the verdict, it prints
 * a false one — `cssRuleCount: 0` reads as "the stylesheet never loaded".
 *
 * `failures` and `consoleErrors` are stored by reference on purpose: they keep filling up
 * after this hand-over, and the watchdog should see the newest state, not a copy.
 */
let measured: Partial<StartupReport> = {}

const record = (values: Partial<StartupReport>): void => {
  measured = { ...measured, ...values }
}

const mark = (name: string): void => {
  currentStep = name
}

const step = <T>(name: string, work: Promise<T>): Promise<T> => {
  mark(name)
  return work
}

/**
 * Both budgets in one place. The capture gets a sixth of the run at most — an attempt to
 * keep a hung screenshot from eating the whole verdict, and one that was measured failing
 * to do so on the AppImage (see the capture step). The verdict survives because of
 * `record()`, not because of this number.
 *
 * `ZIMA_VERIFY_CAPTURE_MS` exists so the screenshot fallback can be proved **on the
 * shipped binary** and not only in a test: set it to `1` and the capture cannot finish,
 * whatever the machine does. Deriving it from `ZIMA_VERIFY_TIMEOUT_MS` alone would not
 * do — shrinking the total far enough to squeeze the capture also fires the watchdog
 * before the run ever reaches it, and then the positive control proves the wrong thing.
 */
const limits = (): { readonly totalMs: number; readonly captureMs: number } => {
  const raw = Number(process.env['ZIMA_VERIFY_TIMEOUT_MS'])
  const totalMs = Number.isFinite(raw) && raw > 0 ? raw : 90_000
  const forced = Number(process.env['ZIMA_VERIFY_CAPTURE_MS'])
  const captureMs =
    Number.isFinite(forced) && forced > 0 ? forced : Math.min(15_000, Math.floor(totalMs / 6))
  return { totalMs, captureMs }
}

/** Resolves to `null` instead of waiting forever. The loser of the race is abandoned. */
const withDeadline = <T>(work: Promise<T>, limitMs: number): Promise<T | null> => {
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), limitMs)
  })
  return Promise.race([work, deadline]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}

/**
 * 🔴 A verifier that can hang has no verdict.
 *
 * Measured 2026-07-31 on the packaged payload: cold starts produced no report at all.
 * That reads as "the package does not start" — and it was false. The process was alive
 * with a fully rendered window. What had stopped was this tool: it waited, without any
 * time limit, on a step that never came back.
 *
 * With the watchdog armed the same stall was reproduced from the `.deb` payload, started
 * from a directory named exactly `ZimaOS Client/` — the leaf the installation creates —
 * and it finally said which step:
 *
 *   [error] startup.verification-timeout {"step":"capturing the screenshot","limitMs":90000}
 *
 * `webContents.capturePage()` had not returned. Everything before it had worked — the
 * sentinel was cleared (so the window painted) and the probe had already run. Why the
 * capture hangs is NOT measured; it happened once in twelve cold starts of the same
 * payload, so it is rare rather than understood. That is exactly why the answer here is
 * a time limit and not an explanation — and why the capture now has a deadline of its
 * own (see `limits`), so a hung screenshot costs the screenshot and not the verdict.
 *
 * After `totalMs` the report is written anyway, with `ok: false`, the step it was stuck
 * in, and everything the run had measured up to that point (see `measured`). A wrong
 * verdict can be argued with; silence sends you hunting the wrong bug — and a verdict of
 * zeros is worse than silence, because it accuses a part that was working.
 */
export const armVerificationWatchdog = (): void => {
  const reportPath = process.env['ZIMA_VERIFY_STARTUP']
  if (reportPath === undefined || reportPath.length === 0) return

  const { totalMs: limitMs } = limits()

  watchdog = setTimeout(() => {
    const failure = `verification timed out after ${limitMs} ms while: ${currentStep}`
    logger.error('startup.verification-timeout', {
      step: currentStep,
      limitMs,
      // Says at a glance whether this report carries measurements or is genuinely blank.
      cssRuleCount: measured.cssRuleCount ?? 0,
    })
    try {
      writeFileSync(
        reportPath,
        `${JSON.stringify(
          {
            ok: false,
            version: app.getVersion(),
            electron: process.versions.electron ?? 'unknown',
            platform: `${process.platform}-${process.arch}`,
            sessionType: process.env['XDG_SESSION_TYPE'] ?? 'unknown',
            viewportWidth: measured.viewportWidth ?? 0,
            theme: measured.theme ?? 'unknown',
            locale: measured.locale ?? 'unknown',
            cssRuleCount: measured.cssRuleCount ?? 0,
            resolvedAccent: measured.resolvedAccent ?? '',
            appliedStyles: measured.appliedStyles ?? {},
            navButtons: measured.navButtons ?? 0,
            rawI18nKeys: measured.rawI18nKeys ?? [],
            visibleText: measured.visibleText ?? '',
            scenario: measured.scenario ?? null,
            consoleErrors: measured.consoleErrors ?? [],
            failures: [...(measured.failures ?? []), failure],
          } satisfies StartupReport,
          null,
          2,
        )}\n`,
        'utf8',
      )
    } catch (cause) {
      logger.error('startup.timeout-report-unwritable', { cause: String(cause) })
    }
    app.exit(1)
  }, limitMs)
  // Deliberately NOT unref'd: this timer must be able to hold the process, otherwise a
  // hang with no other pending work would exit without ever writing the report.
}

/**
 * Runs the probe against a window that has finished loading, writes the report and
 * quits. Failures are collected rather than thrown so the report always names every
 * problem, not just the first one.
 */
export const runStartupVerification = async (window: BrowserWindow): Promise<void> => {
  const reportPath = process.env['ZIMA_VERIFY_STARTUP']
  if (reportPath === undefined) return

  const failures: string[] = []
  // Attached before anything else runs so a failure during the very first render is caught.
  const consoleErrors: string[] = []
  window.webContents.on('console-message', (event) => {
    if (event.level === 'error' || event.level === 'warning') {
      consoleErrors.push(`${event.level}: ${event.message}`.slice(0, 400))
    }
  })

  let probe = {
    cssRuleCount: 0,
    resolvedAccent: '',
    navButtons: 0,
    rawI18nKeys: [] as string[],
    appliedStyles: {} as Record<string, string>,
    visibleText: '',
  }

  // Theme and language are applied before probing so the report describes the state the
  // screenshot actually shows.
  const forcedTheme = process.env['ZIMA_VERIFY_THEME']
  if (forcedTheme === 'light' || forcedTheme === 'dark') {
    await step(
      `applying theme ${forcedTheme}`,
      window.webContents.executeJavaScript(
        `(() => { localStorage.setItem('zima.theme', '${forcedTheme}');
        document.documentElement.setAttribute('data-theme', '${forcedTheme}'); return 'ok' })()`,
        true,
      ),
    )
  }
  const forcedLocale = process.env['ZIMA_VERIFY_LOCALE']
  if (forcedLocale !== undefined && forcedLocale.length > 0) {
    await step(
      `applying locale ${forcedLocale}`,
      window.webContents.executeJavaScript(
        `(() => { localStorage.setItem('zima.locale', '${forcedLocale}'); return 'ok' })()`,
        true,
      ),
    )
    window.webContents.reload()
    /*
     * The likeliest place in this whole function to stall: an event that simply never
     * arrives has no timeout of its own, and `once` waits forever. It gets its own step
     * name so the watchdog says *this* rather than the step before it — a time-out
     * message that names the wrong step sends the next person to the wrong code.
     */
    await step(
      `waiting for the reload after switching to ${forcedLocale}`,
      new Promise<void>((resolve) => {
        window.webContents.once('did-finish-load', () => resolve())
      }),
    )
    await step(
      'settling after the locale reload',
      new Promise<void>((resolve) => setTimeout(resolve, 900)),
    )
  }

  try {
    probe = (await step(
      'probing the renderer',
      window.webContents.executeJavaScript(PROBE, true),
    )) as typeof probe
  } catch (cause) {
    failures.push(`renderer probe threw: ${String(cause)}`)
  }

  failures.push(...probeFailures(probe, consoleErrors))

  /*
   * Handed to the watchdog HERE, before the run enters anything that can stall. From this
   * line on, a time-out costs the parts that come after it and nothing that came before —
   * whichever safety net happens to fire.
   */
  record({
    viewportWidth: window.getBounds().width,
    theme: probe.appliedStyles['resolvedTheme'] ?? 'unknown',
    locale: probe.appliedStyles['htmlLang'] ?? 'unknown',
    cssRuleCount: probe.cssRuleCount,
    resolvedAccent: probe.resolvedAccent,
    appliedStyles: probe.appliedStyles,
    navButtons: probe.navButtons,
    rawI18nKeys: probe.rawI18nKeys,
    visibleText: probe.visibleText,
    consoleErrors,
    failures,
  })

  // Scripted interaction runs after the static checks, so a scenario failure cannot be
  // confused with a broken startup.
  let scenario: ScenarioResult | null = null
  const requested = parseScenario()
  if (requested !== null) {
    try {
      scenario = await step(
        `running scenario ${requested.name}`,
        runScenario(window, requested.name, requested.argument),
      )
    } catch (cause) {
      // Without this, a throwing scenario left the whole verifier hanging with no report
      // written — a silent failure in the very tool meant to prevent silent failures.
      scenario = {
        name: requested.name,
        ok: false,
        observed: {},
        failures: [`scenario threw: ${String(cause)}`],
      }
    }
    if (!scenario.ok) {
      failures.push(...scenario.failures.map((f) => `scenario ${requested.name}: ${f}`))
    }
    record({ scenario })
  }

  /*
   * The screenshot is evidence, not the verdict — so it gets a deadline of its own.
   *
   * Measured 2026-07-31 on the .deb payload: `capturePage()` did not return, and because
   * it was awaited without a limit it took the whole run down with it. Everything above
   * this line had already succeeded; all of it was lost.
   *
   * 🔴 This deadline is NOT the thing that makes that survivable — measured the same day
   * on the AppImage: the capture stalled for real, this deadline did not fire, and the
   * watchdog wrote the report 75 s later. The forced control (`ZIMA_VERIFY_CAPTURE_MS=1`)
   * proves the fallback *path* works, and it proved the wrong thing about the *stall*: at
   * 1 ms the deadline fires before the capture ever gets going, so it never modelled a
   * main thread that is stuck. What actually keeps the numbers is `record()` above —
   * every exit from here on reports what was already measured.
   */
  const { captureMs } = limits()
  const shot = await step(
    'capturing the screenshot',
    withDeadline(window.webContents.capturePage(), captureMs),
  )
  const pngPath = reportPath.replace(/\.json$/, '.png')
  if (shot === null) {
    failures.push(
      `screenshot capture did not return within ${captureMs} ms — everything else in ` +
        'this report was measured before it',
    )
  } else {
    mark('writing the screenshot')
    writeFileSync(pngPath, shot.toPNG())
  }

  const report: StartupReport = {
    ok: failures.length === 0,
    version: app.getVersion(),
    electron: process.versions.electron ?? 'unknown',
    platform: `${process.platform}-${process.arch}`,
    sessionType: process.env['XDG_SESSION_TYPE'] ?? 'unknown',
    viewportWidth: window.getBounds().width,
    theme: probe.appliedStyles['resolvedTheme'] ?? 'unknown',
    locale: probe.appliedStyles['htmlLang'] ?? 'unknown',
    cssRuleCount: probe.cssRuleCount,
    resolvedAccent: probe.resolvedAccent,
    appliedStyles: probe.appliedStyles,
    navButtons: probe.navButtons,
    rawI18nKeys: probe.rawI18nKeys,
    visibleText: probe.visibleText,
    scenario,
    consoleErrors: consoleErrors.slice(0, 20),
    failures,
  }

  /*
   * 🔴 Written synchronously, and that is the whole point.
   *
   * Measured 2026-07-31 on the freshly built AppImage: the run reached the capture, the
   * main thread stalled there for ~43 s, and when it came back the report never landed —
   * the file on disk was the watchdog's, all zeros, at exactly `limitMs`. Both timers had
   * expired by then; Node ran the earlier one first, this path started its *asynchronous*
   * write, and the watchdog's callback — writing with `writeFileSync` — overtook it and
   * called `app.exit`. The verdict that had actually been measured lost a race against
   * its own safety net.
   *
   * A synchronous write cannot be interleaved by a timer, so whoever gets here first
   * finishes, and clearing the watchdog immediately after closes the window for good.
   */
  mark('writing the report')
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  if (watchdog !== null) clearTimeout(watchdog)
  logger.info('startup.verified', { ok: report.ok, cssRuleCount: report.cssRuleCount, pngPath })
  app.exit(report.ok ? 0 : 1)
}
