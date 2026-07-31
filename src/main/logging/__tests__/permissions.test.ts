import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { tightenLogFiles } from '../permissions'

/**
 * Measured on this machine before the fix: every file under `logs/` sat at 0664 and
 * `main.log` contained 23 LAN addresses. electron-log creates files with 0o666 & umask, so
 * setting `writeOptions.mode` fixes the next file and none of the existing ones.
 */

let dir: string

const write = (name: string, mode: number): string => {
  const path = join(dir, name)
  writeFileSync(path, 'zima.request path=/v1/users/login host=198.51.100.7\n', 'utf8')
  chmodSync(path, mode)
  return path
}

const modeOf = (path: string): string => (statSync(path).mode & 0o777).toString(8)

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zima-logs-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('tightenLogFiles', () => {
  it('brings world-readable log files down to 0600', () => {
    const current = write('main.log', 0o664)
    const rotated = write('zima-client-2025-11-22.log.2', 0o644)

    const result = tightenLogFiles(dir)

    expect(modeOf(current)).toBe('600')
    expect(modeOf(rotated)).toBe('600')
    expect([...result.changed].sort()).toEqual(['main.log', 'zima-client-2025-11-22.log.2'])
    expect(result.failed).toEqual([])
  })

  it('touches nothing but log files — the guard, not the feature', () => {
    // A permission sweep acts on files it did not write. This is the assertion that keeps
    // it narrow; without it the function could chmod the whole directory and still pass.
    const config = write('devices.json', 0o664)
    const readme = write('README.md', 0o664)
    const notQuite = write('main.logger', 0o664)
    mkdirSync(join(dir, 'nested.log'))
    write(join('nested.log', 'inner.log'), 0o664)

    const result = tightenLogFiles(dir)

    expect(result.changed).toEqual([])
    expect(modeOf(config)).toBe('664')
    expect(modeOf(readme)).toBe('664')
    expect(modeOf(notQuite)).toBe('664')
    // A directory whose name ends in .log must not be chmod'ed either, nor descended into.
    expect(modeOf(join(dir, 'nested.log', 'inner.log'))).toBe('664')
  })

  it('reports a file it could not change instead of swallowing it', () => {
    write('main.log', 0o600)
    const result = tightenLogFiles(dir)
    // Already correct — no work, and nothing invented as "changed".
    expect(result.changed).toEqual([])
    expect(result.failed).toEqual([])
  })

  it('names the directory when it cannot even be read', () => {
    const result = tightenLogFiles(join(dir, 'does-not-exist'))
    expect(result.changed).toEqual([])
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]?.[0]).toBe('<dir>')
  })
})
