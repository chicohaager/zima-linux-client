import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { appError, err, ok, type Result } from '@shared/result'
import { logger } from '@main/logging/logger'

/**
 * Gives this client its own capable `zerotier-one`, instead of borrowing the system's.
 *
 * 🔴 Why this exists, measured 2026-07-30:
 *
 *   an unprivileged daemon prints `unable to configure TUN/TAP device for TAP operation`,
 *   then ACCEPTS a network join it can never carry out — the member list simply stays
 *   empty, and every layer above reads that as "the device is not there".
 *
 *   /usr/sbin/zerotier-one has no capabilities (systemd runs it as root) and its API token
 *   is root-only — not readable even as a member of group `zerotier-one`, so the running
 *   system daemon cannot be borrowed either.
 *
 * So: copy OUR bundled binary into the user's own tree, and grant it CAP_NET_ADMIN there.
 * The system's binary is never modified — it belongs to the distribution, is managed by
 * systemd as root, and changing its capabilities would affect every other user of it.
 *
 * 🔴 **The grant is not performed by this application.** Two reasons, in order of weight:
 *
 *  1. It cannot be. Electron's main process runs with `no_new_privs` set, which makes the
 *     kernel ignore the setuid bit on `pkexec`/`sudo` for anything we launch — measured, and
 *     the exact cause of `pkexec must be setuid root` on a `/usr/bin/pkexec` that is
 *     correctly `-rwsr-xr-x root root`. See supervisor.ts.
 *  2. It should not be. A desktop application that raises its own privilege dialog trains
 *     people to type their password at whatever asks. Where root is already present — the
 *     `.deb`/`.rpm` install scripts — the grant happens there and nobody is ever asked.
 *     Where it is not (AppImage, tarball), the app states the one command and the user runs
 *     it themselves, in their own terminal, where they can read it first.
 */

const CAPABILITIES = 'cap_net_admin,cap_net_raw,cap_net_bind_service+eip'

/** Where our own copy lives. Under ~/.local/lib, where user-owned binaries belong. */
export const managedBinaryPath = (): string =>
  join(homedir(), '.local', 'lib', 'zima-linux-client', 'zerotier', 'zerotier-one')

/** The bundled original, packaged or in the source tree. */
const bundledBinaryPath = (): string =>
  app.isPackaged
    ? join(process.resourcesPath, 'zerotier', process.arch, 'zerotier-one')
    : join(app.getAppPath(), 'bin', 'zerotier', process.arch, 'zerotier-one')

/**
 * Whether a binary may create a TUN device unprivileged.
 *
 * Null means "could not find out" — `getcap` missing is not the same as no capability, and
 * reporting it as such would send the user to fix something that is not broken.
 */
export const hasNetAdmin = (path: string): boolean | null => {
  if (!existsSync(path)) return null
  try {
    const out = execFileSync('getcap', [path], { encoding: 'utf8', timeout: 3_000 })
    return out.includes('cap_net_admin')
  } catch {
    return null
  }
}

export interface ProvisionState {
  /** Our own copy exists at the managed path. */
  readonly installed: boolean
  /** It carries CAP_NET_ADMIN. Null when unknowable. */
  readonly capable: boolean | null
  readonly path: string
  /**
   * The single command that grants the capability, ready to be pasted into a terminal.
   *
   * Handed to the user verbatim instead of being run for them. It is one line, it is
   * readable, and `getcap` afterwards proves whether it worked — none of which is true of a
   * dialog that appears out of an application.
   */
  readonly command: string
  /** Present when the bundled source is missing — nothing can be installed from nothing. */
  readonly problem: string | null
}

export const readState = (): ProvisionState => {
  const path = managedBinaryPath()
  const source = bundledBinaryPath()
  return {
    installed: existsSync(path),
    capable: hasNetAdmin(path),
    path,
    command: `sudo setcap ${CAPABILITIES} ${path}`,
    problem: existsSync(source) ? null : `no bundled zerotier-one at ${source}`,
  }
}

/**
 * Copies the bundled binary into place if it is missing or stale.
 *
 * Compared by size rather than by mtime: a copy carries its own timestamp, while a version
 * bump changes the bytes. Cheap, and it does not go stale the way a recorded version string
 * would.
 *
 * 🔴 Copying REMOVES file capabilities — `copyFileSync` does not carry extended attributes,
 * and a fresh copy would silently drop a grant the user already gave. So a copy only happens
 * when the sizes differ, and the state is read back afterwards rather than assumed.
 */
const ensureCopied = (): Result<string> => {
  const target = managedBinaryPath()
  const source = bundledBinaryPath()
  if (!existsSync(source)) {
    return err(
      appError('capability-missing', `no bundled zerotier-one at ${source}`, 'error.zerotierMissing'),
    )
  }
  try {
    const sourceSize = statSync(source).size
    if (existsSync(target) && statSync(target).size === sourceSize) return ok(target)
    mkdirSync(join(target, '..'), { recursive: true })
    copyFileSync(source, target)
    chmodSync(target, 0o755)
    logger.info('zerotier.binary-installed', { target, bytes: sourceSize })
    return ok(target)
  } catch (cause) {
    return err(
      appError('internal', `could not install zerotier-one: ${String(cause)}`, 'error.internal', {
        target,
      }),
    )
  }
}

/**
 * Puts our own copy in place and reports what is still needed.
 *
 * Succeeds even when the capability is missing — that is a state to be shown, not a failure.
 * The caller decides what to do with `capable: false`; making it an error here would have
 * hidden the very field the user needs to see, and the command that fixes it.
 */
export const provision = async (): Promise<Result<ProvisionState>> => {
  const copied = ensureCopied()
  if (!copied.ok) return copied

  const after = readState()
  logger.info('zerotier.provision-state', {
    path: after.path,
    installed: after.installed,
    capable: after.capable,
  })
  return ok(after)
}
