import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * "It doesn't update itself" (README, video) — held by the dependency list, not only by the code.
 *
 * Until 2.0.5 `electron-updater` sat in `dependencies`: never imported (0 hits in src/ and in the
 * built main bundle), yet packed into every package. An updater shipped but unused contradicts
 * the promise and is code nobody reviews (video fact check, 2026-10-17).
 */
describe('no self-update machinery is shipped', () => {
  it('lists no auto-updater among the runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    const updaters = Object.keys(pkg.dependencies ?? {}).filter((d) => /updater|update-electron-app/.test(d))
    expect(updaters).toEqual([])
  })
})
