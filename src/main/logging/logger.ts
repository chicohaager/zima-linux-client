import { dirname } from 'node:path'
import log from 'electron-log/main'
import { tightenLogFiles } from './permissions'

/**
 * Structured logging. Every failure lands here with its context, so "it did not
 * work" can be answered with which host, which path, which status.
 */

log.initialize()
log.transports.file.level = 'info'
// Logs name hosts and LAN addresses — 0600, like devices.json and the credential store.
// electron-log's default is 0o666 (0664 under the usual umask), which is world-readable.
// This applies to files it creates from here on; the ones already there are handled below.
log.transports.file.writeOptions = { flag: 'a', mode: 0o600, encoding: 'utf8' }
log.transports.console.level = 'debug'

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
 * Brings log files written by earlier builds down to 0600. Runs once at startup; reports
 * what it did, because a permission change nobody can see is indistinguishable from none.
 */
export const tightenExistingLogs = (): void => {
  const { changed, failed } = tightenLogFiles(dirname(logger.filePath()))
  if (changed.length > 0) logger.info('logging.tightened', { count: changed.length })
  for (const [name, reason] of failed) logger.warn('logging.not-tightened', { name, reason })
}
