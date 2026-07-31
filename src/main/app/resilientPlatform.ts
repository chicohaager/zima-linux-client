import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { logger } from '@main/logging/logger'

/**
 * Keeps the app startable on graphics stacks where the Wayland/Ozone path dies.
 *
 * Measured 2026-07-30 on a GNOME Wayland session with a VMware SVGA II virtual GPU:
 * Electron 43.2.0 segfaults in the GPU process before the window appears
 * ("Preferred drm_render_node not found, picking vmwgfx"), while
 * `--ozone-platform=x11` starts and renders fine. Neither `--disable-gpu` nor
 * `--no-sandbox` helped — worth stating, because the 0.9.x line patched exactly those
 * two flags into the .desktop file for every user and would not have fixed this.
 *
 * Scope of that measurement: one VM with a virtual GPU. Whether real hardware is
 * affected is NOT measured, so X11 is never forced globally. The mechanism is:
 *
 *  1. a sentinel file marks "a launch started but never reached first paint"
 *  2. finding that sentinel is treated as evidence that Wayland fails here, and the
 *     verdict is REMEMBERED per Electron version — otherwise every cold start would
 *     crash once, which was the first version of this code and measurably wrong
 *  3. the platform is changed by relaunching with the flag in argv. Setting it via
 *     `app.commandLine.appendSwitch` was tried and does not work: the log said
 *     `forcedX11: true` and the process segfaulted anyway, because Ozone reads argv
 *     when the process starts, long before any JavaScript runs
 *  4. every fallback is logged, and the UI can show it — a silent fallback would hide
 *     a real defect instead of making it harmless
 *
 * The verdict is keyed to the Electron version so an upgrade gets a fresh chance at
 * Wayland instead of being pinned to X11 forever.
 */

const SENTINEL = 'startup-in-progress'
const VERDICT = 'platform-verdict.json'
const X11_FLAG = '--ozone-platform=x11'

const sentinelPath = (): string => join(app.getPath('userData'), SENTINEL)
const verdictPath = (): string => join(app.getPath('userData'), VERDICT)

interface Verdict {
  /** Electron version for which Wayland was observed to fail. */
  readonly waylandFailedFor: string
  readonly recordedAt: string
}

