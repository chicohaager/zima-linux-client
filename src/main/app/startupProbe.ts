import { RAW_KEY_SCAN } from './catalogueKeys'

/**
 * The renderer probe of the startup verification and the judgement over its result.
 *
 * Split out of startupVerification.ts so the pure part — what is measured in the page and
 * what counts as a failure — sits apart from the Electron plumbing that runs it.
 */

export const PROBE = `(() => {
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
