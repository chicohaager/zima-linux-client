import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MARKER, redactLogFiles } from '../redactLogFiles'

/**
 * Since a5ed5f4 the logger masks the Remote ID in every new line. The lines written before
 * stay: measured 2026-10-28 on this machine, `main.log` held 26 runs of exactly 16 hex
 * (one distinct value), the v1 logs of 2025 another 47. The id is the key to the device's
 * network, so the files already on disk get the same mask once.
 */

const ID = '0123456789abcdef'
const SHA = 'a'.repeat(64)
let dir: string

const write = (name: string, text: string): string => {
  const path = join(dir, name)
  writeFileSync(path, text, 'utf8')
  chmodSync(path, 0o600)
  return path
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zima-redact-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('redactLogFiles', () => {
  it('masks the id in current and rotated log files, keeps everything else', () => {
    const main = write('main.log', `zerotier.joined {"network":"${ID}"}\nsha ${SHA}\napp.ready\n`)
    const rotated = write('zima-client-2025-11-22.log.1', `network ${ID.toUpperCase()} is OK\n`)

    const result = redactLogFiles(dir)

    const text = readFileSync(main, 'utf8')
    expect(text).not.toContain(ID)
    expect(text).toMatch(/zerotier\.joined \{"network":"<remote-id:[0-9a-f]{8}>"\}\n/)
    // 64 hex (a checksum) contains 16-hex runs and must survive whole.
    expect(text).toContain(`sha ${SHA}\napp.ready\n`)
    expect(readFileSync(rotated, 'utf8')).toMatch(/^network <remote-id:[0-9a-f]{8}> is OK\n$/)
    expect([...result.changed].sort()).toEqual(['main.log', 'zima-client-2025-11-22.log.1'])
    expect(result.failed).toEqual([])
  })

  it('gives the same id the same mask as the logger does — old and new lines stay comparable', () => {
    write('main.log', `${ID}\n${ID.toUpperCase()}\n`)
    redactLogFiles(dir)
    const [a, b] = readFileSync(join(dir, 'main.log'), 'utf8').split('\n')
    expect(a).toBe(b)
  })

  it('keeps a rewritten file at 0600', () => {
    const main = write('main.log', `${ID}\n`)
    redactLogFiles(dir)
    expect((statSync(main).mode & 0o777).toString(8)).toBe('600')
  })

  it('touches nothing but log files', () => {
    const config = write('devices.json', `{"remoteId":"${ID}"}`)
    const almost = write('main.logger', ID)
    mkdirSync(join(dir, 'nested.log'))
    const inner = write(join('nested.log', 'inner.log'), ID)

    const result = redactLogFiles(dir)

    expect(result.changed).toEqual([])
    expect(readFileSync(config, 'utf8')).toContain(ID)
    expect(readFileSync(almost, 'utf8')).toBe(ID)
    expect(readFileSync(inner, 'utf8')).toBe(ID)
  })

  it('runs once: after a clean pass it leaves a marker and does not read the files again', () => {
    write('main.log', `${ID}\n`)
    expect(redactLogFiles(dir).skipped).toBe(false)
    expect(existsSync(join(dir, MARKER))).toBe(true)

    // A line written afterwards by an OLD build (downgrade) stays — the scan costs ~0.8 s on
    // 120 MB of logs, too much for every start. New builds mask at the source.
    write('main.log', `${ID}\n`)
    const second = redactLogFiles(dir)
    expect(second.skipped).toBe(true)
    expect(readFileSync(join(dir, 'main.log'), 'utf8')).toBe(`${ID}\n`)
  })

  it('leaves no marker when a file could not be rewritten, so the next start tries again', () => {
    write('main.log', `${ID}\n`)
    chmodSync(dir, 0o500) // directory read-only: the temp file cannot be created
    try {
      const result = redactLogFiles(dir)
      expect(result.failed.map(([name]) => name)).toEqual(['main.log'])
    } finally {
      chmodSync(dir, 0o700)
    }
    expect(existsSync(join(dir, MARKER))).toBe(false)
    expect(readFileSync(join(dir, 'main.log'), 'utf8')).toBe(`${ID}\n`)
  })
})
