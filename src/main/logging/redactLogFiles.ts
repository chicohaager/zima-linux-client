import { readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOG_FILE } from './permissions'
import { redact } from './redact'

/**
 * Masks the Remote ID in log files written before the logger did it itself (a5ed5f4).
 * Measured 2026-10-28 on the maintainer's machine: 73 runs of exactly 16 hex in `main.log`
 * and the v1 logs of 2025 — one network id, in clear text, next to 0600 files that are
 * otherwise private.
 *
 * Once per log directory: the scan read 126 MB in 0.8 s there, too much for every start,
 * and every line written since a5ed5f4 is masked at the source. A marker file records the
 * clean pass; any failure leaves it out, so the next start tries again.
 *
 * Same narrow file set as `tightenLogFiles` (it acts on files it did not write). A file is
 * replaced by rename from a 0600 temp file in the same directory, so a crash leaves either
 * the old or the new text, never half of one. Must run before the file transport writes,
 * or a line appended between read and rename would be lost.
 */

export const MARKER = '.remote-id-redacted'
const TEMP_SUFFIX = '.redact-tmp'

export interface RedactResult {
  readonly changed: readonly string[]
  /** Name plus reason — a file left unmasked must be visible. */
  readonly failed: readonly (readonly [string, string])[]
  /** True when the marker said this directory was already done. */
  readonly skipped: boolean
}

export const redactLogFiles = (dir: string): RedactResult => {
  const changed: string[] = []
  const failed: (readonly [string, string])[] = []

  let names: readonly string[]
  try {
    names = readdirSync(dir)
  } catch (cause) {
    return { changed, failed: [['<dir>', String(cause)]], skipped: false }
  }
  if (names.includes(MARKER)) return { changed, failed, skipped: true }

  for (const name of names) {
    if (!LOG_FILE.test(name)) continue
    const path = join(dir, name)
    const temp = `${path}${TEMP_SUFFIX}`
    try {
      if (!statSync(path).isFile()) continue
      const text = readFileSync(path, 'utf8')
      const masked = redact(text)
      if (masked === text) continue
      writeFileSync(temp, masked, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      renameSync(temp, path)
      changed.push(name)
    } catch (cause) {
      rmSync(temp, { force: true })
      failed.push([name, String(cause)])
    }
  }

  if (failed.length === 0) {
    try {
      writeFileSync(join(dir, MARKER), `${new Date().toISOString()}\n`, { mode: 0o600 })
    } catch (cause) {
      failed.push([MARKER, String(cause)])
    }
  }
  return { changed, failed, skipped: false }
}
