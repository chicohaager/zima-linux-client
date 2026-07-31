import { dirname } from 'node:path'
import log from 'electron-log/main'
import { tightenLogFiles } from './permissions'

/**
 * Structured logging. Every failure lands here with its context, so "it did not
 * work" can be answered with which host, which path, which status.
 *
 * Writing to disk is switched **on** by the main entry point, not by importing this
 * module. Measured before that change: one `npx vitest run` appended 123 lines to the
 * user's real `main.log` — including `zima.request … /v1/users/login status=400` from a
 * fixture, indistinguishable from a line the running app had written. A log that carries
 * test traffic cannot answer "what did the app do", and it already sent me after the
 * wrong component once.
 *
 * The guard is structural rather than an `if (process.env.VITEST)`: a test would have to
 * call `enableFileLogging()` on purpose to reach the user's directory, so no future test
 * file can pollute it by importing something that happens to log.
 */

log.transports.console.level = 'debug'
// Off until enableFileLogging(). electron-log's default is 'silly', so leaving this alone
// would mean every importer writes to disk.
log.transports.file.level = false

type Fields = Readonly<Record<string, unknown>>

const line = (event: string, fields?: Fields): string =>
  fields === undefined ? event : `${event} ${JSON.stringify(fields)}`

export const logger = {
  debug: (event: string, fields?: Fields): void => log.debug(line(event, fields)),
  info: (event: string, fields?: Fields): void => log.info(line(event, fields)),
  warn: (event: string, fields?: Fields): void => log.warn(line(event, fields)),
  error: (event: string, fields?: Fields): void => log.error(line(event, fields)),
  /** Absolute path of the current log file — shown in Settings so users can find it. */
  filePath: (): string => log.transports.file.getFile().path,
}

/**
 * Starts file logging, and brings files written by earlier builds down to 0600 before the
 * first line of this run lands next to them. Called once, as early as the main process
 * has a body — everything logged before this call exists only on the console.
 *
 * The mode covers files electron-log creates from here on (its default is 0o666 & umask,
 * world-readable); `tightenLogFiles` covers the ones already on disk. Neither half works
 * without the other.
 */
export const enableFileLogging = (): void => {
  log.initialize()
  log.transports.file.writeOptions = { flag: 'a', mode: 0o600, encoding: 'utf8' }
  log.transports.file.level = 'info'

  const { changed, failed } = tightenLogFiles(dirname(logger.filePath()))
  if (changed.length > 0) logger.info('logging.tightened', { count: changed.length })
  for (const [name, reason] of failed) logger.warn('logging.not-tightened', { name, reason })
}
