import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

/**
 * scripts/install.sh speaks the user's language: English by default, German under a German locale.
 *
 * 🔴 Found by the video fact check on 2026-10-08 and still so in 2.0.5 (re-measured 2026-10-17):
 * every line the installer printed was German, while README, release notes and the video are
 * English. Run through its own test seam (ZIMA_TEST_ROOT) against a built tree, `--check` needs
 * no root and changes nothing.
 */

const SCRIPT = join(process.cwd(), 'scripts/install.sh')
const root = mkdtempSync(join(tmpdir(), 'install-sh-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

// A tree with the app but without the launcher symlink: --check must report that.
const product = join(root, 'opt/ZimaOS Client')
mkdirSync(product, { recursive: true })
writeFileSync(join(product, 'zima-linux-client'), '#!/bin/sh\n')
chmodSync(join(product, 'zima-linux-client'), 0o755)
writeFileSync(join(product, 'chrome-sandbox'), '')
chmodSync(join(product, 'chrome-sandbox'), 0o755)
mkdirSync(join(root, 'usr/bin'), { recursive: true })

const run = (args: string[], locale: Record<string, string>): string => {
  const env: Record<string, string> = { PATH: process.env['PATH'] ?? '/usr/bin:/bin', ZIMA_TEST_ROOT: root, ...locale }
  const r = spawnSync('bash', [SCRIPT, ...args], { env, encoding: 'utf8' })
  // Without the colour codes: "\x1b[31mAbbruch" has no word boundary before "Abbruch" — the
  // first run of this test missed German text there for exactly that reason.
  // eslint-disable-next-line no-control-regex
  return `${r.stdout}${r.stderr}`.replace(/\x1b\[[0-9;]*m/g, '')
}

// German markers: umlauts, ß and words that are only German. An English run must contain none.
const GERMAN = /[äöüÄÖÜß]|\b(fehlt|nicht|keine?|wird|Paket(verwaltung)?|Abbruch|Hinweis|Fehler|Datei|unbekannte?|Sandkasten|liegt|zeigt)\b/

describe('scripts/install.sh language', () => {
  for (const [name, args] of [
    ['--help', ['--help']],
    ['--check against a tree without launcher', ['--check']],
    ['an unknown option', ['--frobnicate']],
  ] as const) {
    it(`is English by default: ${name}`, () => {
      const out = run([...args], { LANG: 'en_US.UTF-8' })
      expect(out.length).toBeGreaterThan(20)
      expect(out.match(GERMAN)?.[0] ?? null).toBeNull()
    })
    it(`stays German under a German locale: ${name}`, () => {
      const out = run([...args], { LANG: 'de_DE.UTF-8' })
      expect(out).toMatch(GERMAN)
    })
  }

  it('reports the missing launcher in English', () => {
    const out = run(['--check'], { LANG: 'C.UTF-8' })
    expect(out).toMatch(/usr\/bin\/zima-linux-client is missing/)
  })

  it('LC_ALL overrides LANG, as locale lookup does', () => {
    expect(run(['--help'], { LANG: 'de_DE.UTF-8', LC_ALL: 'en_US.UTF-8' }).match(GERMAN)?.[0] ?? null).toBeNull()
    expect(run(['--help'], { LANG: 'en_US.UTF-8', LC_ALL: 'de_DE.UTF-8' })).toMatch(GERMAN)
  })
})
