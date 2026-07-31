import { chmodSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Log files hold what the app measured: hostnames, LAN addresses, ZeroTier addresses,
 * request paths. That is the same network topology `devices.json` holds, so it gets the
 * same mode — 0600.
 *
 * `writeOptions.mode` on the transport covers files electron-log creates from now on. It
 * does nothing for the ones already on disk, which keep whatever mode they were born with
 * (0666 & umask). This closes that half.
 *
 * Deliberately narrow, for the reason a `--delete` flag is dangerous: it acts on files it
 * did not write. Only `*.log` and rotated `*.log.<n>` directly in the given directory —
 * no recursion, no other suffixes, nothing outside.
 */

const LOG_FILE = /\.log(\.\d+)?$/

export interface TightenResult {
  readonly changed: readonly string[]
  /** Name plus reason. Never thrown away — a permission we failed to set must be visible. */
  readonly failed: readonly (readonly [string, string])[]
}

export const tightenLogFiles = (dir: string, mode = 0o600): TightenResult => {
  const changed: string[] = []
  const failed: (readonly [string, string])[] = []

  let names: readonly string[]
  try {
    names = readdirSync(dir)
  } catch (cause) {
    return { changed, failed: [['<dir>', String(cause)]] }
  }

  for (const name of names) {
    if (!LOG_FILE.test(name)) continue
    const path = join(dir, name)
    try {
      const stat = statSync(path)
      if (!stat.isFile()) continue
      if ((stat.mode & 0o777) === mode) continue
      chmodSync(path, mode)
      changed.push(name)
    } catch (cause) {
      failed.push([name, String(cause)])
    }
  }

  return { changed, failed }
}
