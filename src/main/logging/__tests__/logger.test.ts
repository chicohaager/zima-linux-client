import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
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

  it('masks a Remote ID that an earlier build left in the log, before this run writes', () => {
    // The wiring, not the function (redactLogFiles.test.ts): without the call in
    // enableFileLogging the old line stays in clear text next to the new, masked ones.
    const path = join(dir, 'main.log')
    writeFileSync(path, 'zerotier.joined {"networkId":"0123456789abcdef"}\n', { mode: 0o600 })
    log.transports.file.resolvePathFn = () => path

    enableFileLogging()
    logger.info('zerotier.joined', { networkId: '0123456789abcdef' })

    const lines = readFileSync(path, 'utf8').trim().split('\n')
    expect(lines.join('\n')).not.toMatch(/[0-9a-f]{16}/i)
    // Old and new line carry the same tag.
    const tags = lines.map((l) => l.match(/<remote-id:[0-9a-f]{8}>/)?.[0]).filter(Boolean)
    expect(tags).toHaveLength(2)
    expect(tags[0]).toBe(tags[1])
  })
})

/**
 * The Remote ID is the key to the device's network (anyone holding it can join a PUBLIC
 * ZimaOS network). It reached the log three ways: `zerotier.joined {networkId}`,
 * `zerotier.left`, and every error text that quotes it ("network <id> is …"). Masked here,
 * once, at the last point before any transport — a per-call fix would miss the next caller.
 */
describe('remote id redaction', () => {
  const ID = '0123456789abcdef'
  let seen: string[]
  const capture = (message: { data: unknown[] }): unknown => {
    seen.push(message.data.map(String).join(' '))
    return message
  }
  beforeEach(() => {
    seen = []
    log.hooks.push(capture as never)
  })
  afterEach(() => {
    log.hooks.splice(log.hooks.indexOf(capture as never), 1)
  })

  it('never lets a 16-hex network id through, in fields or in text', () => {
    logger.info('zerotier.joined', { networkId: ID })
    logger.warn('remote-id.failed', { reason: `network ${ID.toUpperCase()} is REQUESTING_CONFIGURATION` })
    expect(seen.join('\n')).not.toMatch(/[0-9a-f]{16}/i)
  })

  it('keeps a stable tag, so two lines about the same network stay comparable', () => {
    logger.info('zerotier.joined', { networkId: ID })
    logger.info('zerotier.left', { networkId: ID.toUpperCase() })
    const tags = seen.map((line) => line.match(/<remote-id:[0-9a-f]{8}>/)?.[0])
    expect(tags[0]).toBeDefined()
    expect(tags[0]).toBe(tags[1])
  })

  it('leaves longer hex values alone', () => {
    // A sha256 (64 hex) contains 16-hex runs; it is not a Remote ID and is evidence in reports.
    const sha = 'a'.repeat(64)
    logger.info('release.checksum', { sha })
    expect(seen.join('\n')).toContain(sha)
  })
})
