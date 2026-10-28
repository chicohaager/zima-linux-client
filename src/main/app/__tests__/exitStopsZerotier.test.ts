import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * "Quit, and the built-in ZeroTier stops with it" (README, video) — held for every exit.
 *
 * The window path stops the daemon in `window-all-closed` / `will-quit`. `app.exit` skips
 * both. Measured 2026-10-28: after every verifier run `zima-linux-client-zerotier` was still
 * `active`. So every `app.exit(` in the main process must have `stopDaemonSync()` right
 * before it — including the ones written later.
 *
 * One exception, by exact line: the X11 relaunch in `resilientPlatform.ts` exits before
 * `app.whenReady()` (index.ts decides the platform first), when no daemon can exist yet.
 */
const ALLOWED = new Set(['src/main/app/resilientPlatform.ts:    app.exit(0)'])

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path)
    return path.endsWith('.ts') ? [path] : []
  })

const unguardedExits = (): string[] => {
  const root = process.cwd()
  const found: string[] = []
  for (const file of sources(join(root, 'src/main'))) {
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, index) => {
      // Calls only — mentions inside comments are prose, not exits.
      if (!/^\s*app\.exit\(/.test(line)) return
      const key = `${relative(root, file)}:${line}`
      if (ALLOWED.has(key)) return
      if (!/^\s*stopDaemonSync\(\)\s*$/.test(lines[index - 1] ?? '')) {
        found.push(`${relative(root, file)}:${index + 1}`)
      }
    })
  }
  return found
}

describe('every app.exit stops the ZeroTier daemon first', () => {
  it('finds the exits it is checking', () => {
    // Positive control: a scan that matches nothing would pass the test below forever.
    const root = process.cwd()
    const calls = sources(join(root, 'src/main')).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => /^\s*app\.exit\(/.test(line)),
    )
    expect(calls.length).toBeGreaterThanOrEqual(7)
  })

  it('has stopDaemonSync() on the line before each one', () => {
    expect(unguardedExits()).toEqual([])
  })
})
