import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MIN_VISIBLE_CHARS, probeFailures, type ProbeResult } from '../startupVerification'

/**
 * What the start-up verifier is allowed to call "fine".
 *
 * 🔴 Written after a green report on a blank screen. `dist/matrix/opensuse.json`, produced
 * by the distro matrix on 2026-08-09:
 *
 *     "ok": true, "navButtons": 8, "visibleText": "", "failures": []
 *
 * A parsed stylesheet, resolved design tokens, eight buttons in the DOM — and not a word to
 * read. Every rule the verifier had measured the machinery; none of them asked whether
 * anything had been rendered. So one of six distributions reported a working application
 * from an empty window, and the summary counted it as a pass.
 *
 * The rules were sitting inside a function that takes an Electron `BrowserWindow`, which is
 * why no test ever reached them. They are a pure function now, and this file asserts both
 * directions — a healthy probe stays silent, and each individual defect is named.
 */

const HEALTHY: ProbeResult = {
  cssRuleCount: 51,
  resolvedAccent: 'oklch(53.7% .257 262.466)',
  navButtons: 8,
  rawI18nKeys: [],
  appliedStyles: {
    bodyBackground: 'oklch(0.976 0.002 264)',
    navButtonRadius: '12px',
    resolvedTheme: 'light',
    htmlLang: 'en-US',
    layout: 'sidebar',
  },
  visibleText: 'ZIMAOS\nFiles\nPhotos\nApps\nDevice\nEnglish (US)\nSystem\nLight\nDark',
}

describe('probeFailures', () => {
  it('says nothing about a healthy window', () => {
    expect(probeFailures(HEALTHY, [])).toEqual([])
  })

  it('fails a window that rendered no text — the case that shipped green', () => {
    const blank = { ...HEALTHY, visibleText: '' }

    const failures = probeFailures(blank, [])

    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('no text at all')
  })

  it('fails a window with only whitespace, which is the same emptiness', () => {
    expect(probeFailures({ ...HEALTHY, visibleText: '   \n\t  ' }, [])[0]).toContain('no text at all')
  })

  it('names the count when there is some text but not enough', () => {
    const almost = { ...HEALTHY, visibleText: 'Device' }

    const failures = probeFailures(almost, [])

    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain(`at least ${MIN_VISIBLE_CHARS}`)
    // The measured value travels with the complaint, so the next reader does not have to
    // reproduce the run to learn what was on screen.
    expect(failures[0]).toContain('"Device"')
  })

  it.each([
    [{ cssRuleCount: 0 }, 'stylesheet did not load'],
    [{ resolvedAccent: '' }, '--accent did not resolve'],
    [{ appliedStyles: { ...HEALTHY.appliedStyles, bodyBackground: 'rgba(0, 0, 0, 0)' } }, 'body background not applied'],
    [{ appliedStyles: { ...HEALTHY.appliedStyles, navButtonRadius: '0px' } }, 'Tailwind utility layer'],
    [{ navButtons: 3 }, 'at least 4 navigation buttons'],
    [{ rawI18nKeys: ['device.title'] }, 'raw i18n keys visible'],
  ] as const)('still catches the defect it always caught (%#)', (patch, expected) => {
    expect(probeFailures({ ...HEALTHY, ...patch }, []).join(' ')).toContain(expected)
  })

  it('reports a console error even when the screen looks perfect', () => {
    expect(probeFailures(HEALTHY, ['error: Uncaught TypeError']).join(' ')).toContain(
      'renderer console errors',
    )
  })
})

describe('the report that started this', () => {
  const path = join(process.cwd(), 'dist/matrix/opensuse.json')

  it.skipIf(!existsSync(path))(
    'would now fail instead of passing',
    () => {
      const report = JSON.parse(readFileSync(path, 'utf8')) as ProbeResult & {
        ok: boolean
        failures: string[]
      }

      // What the run recorded at the time: a pass.
      expect(report.ok).toBe(true)
      expect(report.failures).toEqual([])

      // What the same numbers produce today.
      const failures = probeFailures(report, [])
      expect(failures.join(' ')).toContain('no text at all')
    },
  )
})
