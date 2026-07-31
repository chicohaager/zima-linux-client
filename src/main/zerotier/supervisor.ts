import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { logger } from '@main/logging/logger'
import { appError, err, ok, type Result } from '@shared/result'

/**
 * Starting a process OUTSIDE this app's process tree, via `systemd --user`.
 *
 * 🔴 Why this file exists — measured on this machine 2026-07-30, and it invalidates two
 * things I had already claimed were the fix:
 *
 *   /proc/<electron-main>/status  ->  NoNewPrivs: 1
 *
 * Electron's main process runs with `no_new_privs` set. That flag is inherited by every
 * child, cannot be cleared, and tells the kernel to IGNORE both the setuid bit and file
 * capabilities on `execve`. Two consequences, both of which we hit:
 *
 *  1. `pkexec` refused with `pkexec must be setuid root` — even though
 *     `/usr/bin/pkexec` is `-rwsr-xr-x root root`. The bit is there; the kernel ignored it.
 *     I had reported this as "the grant needs a password dialog", which was wrong: the
 *     dialog never had a chance to appear.
 *
 *  2. The far more expensive one: **granting the capability would not have helped.**
 *     Our own daemon, spawned by Electron, was running as PID 965550 with
 *     `CapEff: 0000000000000000` and `NoNewPrivs: 1`. Setting file capabilities on a binary
 *     that is launched from this process tree changes nothing at all.
 *
 * The 0.9 client is the counter-example that shows the real shape of the solution, and I had
 * looked straight past it: its daemon (PID 2249) runs with `CapEff: 0000000000003400` and
 * `NoNewPrivs: 0` — because it is **not started by the app**. It is started by
 * `~/.config/systemd/user/zima-zerotier.service`, i.e. by `systemd --user`, which is a
 * different process tree with `no_new_privs` unset. I had used "that copy still works" as
 * evidence for "ship a capable binary" without ever asking *how it is started* — the
 * property I needed was not the one I had measured.
 *
 * Positive control for this module, run from a caller that HAS the flag set, because a test
 * from a clean shell would have proved nothing about our situation:
 *
 *   setpriv --no-new-privs sh -c 'systemd-run --user --pipe --wait ... grep NoNewPrivs'
 *     -> NoNewPrivs: 0
 *
 * `systemd-run --user` sends a D-Bus request to `systemd --user`, which forks the process
 * itself. Nothing is inherited from us. That is the escape hatch, and the only one:
 * `--scope` would not do, because a scope keeps running inside the caller's own tree.
 */

const run = promisify(execFile)

const message = (cause: unknown): string =>
  (cause instanceof Error ? cause.message : String(cause)).slice(0, 400)

/**
 * Whether we can launch anything outside our own tree at all.
 *
 * Probed by actually doing it, once, with `/bin/true` — not by checking whether the
 * `systemd-run` binary exists. A present binary is not a working user manager: in a Flatpak
 * sandbox, in a container, or on a machine without systemd, the binary can be there and the
 * D-Bus call still fail. The thing we need is "a process starts and belongs to somebody
 * else's tree", so that is what gets measured.
 */
export const canEscapeProcessTree = async (): Promise<boolean> => {
  try {
    await run('systemd-run', ['--user', '--quiet', '--collect', '--pipe', '--wait', '/bin/true'], {
      timeout: 10_000,
    })
    return true
  } catch (cause) {
    logger.info('zerotier.no-systemd-user', { reason: message(cause) })
    return false
  }
}

/** CAP_NET_ADMIN is capability number 12; `CapEff` is a hex bitmask in /proc/<pid>/status. */
const CAP_NET_ADMIN_BIT = 12n

/**
 * The PID systemd is supervising for this unit. Null when the unit is not running.
 *
 * Asked of systemd rather than found by scanning for a process name: two ZeroTier daemons
 * run on this machine besides ours, and picking the wrong one would answer a question about
 * somebody else's process while sounding authoritative.
 */
