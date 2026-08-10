import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The verifier may only reach for handles the app actually renders — and never for a label.
 *
 * 🔴 Both halves are here because both have already produced a red verdict on a working
 * app, which is the most expensive kind of wrong: it sends someone fixing a defect that
 * does not exist.
 *
 *  1. A LABEL as a selector. `remoteIdScenario` looked for a button whose text equals
 *     'Über Remote-ID verbinden'. That literal is correct in one of the 28 catalogues; under
 *     any other ZIMA_VERIFY_LOCALE the lookup returned `missing-button` and the scenario
 *     reported "the Remote-ID button was not found". Found by Fable's review on 2026-08-09,
 *     in a sibling of two functions where exactly this had already been fixed.
 *
 *  2. A HANDLE THAT IS NOT THERE. `CLICK_ACTION('x')` clicks `[data-action="x"]`. If the
 *     renderer never carries that attribute, the scenario reports the same false negative —
 *     measured on 2026-08-09, when `<Button data-action="sign-out">` type-checked and
 *     rendered without the attribute, and a scenario concluded the panel offered no button
 *     while a screenshot from seconds earlier showed three.
 *
 * What this test does NOT prove: that the attribute survives rendering. That is one layer
 * further down and belongs to `Controls.test.tsx`, which asserts on the rendered DOM. Here
 * the question is only whether the two source files agree on the same names — the pair
 * covers the path, neither half alone does.
 */

const APP_DIR = join(process.cwd(), 'src/main/app')
const RENDERER_DIR = join(process.cwd(), 'src/renderer/src')

const filesUnder = (dir: string, suffix: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : filesUnder(full, suffix)
    return entry.name.endsWith(suffix) ? [full] : []
  })

/** The scenario sources — the files that drive the real window. Tests excluded. */
const scenarioSources = (): { path: string; text: string }[] =>
  filesUnder(APP_DIR, '.ts')
    .filter((path) => /scenario/i.test(path))
    .map((path) => ({ path, text: readFileSync(path, 'utf8') }))

const rendererText = (): string =>
  filesUnder(RENDERER_DIR, '.tsx')
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n')

describe('scenario selectors', () => {
  it('never picks an element by its rendered text', () => {
    const offenders = scenarioSources().flatMap(({ path, text }) =>
      text
        .split('\n')
        .map((line, index) => ({ line, number: index + 1 }))
        .filter(({ line }) => line.includes('textContent'))
        .map(({ number }) => `${path}:${number}`),
    )

    expect(offenders).toEqual([])
  })

  it('clicks only data-action handles the renderer actually carries', () => {
    const rendered = new Set(
      [...rendererText().matchAll(/data-action="([^"]+)"/g)].map((match) => match[1]),
    )

    const used = scenarioSources().flatMap(({ path, text }) =>
      [...text.matchAll(/CLICK_ACTION\('([^']+)'\)/g)].map((match) => ({
        action: match[1],
        path,
      })),
    )

    // A guard that would pass on an empty input is not a guard. If the extraction ever
    // stops matching — a rename, a formatter putting the call on two lines — this is what
    // goes red, instead of the suite quietly checking nothing.
    expect(used.length).toBeGreaterThanOrEqual(4)
    expect(rendered.size).toBeGreaterThanOrEqual(3)

    const missing = used
      .filter(({ action }) => action !== undefined && !rendered.has(action))
      .map(({ action, path }) => `${path} clicks [data-action="${action}"], which no renderer file sets`)

    expect(missing).toEqual([])
  })
})
