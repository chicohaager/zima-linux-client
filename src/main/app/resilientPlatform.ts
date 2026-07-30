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
    const reason = knownBad
      ? 'wayland previously failed on this machine'
      : previousLaunchDied
        ? 'previous launch never painted'
        : `known-problematic drm driver: ${riskyDriver}`
    logger.warn('platform.relaunch-on-x11', { reason, sessionType, electronVersion })
    app.relaunch({ args: [...process.argv.slice(1), X11_FLAG] })
    app.exit(0)
    return { forcedX11: true, sessionType, relaunching: true }
  }

  armSentinel()
  return { forcedX11: false, sessionType, relaunching: false }
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