export const servicePid = async (unit: string): Promise<number | null> => {
  try {
    const { stdout } = await run(
      'systemctl',
      ['--user', 'show', '-p', 'MainPID', '--value', `${unit}.service`],
      { timeout: 10_000 },
    )
    const pid = Number.parseInt(stdout.trim(), 10)
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

/**
 * Whether the RUNNING process actually holds CAP_NET_ADMIN.
 *
 * 🔴 This is the witness, and `getcap` on the binary is not.
 *
 * Measured 2026-07-30, immediately after the capability was granted for the first time:
 *
 *   getcap <binary>                    cap_net_admin,... =eip   (the file: granted)
 *   /proc/<running daemon>/CapEff      0000000000000000         (the process: nothing)
 *
 * The daemon had started 84 seconds BEFORE the grant. Capabilities are applied by `execve`;
 * a running process never acquires them afterwards. Asking the file therefore produced a
 * confident "the permission is there" while the thing doing the work had none — and the
 * failure was reported as the useless "joined but the daemon does not list it".
 *
 * Null means "could not find out": no such process, or /proc unreadable. Not "no".
 */
export const processHasNetAdmin = (pid: number): boolean | null => {
  try {
    const match = /^CapEff:\s*([0-9a-fA-F]+)$/m.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))
    const mask = match?.[1]
    if (mask === undefined) return null
    return ((BigInt(`0x${mask}`) >> CAP_NET_ADMIN_BIT) & 1n) === 1n
  } catch {
    return null
  }
}

/**
 * Starts a long-running program as a transient `systemd --user` service.
 *
 * `NoNewPrivileges=false` is set explicitly. It is already the default, but this unit exists
 * *precisely* to escape that flag, so leaving it to a default would make the one property
 * that matters invisible to the next reader — and silently breakable by a drop-in.
 */
export const startService = async (
  unit: string,
  argv: readonly string[],
  description: string,
): Promise<Result<void>> => {
  const [command, ...rest] = argv
  if (command === undefined) {
    return err(appError('parameters', 'empty service command', 'error.parameters'))
  }
  // A unit left behind by a previous run — failed, or still holding the name — would make
  // the start fail with "unit already exists". Stopped first, ignoring the failure that
  // means "there was nothing to stop".
  await stopService(unit)
  try {
    await run(
      'systemd-run',
      [
        '--user',
        '--quiet',
        '--collect',
        `--unit=${unit}`,
        `--description=${description}`,
        '--property=NoNewPrivileges=false',
        '--property=Restart=no',
        '--',
        command,
        ...rest,
      ],
      { timeout: 15_000 },
    )
    logger.info('zerotier.service-started', { unit, command })
    return ok(undefined)
  } catch (cause) {
    return err(appError('internal', message(cause), 'error.zerotierNoStart', { unit }))
  }
}

/** Stops the transient unit. Missing units are not an error — there was nothing to stop. */
export const stopService = async (unit: string): Promise<void> => {
  try {
    await run('systemctl', ['--user', 'stop', `${unit}.service`], { timeout: 15_000 })
    logger.info('zerotier.service-stopped', { unit })
  } catch {
    /* not running, or no systemd --user: both mean "nothing to stop" */
  }
}

/**
 * What the unit wrote to the journal.
 *
 * Needed because a process started by systemd does not hand us its stderr the way a child
 * does — and the daemon's own complaint is the most useful sentence in the whole chain.
 * Returns null when there is nothing to read, never an empty string dressed up as evidence.
 */
export const serviceLog = async (unit: string): Promise<string | null> => {
  try {
    const { stdout } = await run(
      'journalctl',
      ['--user', '-u', `${unit}.service`, '--since=-2min', '--no-pager', '-n', '30', '-o', 'cat'],
      { timeout: 10_000 },
    )
    const text = stdout.trim()
    return text.length === 0 ? null : text
  } catch {
    return null
  }
}
