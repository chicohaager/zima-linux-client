import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Writes JSON that only this user may read.
 *
 * One function rather than the same four lines in three modules, because the interesting part
 * is easy to get subtly wrong and was, three times:
 *
 *  - `writeFileSync(path, data, { mode: 0o600 })` sets the mode **only when it creates the
 *    file**. Every machine that already ran an older build keeps whatever mode the file was
 *    born with, and the option reports success while changing nothing — the setter's return
 *    value is not a witness for the file's state. Measured 2026-07-31: `devices.json` sat at
 *    0664 on this machine with the option in place.
 *  - So the chmod is the part that acts on what is already there, and it has to run on every
 *    write, not once at start-up.
 *
 * Throws rather than swallowing: each caller already has an error path that names *which*
 * store failed, which is more useful than a generic warning from in here.
 */
export const writePrivateJson = (path: string, value: unknown): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  chmodSync(path, 0o600)
}
