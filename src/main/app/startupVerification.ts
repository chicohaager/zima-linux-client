import { writeFile } from 'node:fs/promises'
import type { BrowserWindow } from 'electron'
import { app } from 'electron'
import { logger } from '@main/logging/logger'
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
  // A raw key looks like "nav.files" — visible proof that a translation never landed.
  const rawI18nKeys = Array.from(new Set(
    (text.match(/\\b[a-z][a-zA-Z]+\\.[a-z][a-zA-Z.]+\\b/g) || [])
      .filter((m) => !m.includes('.md') && !m.endsWith('.ts') && !m.endsWith('.json'))
  ))
  return { cssRuleCount, resolvedAccent, navButtons, rawI18nKeys, appliedStyles, visibleText: text.slice(0, 400) }
})()`

export const isEnabled = (): boolean =>
  typeof process.env['ZIMA_VERIFY_STARTUP'] === 'string' &&
  process.env['ZIMA_VERIFY_STARTUP'].length > 0

/**
 * Runs the probe against a window that has finished loading, writes the report and
 * quits. Failures are collected rather than thrown so the report always names every
 * problem, not just the first one.
 */
export const runStartupVerification = async (window: BrowserWindow): Promise<void> => {
  const reportPath = process.env['ZIMA_VERIFY_STARTUP']
  if (reportPath === undefined) return

  const failures: string[] = []
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
    await window.webContents.executeJavaScript(
      `(() => { localStorage.setItem('zima.theme', '${forcedTheme}');
        document.documentElement.setAttribute('data-theme', '${forcedTheme}'); return 'ok' })()`,
      true,
    )
  }
  const forcedLocale = process.env['ZIMA_VERIFY_LOCALE']
  if (forcedLocale !== undefined && forcedLocale.length > 0) {
    await window.webContents.executeJavaScript(
      `(() => { localStorage.setItem('zima.locale', '${forcedLocale}'); return 'ok' })()`,
      true,
    )
    window.webContents.reload()
    await new Promise<void>((resolve) => {
      window.webContents.once('did-finish-load', () => resolve())
    })
    await new Promise<void>((resolve) => setTimeout(resolve, 900))
  }

  try {
    probe = (await window.webContents.executeJavaScript(PROBE, true)) as typeof probe
  } catch (cause) {
    failures.push(`renderer probe threw: ${String(cause)}`)
  }

  // No invented rule-count threshold: the number depends on how many utilities the
  // build actually emitted (measured: 37 rules from a 36-block stylesheet, bracket
  // balance 0 — nothing truncated). A magic minimum would have been a guess dressed
  // up as a check. What IS asserted is that the parser accepted something and that
  // the properties we claim really compute.
  if (probe.cssRuleCount === 0) {
    failures.push('no CSS rules applied at all — the stylesheet did not load')
  }
  if (probe.resolvedAccent === '') {
    failures.push('design token --accent did not resolve at runtime')
  }
  if (probe.appliedStyles['bodyBackground'] === 'rgba(0, 0, 0, 0)') {
    failures.push('body background not applied — token styles did not reach the DOM')
  }
  if ((probe.appliedStyles['navButtonRadius'] ?? '') === '' ||
      probe.appliedStyles['navButtonRadius'] === '0px') {
    failures.push('Tailwind utility layer did not apply to the navigation button')
  }
  if (probe.navButtons < 4) {
    failures.push(`expected at least 4 navigation buttons, found ${probe.navButtons}`)
  }
  if (probe.rawI18nKeys.length > 0) {
    failures.push(`raw i18n keys visible: ${probe.rawI18nKeys.join(', ')}`)
  }

  // Scripted interaction runs after the static checks, so a scenario failure cannot be
  // confused with a broken startup.
  let scenario: ScenarioResult | null = null
  const requested = parseScenario()
  if (requested !== null) {
    try {
      scenario = await runScenario(window, requested.name, requested.argument)
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
  }

  const shot = await window.webContents.capturePage()
  const pngPath = reportPath.replace(/\.json$/, '.png')
  await writeFile(pngPath, shot.toPNG())

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
    failures,
  }

  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  logger.info('startup.verified', { ok: report.ok, cssRuleCount: report.cssRuleCount, pngPath })
  app.exit(report.ok ? 0 : 1)
}
