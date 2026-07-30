import log from 'electron-log/main'

/**
 * Structured logging. Every failure lands here with its context, so "it did not
 * work" can be answered with which host, which path, which status.
 */

log.initialize()
log.transports.file.level = 'info'
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
