import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import log from 'electron-log/main'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { enableFileLogging, logger } from '../logger'

/**
 * Measured before this guard existed: `npx vitest run` appended 123 lines to the user's
 * real `~/.config/zima-linux-client/logs/main.log`, among them
 * `zima.request … /v1/users/login … status=400` from a fixture. Nothing in the file says
 * which lines the app wrote and which a test did.
 *
 * So the assertion is about the file transport actually *running*, not about a flag being
 * set: `log.hooks` are called once per transport that survived the level check, which is
 * the last point before the bytes go out.
 */

let dir: string
let usedTransports: string[]

const record = (message: unknown, _transport: unknown, name: string): unknown => {
  usedTransports.push(name)
  return message
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zima-logger-'))
  usedTransports = []
  log.hooks.push(record as never)
})

afterEach(() => {
  log.hooks.splice(log.hooks.indexOf(record as never), 1)
  log.transports.file.level = false
  rmSync(dir, { recursive: true, force: true })
})

describe('file logging', () => {
  it('writes nothing to disk until it is switched on', () => {
    logger.warn('zima.request', { host: 'device.local', path: '/v1/users/login', status: 400 })

    expect(usedTransports).not.toContain('file')
    // Without this line an empty list would read as "the file transport stayed quiet",
    // when it would in fact mean the hook never observed anything at all.
    expect(usedTransports).toContain('console')
  })

  it('writes 0600 once enabled — the same call the main process makes', () => {
    const path = join(dir, 'main.log')
    log.transports.file.resolvePathFn = () => path

    enableFileLogging()
    logger.info('app.ready', { electron: '43.2.0' })

    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path, 'utf8')).toContain('app.ready {"electron":"43.2.0"}')
    expect((statSync(path).mode & 0o777).toString(8)).toBe('600')
    expect(usedTransports).toContain('file')
  })

  it('gets 0600 from the write itself, not only from the startup sweep', () => {
    // Measured: removing `writeOptions` left the test above green, because the sweep in
    // `enableFileLogging()` chmods anything called `*.log` in that directory — the two
    // halves overlap on the main log file, so one of them was riding along untested.
    //
    // A name the sweep cannot match isolates the half that matters for every file created
    // *after* startup: a rotation during a long run makes a new file that no sweep sees.
    // With `writeOptions` removed this file comes out 0664 under the usual umask.
    const path = join(dir, 'rotated-during-the-run.txt')
    log.transports.file.resolvePathFn = () => path

    enableFileLogging()
    logger.info('app.ready', { electron: '43.2.0' })

    expect((statSync(path).mode & 0o777).toString(8)).toBe('600')
  })
})