const readVerdict = (): Verdict | null => {
  try {
    const raw = readFileSync(verdictPath(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'waylandFailedFor' in parsed &&
      typeof (parsed as Verdict).waylandFailedFor === 'string'
    ) {
      return parsed as Verdict
    }
    return null
  } catch {
    return null
  }
}

const writeVerdict = (electronVersion: string): void => {
  try {
    const verdict: Verdict = {
      waylandFailedFor: electronVersion,
      recordedAt: new Date().toISOString(),
    }
    writeFileSync(verdictPath(), `${JSON.stringify(verdict, null, 2)}\n`, 'utf8')
  } catch (cause) {
    logger.warn('platform.verdict-unwritable', { cause: String(cause) })
  }
}

export interface PlatformDecision {
  /** True when this launch runs on the X11 fallback. */
  readonly forcedX11: boolean
  readonly sessionType: string
  /** True when a replacement process was spawned and this one must stop now. */
  readonly relaunching: boolean
}

/** Must be the first thing the main script does — before the GPU process exists. */
export const decidePlatform = (): PlatformDecision => {
  const sessionType = process.env['XDG_SESSION_TYPE'] ?? 'unknown'
  const electronVersion = process.versions.electron ?? 'unknown'
  /**
   * Only argv counts.
   *
   * 🔴 `ELECTRON_OZONE_PLATFORM_HINT=x11` was tried here and **measured not to work** on
   * Electron 43.2.0: with the hint set and the relaunch suppressed, the process still died
   * with SIGSEGV. Treating it as "already on X11" would therefore be worse than useless —
   * it would suppress the one thing that does help. Same result as
   * `app.commandLine.appendSwitch`, and for the same reason: Ozone has chosen its platform
   * before any of this is readable.
   */
  const alreadyOnX11 = process.argv.includes(X11_FLAG)
  const onWayland = sessionType === 'wayland'

  if (alreadyOnX11 || !onWayland) {
    // Nothing to decide. Still drop the sentinel so a crash on this path is noticed.
    armSentinel()
    return { forcedX11: alreadyOnX11, sessionType, relaunching: false }
  }

  const verdict = readVerdict()
  const knownBad = verdict?.waylandFailedFor === electronVersion
  const previousLaunchDied = existsSync(sentinelPath())
  const riskyDriver = detectRiskyDrmDriver()

  // Skip even the first crash where the graphics driver is one we have measured to
  // break: the segfault above happened on vmwgfx. This is a targeted heuristic, not a
  // blanket switch — only these virtual drivers, and only under Wayland.
  if (riskyDriver !== null && !knownBad && !previousLaunchDied) {
    logger.warn('platform.risky-drm-driver', { driver: riskyDriver, sessionType })
  }

  if (previousLaunchDied && !knownBad) {
    // First evidence: remember it so later launches skip straight to the fallback
    // instead of crashing once every time.
    writeVerdict(electronVersion)
    logger.warn('platform.wayland-marked-bad', { sessionType, electronVersion })
  }

  if (knownBad || previousLaunchDied || riskyDriver !== null) {
    /*
     * 🔴 Never relaunch under `electron-vite dev`.
     *
     * `app.relaunch()` starts a DETACHED process and exits this one. electron-vite is the
     * parent: it sees Electron terminate, shuts the Vite dev server down, and what is left
     * is an orphaned window whose renderer source no longer exists. Measured 2026-07-30 —
     * `npm run dev` produced a live window, no dev server on 5173, no electron-vite
     * process, and a main process whose parent had become systemd.
     *
     * So in dev the fallback is stated rather than performed: the developer gets the exact
     * command, and their tooling stays in one piece. `ELECTRON_RENDERER_URL` is set by
     * electron-vite itself and is already what index.ts uses to find the dev server.
     */
    if (process.env['ELECTRON_RENDERER_URL'] !== undefined) {
      logger.warn('platform.dev-no-relaunch', {
        sessionType,
        driver: riskyDriver,
        advice: 'start with: npm run dev:x11',
      })
      process.stderr.write(
        '\n  Wayland is unreliable on this machine (driver: ' +
          String(riskyDriver ?? 'previously failed') +
          ').\n  Relaunching would kill the dev server, so it is NOT done here.\n' +
          '  Start with:  npm run dev:x11\n' +
          '  (= `electron-vite dev -- --ozone-platform=x11`; the flag has to reach argv.\n' +
          '   ELECTRON_OZONE_PLATFORM_HINT was measured NOT to work, and setting\n' +
          '   ELECTRON_CLI_ARGS by hand does not either — the CLI overwrites it.)\n\n',
      )
      armSentinel()
      return { forcedX11: false, sessionType, relaunching: false }
    }

    const reason = knownBad
      ? 'wayland previously failed on this machine'
      : previousLaunchDied
        ? 'previous launch never painted'
        : `known-problematic drm driver: ${riskyDriver}`

    const target = resolveRelaunchTarget(process.env, process.execPath)
    if (target.kind === 'no-stable-path') {
      /*
       * Nothing to relaunch FROM. Saying so beats spawning a process that cannot start:
       * that was the measured AppImage failure — the replacement died with its own mount
       * and the user saw a double-click that did nothing at all.
       */
      logger.error('platform.relaunch-impossible', {
        reason,
        sessionType,
        execPath: process.execPath,
        why: target.why,
        advice: `start it again with ${X11_FLAG}`,
      })
      process.stderr.write(
        `\n  Wayland is unreliable here (${reason}), but this build cannot restart itself:\n` +
          `  ${target.why}\n` +
          `  Start it again with:  ${X11_FLAG}\n\n`,
      )
      armSentinel()
      return { forcedX11: false, sessionType, relaunching: false }
    }

    const args = [...process.argv.slice(1), X11_FLAG]
    logger.warn('platform.relaunch-on-x11', {
      reason,
      sessionType,
      electronVersion,
      via: target.kind,
      execPath: target.execPath,
    })

    /*
     * 🔴 `app.relaunch()` is deliberately NOT used. Two independent failures were measured
     * on the packaged artifacts on 2026-07-31, and each one alone is fatal:
     *
     *  1. Inside an AppImage it never returns. Electron's relaunch goes through a helper
     *     started from `process.execPath` — the squashfs mount that dies with this
     *     process. Passing `execPath: <the .AppImage file>` does not help: measured, same
     *     result, `via: "appimage"` in the log and still no replacement.
     *
     *  2. It cannot handle a space in the path. Same payload, two directories:
     *       .../ZimaOS Client/zima-linux-client   → no second app.ready, nothing survives
     *       .../nospace/zima-linux-client         → app.ready, ok=true
     *     That is not a detail: `/opt/ZimaOS Client/` IS the install directory of the
     *     .deb/.rpm/.pacman (sanitizedProductName, measured in the built package). On any
     *     machine that needs this fallback, the installed package would have started
     *     nothing at all — and the earlier "it relaunches fine" result came from
     *     `dist/linux-unpacked`, a path that happens to have no space in it.
     *
     * Spawning it ourselves has neither problem: the argument vector is passed as an
     * array, so nothing is re-parsed, and the child is started NOW, while this process
     * (and, in an AppImage, its mount) is still alive.
     *
     * stdio is dropped on purpose: the child's durable record is its own main.log — the
     * same file this line went into — and the pipes of this process are about to close.
     */
    const child = spawn(target.execPath, args, { detached: true, stdio: 'ignore' })
    child.unref()

    app.exit(0)
    return { forcedX11: true, sessionType, relaunching: true }
  }

  armSentinel()
  return { forcedX11: false, sessionType, relaunching: false }
}

export type RelaunchTarget =
  /** A path that outlives this process — start the replacement from it. */
  | { readonly kind: 'self' | 'appimage'; readonly execPath: string }
  /** No such path exists; relaunching would spawn a process that cannot start. */
  | { readonly kind: 'no-stable-path'; readonly why: string }

/**
 * Decides what a replacement process may be started from.
 *
 * 🔴 Measured 2026-07-31, and the reason this function exists at all: inside an AppImage
 * `process.execPath` is `/tmp/.mount_<random>/zima-linux-client` — a FUSE mount owned by
 * THIS process, gone the moment it exits. On the packaged AppImage the log ends at
 * `platform.relaunch-on-x11`, no second `app.ready` ever arrives, no process survives,
 * and — because the relaunch path returns before the sentinel is written — not even a
 * trace is left behind. A user on such a graphics stack double-clicks the AppImage and
 * nothing whatsoever happens.
 *
 * ⚠️ Honest limit of this function: handing `app.relaunch()` a stable execPath was
 * measured NOT to be enough — the second run failed exactly like the first, with
 * `via: "appimage"` in the log and still no replacement. What this function decides is
 * therefore only WHERE a replacement may come from; that it is started by spawning it
 * directly, rather than through `app.relaunch()`, is decided at the call site and for
 * reasons documented there.
 *
 * The same code is fine when installed from .deb/.rpm/.pacman/tar.gz: execPath is
 * `/opt/<product>/zima-linux-client`, which stays put. Measured in the same session —
 * that build relaunches and writes its report with `forcedX11: true`.
 *
 * The stable path for an AppImage is the `.AppImage` file itself, which its runtime
 * publishes in `APPIMAGE`. Measured from inside the packaged artifact
 * (`ELECTRON_RUN_AS_NODE=1 ./ZimaOS*.AppImage -e '…'`):
 *
 *   APPIMAGE  /home/…/dist/ZimaOS Client-2.0.0-alpha.1.AppImage
 *   APPDIR    /tmp/.mount_ZimaOSkCxb9M
 *   execPath  /tmp/.mount_ZimaOSkCxb9M/zima-linux-client
 *
 * Note on how that was measured: `/proc/<pid>/environ` of the running app is NOT a
 * witness — Chromium overwrites that block, and reading it returned nothing but NULs.
 * The environment had to be asked from inside the process.
 */
export const resolveRelaunchTarget = (
  env: NodeJS.ProcessEnv,
  execPath: string,
  fileExists: (path: string) => boolean = existsSync,
): RelaunchTarget => {
  const appImage = env['APPIMAGE']?.trim()
  if (appImage !== undefined && appImage.startsWith('/') && fileExists(appImage)) {
    return { kind: 'appimage', execPath: appImage }
  }

  /*
   * `APPDIR` marks an unpacked AppDir. If our binary lives inside it and no usable
   * `APPIMAGE` was found, then every path we have dies with this process. Saying "cannot"
   * is the honest answer; a relaunch here is the silent failure described above.
   */
  const appDir = env['APPDIR']?.trim()
  if (appDir !== undefined && appDir !== '' && execPath.startsWith(`${appDir}/`)) {
    return {
      kind: 'no-stable-path',
      why:
        appImage === undefined || appImage === ''
          ? `running from an AppDir (${appDir}) and APPIMAGE is not set`
          : `running from an AppDir (${appDir}) and APPIMAGE (${appImage}) does not exist`,
    }
  }

  return { kind: 'self', execPath }
}

/**
 * Virtual GPU drivers on which the Wayland/Ozone path is known to be unreliable.
 * `vmwgfx` is the one actually measured here (Electron 43.2.0 segfault); the others
 * are the same class of virtual display adapter and are included deliberately as a
 * precaution — marked as such rather than presented as measured facts.
 */
const RISKY_DRM_DRIVERS = ['vmwgfx', 'vboxvideo', 'qxl'] as const

/** Reads the DRM driver of card0, e.g. "vmwgfx". Returns null when not readable. */
const detectRiskyDrmDriver = (): string | null => {
  try {
    const link = readlinkSync('/sys/class/drm/card0/device/driver')
    const driver = link.split('/').pop() ?? ''
    return (RISKY_DRM_DRIVERS as readonly string[]).includes(driver) ? driver : null
  } catch {
    // Not readable (container, unusual kernel) — absence of the file is not evidence
    // of a healthy driver, so we simply do not use this signal.
    return null
  }
}

const armSentinel = (): void => {
  const path = sentinelPath()
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, new Date().toISOString(), 'utf8')
  } catch (cause) {
    // Not fatal, but not swallowed: without the sentinel the fallback cannot trigger,
    // and that is worth knowing when a report says "it never starts".
    logger.warn('platform.sentinel-unwritable', { path, cause: String(cause) })
  }
}

/** Called once the window has actually painted — this launch is proven survivable. */
export const markStartupSurvived = (): void => {
  try {
    rmSync(sentinelPath(), { force: true })
  } catch (cause) {
    logger.warn('platform.sentinel-unremovable', { cause: String(cause) })
  }
}
