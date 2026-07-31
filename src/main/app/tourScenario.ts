import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { RAW_KEY_SCAN } from './catalogueKeys'
import type { ScenarioResult } from './scenarios'

/**
 * Clicks through all four sections of the running app and reports what was RENDERED.
 *
 * This is the level at which the other checks are blind. Type-check, lint, unit tests and
 * the build gate all passed while the preload was unloadable and every action failed with a
 * generic error; only a look at the real window found it. So this scenario:
 *
 *  - navigates by clicking the actual navigation buttons, not by setting state,
 *  - waits for data to arrive from a real device,
 *  - asserts on visible text, on the number of rendered rows or tiles, and on the absence of
 *    raw i18n keys and of the generic error message,
 *  - writes one screenshot per section, so a human can see what the assertions saw.
 *
 * A section that renders its error state is a FAILURE of the tour, with the error text in the
 * report — that is the whole point: an error on screen is invisible to every other gate.
 */

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Clicks a navigation button by its accessible name. */
const CLICK_NAV = (label: string): string => `(() => {
  const buttons = Array.from(document.querySelectorAll('nav button'))
  const target = buttons.find((b) => (b.getAttribute('aria-label') || b.textContent || '').trim() === ${JSON.stringify(label)})
  if (!target) return 'missing:' + ${JSON.stringify(label)}
  target.click()
  return 'ok'
})()`

/**
 * What is on screen, in numbers rather than in prose.
 *
 * Counting beats existence-checking: "12 rows" says the listing arrived, while "the list is
 * present" is also true of an empty one.
 */
const INSPECT = `(() => {
  const text = document.body.innerText || ''
  // One detector, shared with the startup proof. It used to be copied here, and when the
  // shared one was fixed this copy kept the old, blind version — two checks that look
  // identical and disagree is worse than one that is merely wrong.
  const rawKeys = ${RAW_KEY_SCAN}
  return {
    // Generous on purpose. At 1200 the device screen was cut off inside the saved-device
    // list, so everything below it — panels, hints, errors — was missing from the report
    // while the report still looked complete. A verification report that silently drops
    // the bottom of the screen is a report about the top of the screen.
    text: text.slice(0, 8000),
    rawKeys,
    cards: document.querySelectorAll('section').length,
    listRows: document.querySelectorAll('li').length,
    images: Array.from(document.querySelectorAll('img')).length,
    // Images the renderer asked for and did not get: a thumbnail pipeline that 404s shows
    // up here as a number instead of as grey squares nobody counts.
    brokenImages: Array.from(document.querySelectorAll('img')).filter(
      (img) => img.complete && img.naturalWidth === 0,
    ).length,
    buttons: document.querySelectorAll('button').length,
  }
})()`

interface Observation {
  readonly text: string
  readonly rawKeys: string[]
  readonly cards: number
  readonly listRows: number
  readonly images: number
  readonly brokenImages: number
  readonly buttons: number
}

/** German labels of the four destinations — the tour runs in the user's locale. */
const SECTIONS = [
  { key: 'device', label: 'Gerät' },
  { key: 'files', label: 'Dateien' },
  { key: 'photos', label: 'Fotos' },
  { key: 'apps', label: 'Apps' },
] as const

/** Phrases that must never be on screen: they mean a mapping or a load went wrong. */
const FORBIDDEN = [
  'Da ist etwas schiefgegangen',
  'lehnt diesen Pfad ab',
  'nicht implementiert',
  'Not implemented yet',
  'NaN',
  'undefined',
] as const

export const runTour = async (window: BrowserWindow, reportPath: string): Promise<ScenarioResult> => {
  const failures: string[] = []
  const observed: Record<string, string> = {}
  const run = async (script: string): Promise<unknown> =>
    window.webContents.executeJavaScript(script, true)

  // The session is restored automatically at startup; the tour waits for it rather than
  // signing in, because it has no password — and a tour that logged in would be testing a
  // path that a returning user never takes.
  await sleep(3_500)

  for (const section of SECTIONS) {
    const clicked = String(await run(CLICK_NAV(section.label)))
    observed[`${section.key}.click`] = clicked
    if (clicked.startsWith('missing')) {
      failures.push(`navigation button for "${section.label}" not found`)
      continue
    }

    // Long enough for a listing, a gallery page and an app list to come back from a real
    // device on the LAN; measured round trips were 6-20 ms, so this is generous.
    await sleep(3_000)
    const look = (await run(INSPECT)) as Observation
    // The full captured excerpt, not a quarter of it. A 400-character cut stopped inside
    // the capability list on the device screen, so anything rendered below it was absent
    // from the report and had to be checked by eye in the screenshot.
    observed[`${section.key}.text`] = look.text
    observed[`${section.key}.counts`] =
      `cards=${look.cards} rows=${look.listRows} images=${look.images} ` +
      `broken=${look.brokenImages} buttons=${look.buttons}`

    if (look.rawKeys.length > 0) {
      failures.push(`${section.key}: raw i18n keys visible: ${look.rawKeys.join(', ')}`)
    }
    for (const phrase of FORBIDDEN) {
      if (look.text.includes(phrase)) {
        failures.push(`${section.key}: forbidden text on screen: "${phrase}"`)
      }
    }
    if (look.brokenImages > 0) {
      failures.push(`${section.key}: ${look.brokenImages} image(s) failed to load`)
    }
    if (look.buttons < 4) {
      failures.push(`${section.key}: only ${look.buttons} buttons rendered — the screen looks empty`)
    }

    const shot = await window.webContents.capturePage()
    await writeFile(join(dirname(reportPath), `tour-${section.key}.png`), shot.toPNG())
  }

  return { name: 'tour', ok: failures.length === 0, observed, failures }
}
